# -*- coding: utf-8 -*-
"""Site configuration. Everything site-specific lives here."""
import os

CONFIG = {
    # --- 站点基本信息 ---
    "site_title": "NotaRook1e",
    "author": "Rook1eChan",
    "subtitle": "记录学习与思考的地方 · Notes on learning and thinking",
    "description": "Rook1eChan 的个人博客：机器学习、信息检索、RAG 与日常思考。",
    "language": "zh-CN",

    # --- 网址相关 ---
    # 项目站部署在 https://<user>.github.io/<repo>/ ，所以 base_path = "/<repo>"
    # 若改成用户站(根路径)，把 base_path 设为 "" 并修改 site_url。
    "site_url": "https://rook1echan.github.io/blog/",
    "base_path": os.environ.get("BLOG_BASE_PATH", "/blog"),

    # --- 构建相关 ---
    "content_folder": "blog",
    "static_folder": "static",
    "output_folder": "_build",
    "posts_folder": "posts",
    "posts_per_page": 10,
    "feed_count": 20,
    "pygments_style": "tango",

    # --- 导航 (顺序即显示顺序) ---
    "navigation": [
        ("/", "博客", "blog"),
        ("/archive/", "归档", "archive"),
        ("/tags/", "标签", "tags"),
        ("/about/", "关于", "about"),
    ],
}

# 需要忽略的顶层文件/目录 (fnmatch 模式)
IGNORE_PATTERNS = (
    ".*",
    "_*",
    "Makefile",
    "README*",
    "CNAME",
    "*.conf",
)
