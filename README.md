# Rook1eChan's Blog

<https://rook1echan.github.io/blog/>

网站参考：[mitsuhiko/lucumr](https://github.com/mitsuhiko/lucumr)：
Markdown → Jinja2 模板 → 静态 HTML，通过 GitHub Actions 发布到 GitHub Pages。


## 目录结构

```
generator/          生成器 (Python 包)
  config.py         站点配置（标题、作者、网址、base_path ...）
  markup.py         Markdown → HTML 渲染
  builder.py        构建编排
  commands.py       build / serve 命令
  templates/        Jinja2 模板
blog/               内容
  posts/年/MM-DD-slug.md   文章（日期取自文件名）
  about.md          独立页面
  static/           样式等静态资源
_build/             构建产物（不要提交）
```

## 本地使用

```bash
pip install -r requirements.txt

make build   # 生成静态站点到 _build/
make serve   # 本地预览 http://127.0.0.1:5001/blog/（改动自动重建）
```

## 写一篇新文章

在 `blog/posts/2026/` 下新建 `MM-DD-标题.md`：

```markdown
---
tags: ['示例', 'demo']
summary: "一句话摘要，会显示在列表页。"
---

# 文章标题

正文……
```

## 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并发布到 GitHub Pages。
若换成根路径站点，把 `generator/config.py` 里的 `base_path` 改成 `""`
并更新 `site_url` 即可。

## 关于 `site_url` 与 `base_path`

上游 lucumr 部署在根域名 `https://lucumr.pocoo.org/`，配置里只有 `site_url`，
模板中所有链接都写死为根路径（如 `/static/style.css`）。

本站是 GitHub Pages 的**项目站**，挂在 `https://rook1echan.github.io/blog/`
子路径下，根路径 `/static/...` 会指到根站（另一个 Hugo 站点），因此移植时做了扩展：

- `base_path = "/blog"` 是所有站内链接的前缀，由 `url()` / `static_url()` 助手添加，
  模板与 Markdown 正文里的链接都走它们；
- `site_url` 则包含仓库路径，用于 canonical、`og:url`、feed 地址等绝对地址。

`site_url` 与 `base_path` 是**必须保持一致的两个来源**（都指向 `/blog`）。
`base_path` 可用环境变量 `BLOG_BASE_PATH` 覆盖，但它不会联动 `site_url`；
要改部署路径，两处都要改，否则页面里的绝对地址会与实际站内链接对不上。

（上游模板把域名 `https://lucumr.pocoo.org` 硬编码在 canonical / `og:url` 里，
改配置不会同步；本站统一走 `{{ config.site_url }}`，没有这个问题。）
