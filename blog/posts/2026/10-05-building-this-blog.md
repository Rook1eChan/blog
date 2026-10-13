---
tags: ['demo', 'python', '随笔']
summary: "这篇短文简单说明了本站是怎么构建和部署的。"
---

# 这个博客是怎么搭的 · How this blog is built

本站没有用 Jekyll / Hugo，而是照着 [lucumr](https://github.com/mitsuhiko/lucumr)
写了一套很小的 Python 静态站点生成器。

## 流程 · Pipeline

1. 把 Markdown 文章放在 `blog/posts/年/月-日-slug.md`
2. 生成器用 `marko` + `Pygments` 渲染成 HTML，套上 Jinja2 模板
3. 输出到 `_build/`，再由 GitHub Actions 发布到 GitHub Pages

```python
# 本地构建 / 预览
# make build
# make serve
```

详见仓库的 `README.md`。
