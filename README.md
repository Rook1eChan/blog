# Rook1eChan's Blog

个人博客，部署在 <https://rook1echan.github.io/blog/>。

这是一个用 Python 写的小型静态站点生成器，结构参考了
[mitsuhiko/lucumr](https://github.com/mitsuhiko/lucumr)：
Markdown → Jinja2 模板 → 静态 HTML，通过 GitHub Actions 发布到 GitHub Pages。

## 特性

- Markdown（GFM + 脚注）+ Pygments 代码高亮 + smartypants 排版
- YAML front matter（`tags` / `summary`），标题取正文首个一级标题
- 首页分页、归档页、标签云与标签页
- Atom 与 RSS 订阅
- 支持子路径部署（`base_path = "/blog"`，项目站也能正确生成链接）
- 本地开发服务器，带热重载

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
