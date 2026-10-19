---
tags: ['LLM', 'agent', '上下文']
summary: "压缩（compaction）与分支摘要（branch summarization）的触发条件、切割点、Prompt 结构、文件追踪与扩展接口。"
---

# [Agent harness] compaction & branch summarization

LLM 的上下文窗口是有限的。当对话变得过长时，需要使用压缩来总结较早的内容，同时保留最近的工作。

## 概览

包括两种摘要机制：

|**机制**|**触发条件**|**目的**|
|---|---|---|
|压缩|上下文超过阈值（自动触发），或执行 `/compact`（手动触发）|总结旧消息以释放上下文|
|分支摘要|`/tree` 导航|切换分支时保留上下文|

两者使用相同的结构化摘要格式，并以累加方式追踪文件操作。压缩和分支摘要请求使用全新的路由会话 ID，并且在 provider 支持的情况下禁用 prompt cache 写入，因为这些一次性提示不太可能被复用。

## Compaction

### 触发时机

自动压缩在以下条件成立时触发：

```text
contextTokens > contextWindow - reserveTokens
```

默认情况下，`reserveTokens` 为 16384 个 token。这为 LLM 的回复留出空间。

该阈值有两个检查位置：

1. agent 刚完成一轮退出后，进行 `_handlePostAgentRun` 收尾，检查该阈值。如果超过阈值，进行压缩，然后处理排队的消息。当 tools 执行完毕、且没有排队消息需要再次回复时，跳过这个检查。

2. 在新的用户 prompt 发出之前进行检查。

也可以用 `/compact [instructions]` 手动触发，instructions 可选，为用户对 summary 的指令。

### 压缩流程

1. **寻找切割点**：从最新消息向前回溯，累加 token 估算值，直到达到 `keepRecentTokens`（默认 20k）

2. **提取消息**：收集从上一次保留边界（或 session 的起始点）到切割点之间的消息

3. **生成摘要**：调用 LLM 生成摘要；若存在上一次摘要，则将其作为迭代上下文传入

4. **追加条目**：保存 `CompactionEntry` 包含摘要和 `firstKeptEntryId`

5. **重建上下文**：session 使用摘要 + 从 `firstKeptEntryId` 开始的消息，为下一次请求重建上下文

```text
压缩前：

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
                 待摘要消息                      保留的消息
                                   ↑
                          firstKeptEntryId（条目 4）

压缩后（追加新条目）：

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 不发送给 LLM                        发送给 LLM
                                                         ↑
                                              从 firstKeptEntryId 开始

LLM 看到的内容：

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    系统提示    压缩摘要           来自 firstKeptEntryId 的消息
```

在重复压缩时，被摘要的区间从上一次压缩的保留边界（`firstKeptEntryId`）开始，而不是从压缩条目本身开始；如果找不到保留边界，则从上一次压缩之后的条目开始。

写入新的 `CompactionEntry` 之前，根据重建后的会话上下文重新计算 `tokensBefore`，使 token 计数反映被替换的真实压缩前上下文。

压缩不会删除被压缩信息条目。只在最后追加一个 `CompactionEntry`。

压缩后发送新信息时，需要对 entries 重新组织：

1. 找到最新的 compactionEntry，作为第一条消息

2. 它的 firstKeptEntry 到它之间的内容接在后面

3. compactionEntry 之后的内容接在后面

4. firstKeptEntry 之前的内容都丢弃

### 切割点规则

合法的切割点包括：

- User 消息

- Assistant 消息

- BashExecution 消息

- 自定义消息（custom_message、branch_summary）

绝不在 tool_result 处切割（必须紧跟在 tool_call 之后）。

### 切割点在一轮的中间

一轮（turn）从一条用户消息开始，包含所有助手回复和工具调用，直到下一条用户消息。正常情况下，压缩在轮次边界处切割。

当切割点落在轮次中间的某条 assistant 消息上，`isSplitTurn = true`。

```text
拆分轮次（单轮过大，超出预算）：

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── 保留（7-8）

  isSplitTurn = true
  messagesToSummarize = []  （之前没有完整轮次）
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

对于拆分轮次的情况，轮次之前的上下文（history）和轮次的前半部分（turnPrefix）要分别进行摘要，并合并。

### Prompt

```TypeScript
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;
```

```TypeScript
const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;
```

```TypeScript
const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;
```

---

## Branch Summary

### 触发时机

当你使用 `/tree` 导航到另一个分支时，弹窗询问是否总结即将离开的分支。这会把离开分支的上下文注入到新分支中。

### 压缩流程

1. **寻找公共祖先**：新旧位置共享的最深节点

2. **收集条目**：从旧叶子节点回溯到公共祖先

3. **按预算准备**：按 token 预算包含消息（从新到旧）

4. **生成摘要**：调用 LLM

5. **追加条目**：在导航点保存 `BranchSummaryEntry`

```text
导航前的树：

         ┌─ B ─ C ─ D （旧叶子，将被放弃）
    A ───┤
         └─ E ─ F （目标）

公共祖先：A
待摘要条目：B、C、D

带摘要导航后：

         ┌─ B ─ C ─ D
    A ───┤
         └─ E ─ F ─ [B、C、D 的摘要] （新叶子）
```

## 累加式文件追踪

压缩和分支摘要都以累加方式追踪文件。生成摘要时，除了文字摘要，还要从以下位置提取对文件的操作历史（file options）：

- 被摘要消息中的工具调用

- 之前的压缩或分支摘要的 `details`（如有）

这意味着文件追踪会在多次压缩或分支摘要之间累加，保留读取和修改文件的完整历史。

## 摘要格式

压缩和分支摘要都使用相同的结构化格式：

```Markdown
## 目标
[用户想要完成的事情]

## 约束与偏好
- [用户提到的需求]

## 进度
### 已完成
- [x] [已完成的任务]

### 进行中
- [ ] [当前工作]

### 受阻
- [遇到的问题（如有）]

## 关键决策
- **[决策]**：[理由]

## 下一步
1. [接下来应该做什么]

## 关键上下文
- [继续工作所需的数据]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

## 消息序列化

在摘要之前，待压缩的消息需要序列化为文本，防止模型把它当作要继续的对话。

```text
[User]: 用户说了什么
[Assistant thinking]: 内部推理
[Assistant]: 回复文本
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: 工具输出
```

工具结果在序列化时会被截断到 2000 个字符。超出该限制的内容会被替换为一个标记，说明截断了多少字符。这样可以让摘要请求保持在合理的 token 预算内，因为工具结果（尤其是来自 `read` 和 `bash` 的）通常占用最多的上下文。

## 通过扩展自定义摘要

扩展可以拦截并自定义压缩和分支摘要。

### session_before_compact

在自动压缩或 `/compact` 之前触发。可以取消或提供自定义摘要。

### 将消息转换为文本

要用自己的模型生成摘要，使用 `serializeConversation` 将消息转换为文本：

```TypeScript
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;

  // 将 AgentMessage[] 转为 Message[]，再序列化为文本
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // 返回：
  // [User]: 消息文本
  // [Assistant thinking]: 思考内容
  // [Assistant]: 回复文本
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: 输出文本

  // 现在发送给你的模型进行摘要
  const { summary, usage } = await myModel.summarize(conversationText);

  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage,
    }
  };
});
```

完整示例（使用另一个模型）见 `custom-compaction.ts`。

### session_compact_failed

当手动或自动压缩失败或被中止时触发。对于需要将 `session_before_compact` 尝试与最终结果配对的遥测扩展很有用。

```TypeScript
pi.on("session_compact_failed", async (event, ctx) => {
  const { reason, errorMessage, aborted, willRetry, fromExtension } = event;
  // reason - "manual"（/compact）、"threshold" 或 "overflow"
  // errorMessage - 非中止失败时存在
  // aborted - 取消/中止的压缩为 true
  // willRetry - 被中止的轮次是否本会在压缩后重试
  // fromExtension - 是否正在使用扩展提供的压缩内容
});
```

### session_before_tree

在 `/tree` 导航之前触发。无论用户是否选择摘要都会触发。可以取消导航或提供自定义摘要。

```TypeScript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId - 我们要导航到的位置
  // preparation.oldLeafId - 当前位置（将被放弃）
  // preparation.commonAncestorId - 共享祖先
  // preparation.entriesToSummarize - 将被摘要的条目
  // preparation.userWantsSummary - 用户是否选择了摘要

  // 完全取消导航：
  return { cancel: true };

  // 提供自定义摘要（仅在 userWantsSummary 为 true 时使用）：
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "你的摘要...",
        // usage: summaryResponse.usage, // 可选；会计入会话总计
        details: { /* 自定义数据 */ },
      }
    };
  }
});
```

参见类型文件中的 `SessionBeforeTreeEvent` 和 `TreePreparation`。

## 设置

在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置压缩：

```JSON
{
  "compaction": {
    "enabled": true,  // 启用自动压缩
    "reserveTokens": 16384,  // 为 LLM 回复预留的 token
    "keepRecentTokens": 20000  // 保留的近期 token（不被摘要）
  }
}
```

使用 `"enabled": false` 禁用自动压缩。你仍然可以用 `/compact` 手动压缩。
