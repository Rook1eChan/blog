---
tags: ['示例', 'demo', 'markdown']
summary: "这是一篇示例文章，用来展示这个博客支持的排版与代码高亮效果。A sample post demonstrating formatting and syntax highlighting."
---

# 你好，世界 · Hello, World

欢迎来到我的博客！这是第一篇文章。与其列一张干巴巴的功能清单，不如把它写成一篇**像样的长文**——顺便看看中文与英文混排、标题层级、引用、列表和代码块，真正读起来是什么感觉。

Welcome! Rather than shipping a bare feature list, I figured the first post should
read like an actual article: a chance to check how Chinese and Latin text sit
together, how the heading levels breathe, and whether long-form reading is
comfortable.

## 为什么写博客 · Why write

写作对我来说首先是**整理思路**的过程。很多时候，一个想法只有在被完整写出来之后，才会暴露出它含混的地方；读文献、跑实验时也一样——能讲清楚的，才是真的理解了。

Writing is, for me, mostly a way to think. An idea often looks fine until I try to
write it down, and that is exactly when its weak spots show up.

所以这个博客不打算追热点，也不指望每篇都「有用」。它更像我的**公开笔记本**：记录在信息检索、RAG 与机器学习上踩过的坑，也记录一些与工作无关、但当时觉得有意思的小事。

### 为什么中英混排 · Why mixed languages

我的日常阅读有一半是英文，笔记却是中文。技术上很多术语——比如 *retrieval-augmented generation*、`embedding`、`top-k`——用英文反而更精确，于是干脆两者都留着，不做生硬的翻译。

> 语言是工具，不是立场。
> A language is a tool, not an allegiance.

把中英混在一起，对排版其实是个考验：两种字体的**字面大小、行高与基线**如果对不齐，读起来就会很别扭。这也是我在这套主题上反复调整的原因。

## 这个博客里会写什么 · What to expect

大致会分成三类内容：

1. **技术笔记**：读论文、做实验时留下的结论与代码片段；
2. **工程记录**：一些偏实践的东西，比如怎么把服务跑起来、怎么排查一个奇怪的问题；
3. **随笔**：和学习无关，但我愿意花时间写下来的东西。

除此之外，偶尔也会有一些更短的想法，内容上更接近札记：

- 一段没有展开的推导；
  - 或者一个还没验证的猜想；
- 一条值得记住的命令；
- 一句别人说过的话，以及我为什么不同意。

### 关于代码 · On code

写代码是我工作的一部分，所以文章里少不了代码。下面这段是本站构建脚本的简化版本，顺带也演示一下语法高亮：

```python
from generator.builder import Builder


def build_site(output_dir: str = "_build") -> str:
    """把 Markdown 编译成静态 HTML，写到 output_dir。"""
    builder = Builder(output_dir=output_dir)
    builder.build()
    return builder.output_dir


if __name__ == "__main__":
    print(build_site())
```

在本地预览时，我更习惯用 `make` 里封装好的命令：

```bash
make build   # 构建静态站点
make serve   # 本地预览（含热重载）
```

## 工具与状态 · Tools and status

没什么花哨的东西，一张表大概就够了：

| 功能 | Feature | 状态 |
| --- | --- | :--: |
| 分页 | Pagination | ✅ |
| 标签 | Tags | ✅ |
| 归档 | Archive | ✅ |
| 订阅 | Atom / RSS | ✅ |
| 全文搜索 | Full-text search | ⏳ |

早期写在别处的一些笔记（~~内容已经过时~~）之后也可能会搬过来，重新整理一遍。

---

## 写在最后 · Closing

如果你能读到这里，说明这套排版至少没有把你劝退[^1]。接下来我会尽量保持更新，也尽量把每篇写完整，而不是留一堆半成品。

If you made it this far, the typography at least didn't scare you off. I'll try
to keep posting — and to finish what I start.

想更了解我的话，可以看看 [关于页面](/about/)；也欢迎在
[GitHub](https://github.com/Rook1eChan) 上找我。

[^1]: 脚注由 marko 的 footnote 扩展提供，用来放这种旁注刚刚好。
