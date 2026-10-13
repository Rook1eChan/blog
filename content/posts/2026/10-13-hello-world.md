---
tags: ['示例', 'demo', 'markdown']
summary: "这是一篇示例文章，用来展示这个博客支持的排版与代码高亮效果。A sample post demonstrating formatting and syntax highlighting."
---

# 你好，世界 · Hello, World

欢迎来到我的博客！这是第一篇文章，用来演示站点的**格式渲染**效果。
Welcome! This first post is a quick tour of how content renders here.

## 支持 Markdown 与 GFM 扩展

普通段落、**加粗**、*斜体*、~~删除线~~、`行内代码`，以及
[站内链接](/about/) 和 [外部链接](https://github.com/Rook1eChan)。

### 列表

- 无序列表项一
- 无序列表项二
  - 嵌套项

1. 有序列表
2. 第二项

### 引用块

> 记录学习与思考的地方。
> Notes on learning and thinking.

## 代码高亮

行内 `const x = 1`，以及代码块：

```python
from generator.builder import Builder


def build_site():
    """Build the static site into _build/."""
    builder = Builder()
    builder.build()
    return builder.output_dir


if __name__ == "__main__":
    print(build_site())
```

也可以用其它语言 —— Bash：

```bash
make build   # 构建静态站点
make serve   # 本地预览 (含热重载)
```

## 表格

| 功能 | Feature | 状态 |
| --- | --- | :--: |
| 分页 | Pagination | ✅ |
| 标签 | Tags | ✅ |
| 归档 | Archive | ✅ |
| 订阅 | Atom / RSS | ✅ |

## 脚注

这段文字有一个脚注引用[^1]。

[^1]: 脚注由 marko 的 footnote 扩展提供。

---

以上就是全部演示。想继续了解我，可以看 [关于页面](/about/)。
