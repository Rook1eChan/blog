# -*- coding: utf-8 -*-
"""The static site builder.

Walks ``blog/`` (posts + standalone pages), renders them through the
Jinja2 templates in ``generator/templates`` and writes a fully static site
into ``_build/``.

The templates are closely modelled on `mitsuhiko/lucumr` (same HTML
structure and CSS class names), but every URL is emitted through ``url()`` /
``static_url()`` so the whole site can live under a sub-path (``/blog``).
"""
import re
import shutil
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup, escape

from generator.config import CONFIG, IGNORE_PATTERNS
from generator.markup import (
    extract_title_from_content,
    render_markdown,
    render_summary,
    get_pygments_css,
)
from generator.pagination import Pagination

TEMPLATE_DIR = Path(__file__).parent / "templates"
BASE_PATH = CONFIG["base_path"].rstrip("/")
SITE_URL = CONFIG["site_url"]

_LEADING_ZERO = re.compile(r"posts/(\d{4})/(\d{2})-(\d{2})-(.+)$")

MONTH_NAMES = {
    1: "1 月", 2: "2 月", 3: "3 月", 4: "4 月", 5: "5 月", 6: "6 月",
    7: "7 月", 8: "8 月", 9: "9 月", 10: "10 月", 11: "11 月", 12: "12 月",
}


class BlogPost:
    """A single post parsed from a Markdown file."""

    def __init__(self, source_path, content):
        self.source_path = source_path
        self.is_page = "/posts/" not in source_path.replace("\\", "/")
        self.title = "Untitled"
        self.summary = None
        self.pub_date = None
        self.tags = []
        self.content = content

        frontmatter, body = self._split_frontmatter(content)
        self.tags = frontmatter.get("tags", []) or []
        self.summary = frontmatter.get("summary")
        if frontmatter.get("date"):
            self.pub_date = self._coerce_date(frontmatter["date"])
        self.content = body

        extracted = extract_title_from_content(self.content)
        if extracted:
            self.title = extracted

        if self.pub_date is None:
            self._date_from_path()

    # -- parsing ---------------------------------------------------------
    @staticmethod
    def _split_frontmatter(content):
        lines = content.split("\n")
        if lines and lines[0].strip() == "---":
            for i, line in enumerate(lines[1:], 1):
                if line.strip() == "---":
                    raw = "\n".join(lines[1:i])
                    data = yaml.safe_load(raw) or {}
                    return data, "\n".join(lines[i + 1:])
        return {}, content

    @staticmethod
    def _coerce_date(value):
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value))
        except ValueError:
            return None

    def _date_from_path(self):
        normalized = self.source_path.replace("\\", "/")
        match = _LEADING_ZERO.search(normalized)
        if match:
            year, month, day, _ = match.groups()
            self.pub_date = datetime(int(year), int(month), int(day))

    # -- URLs ------------------------------------------------------------
    @property
    def slug(self):
        if self.pub_date:
            normalized = self.source_path.replace("\\", "/")
            match = _LEADING_ZERO.search(normalized)
            base = Path(match.group(4)).stem if match else Path(normalized).stem
            d = self.pub_date
            return "/%d/%d/%d/%s/" % (d.year, d.month, d.day, base)
        rel = Path(self.source_path).with_suffix("").as_posix()
        return "/%s/" % rel

    @property
    def output_rel(self):
        return self.slug.strip("/") + "/index.html"

    # -- rendering -------------------------------------------------------
    def render_body(self):
        return render_markdown(self.content)["fragment"]

    def render_summary(self):
        return render_summary(self.summary)

    def content_dict(self):
        """The ``content`` object the content_display template expects."""
        html_title = Markup("<h1>%s</h1>" % escape(self.title))
        return {
            "title": self.title,
            "html_title": html_title,
            "fragment": self.render_body(),
        }


class Builder:
    def __init__(self):
        self.base = Path.cwd()
        self.content_dir = self.base / CONFIG["content_folder"]
        self.static_dir = self.content_dir / CONFIG["static_folder"]
        self.output_dir = self.base / CONFIG["output_folder"]
        self.posts = []
        self.pages = []
        self.by_tag = {}
        self.env = Environment(
            loader=FileSystemLoader(str(TEMPLATE_DIR)),
            autoescape=True,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        self._install_helpers()

    # -- template helpers -------------------------------------------------
    def _install_helpers(self):
        def url(path):
            if not path.startswith("/"):
                path = "/" + path
            if BASE_PATH and not (path == BASE_PATH or path.startswith(BASE_PATH + "/")):
                path = BASE_PATH + path
            return path

        def static_url(path):
            return url("/%s/%s" % (CONFIG["static_folder"], path.lstrip("/")))

        def link_to(name, **kw):
            if "slug" in kw:
                return url(kw["slug"])
            if "page" in kw:
                n = kw["page"]
                return url("/") if n <= 1 else url("/page/%d/" % n)
            if name == "tag" or "tag" in kw:
                return url("/tags/%s/" % kw["tag"])
            if name == "blog_archive":
                year, month = kw.get("year"), kw.get("month")
                if month:
                    return url("/%s/%s/" % (year, month))
                if year:
                    return url("/%s/" % year)
                return url("/archive/")
            if name in ("tagcloud", "tags"):
                return url("/tags/")
            if name == "archive":
                return url("/archive/")
            return url("/")

        def format_date(dt=None, format="medium"):
            if dt is None:
                dt = datetime.now()
            if format == "YYYY":
                return dt.strftime("%Y")
            if format in ("long", "full"):
                return "%d 年 %d 月 %d 日" % (dt.year, dt.month, dt.day)
            return "%04d-%02d-%02d" % (dt.year, dt.month, dt.day)

        def get_tags(limit=None):
            counts = {}
            for post in self.posts:
                for tag in post.tags:
                    counts[tag] = counts.get(tag, 0) + 1
            if not counts:
                return []
            max_count = max(counts.values())
            result = []
            for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
                result.append({
                    "name": name,
                    "count": count,
                    "size": 100 + int(60 * (count / max_count)),
                })
            return result[:limit] if limit else result

        self.env.globals.update(
            config=CONFIG,
            url=url,
            static_url=static_url,
            link_to=link_to,
            format_date=format_date,
            get_tags=get_tags,
            now=datetime.now(timezone.utc),
            current_year=datetime.now().year,
            links=[],
            social_image_url=None,
            slug="",
        )

    # -- content loading --------------------------------------------------
    @staticmethod
    def _ignored(name):
        return any(fnmatch(name, pat) for pat in IGNORE_PATTERNS)

    def load_posts(self):
        self.posts = []
        self.pages = []
        self.by_tag = {}
        posts_dir = self.content_dir / CONFIG["posts_folder"]
        if posts_dir.exists():
            for path in sorted(posts_dir.rglob("*.md")):
                rel_parts = path.relative_to(posts_dir).parts
                if any(part.startswith(".") or part.startswith("_")
                       for part in rel_parts):
                    continue
                if self._ignored(path.name):
                    continue
                rel = path.relative_to(self.base).as_posix()
                post = BlogPost(rel, path.read_text(encoding="utf-8"))
                self.posts.append(post)

        # top-level standalone pages (about.md, ...)
        for path in sorted(self.content_dir.glob("*.md")):
            if self._ignored(path.name):
                continue
            rel = path.relative_to(self.content_dir).as_posix()
            page = BlogPost(rel, path.read_text(encoding="utf-8"))
            self.pages.append((page.slug.strip("/"), page))

        self.posts.sort(key=lambda p: (p.pub_date or datetime.min), reverse=True)
        for post in self.posts:
            for tag in post.tags:
                self.by_tag.setdefault(tag, []).append(post)

    # -- writers ----------------------------------------------------------
    def _write(self, rel, html):
        out = self.output_dir / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")

    def _context(self, **extra):
        ctx = {"config": CONFIG}
        ctx.update(extra)
        return ctx

    def build(self):
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)
        self.output_dir.mkdir(parents=True)
        self.load_posts()

        self.build_posts()
        self.build_pages()
        self.build_index()
        self.build_archive()
        self.build_tags()
        self.build_feeds()
        self.build_404()
        self.copy_static()
        self.write_pygments_css()
        print("Built %d posts, %d pages -> %s"
              % (len(self.posts), len(self.pages), self.output_dir))

    def _render_content(self, obj, slug, is_page=False):
        template = self.env.get_template("content_display.html")
        return template.render(**self._context(
            content=obj.content_dict(),
            ctx=obj,
            slug=slug,
            social_image_url=None,
            is_page=is_page,
        ))

    def build_posts(self):
        for post in self.posts:
            self._write(post.output_rel, self._render_content(post, post.slug))
            # raw markdown, for the "copy / view markdown" links
            md_rel = post.slug.strip("/") + ".md"
            self._write(md_rel, post.content.lstrip("\n"))

    def build_pages(self):
        for slug, page in self.pages:
            self._write("%s/index.html" % slug,
                        self._render_content(page, "/%s/" % slug, is_page=True))

    def build_index(self):
        template = self.env.get_template("blog/index.html")
        per_page = CONFIG["posts_per_page"]
        total_pages = max(1, (len(self.posts) + per_page - 1) // per_page)
        for page_num in range(1, total_pages + 1):
            pagination = Pagination(self.posts, per_page, page_num)
            html = template.render(**self._context(
                pagination=pagination,
                show_pagination=total_pages > 1,
                slug="/" if page_num == 1 else "/page/%d/" % page_num,
            ))
            if page_num == 1:
                self._write("index.html", html)
            else:
                self._write("page/%d/index.html" % page_num, html)

    def build_archive(self):
        # group posts by year -> month
        years = {}
        for post in self.posts:
            if not post.pub_date:
                continue
            years.setdefault(post.pub_date.year, {}).setdefault(
                post.pub_date.month, []).append(post)

        archive = []
        for year in sorted(years, reverse=True):
            months = []
            for month in sorted(years[year], reverse=True):
                months.append({
                    "month": month,
                    "month_name": MONTH_NAMES[month],
                    "count": len(years[year][month]),
                })
            archive.append({"year": year, "months": months})

        archive_template = self.env.get_template("blog/archive.html")
        self._write("archive/index.html", archive_template.render(**self._context(
            archive=archive, entry=None, slug="/archive/",
        )))

        year_template = self.env.get_template("blog/year_archive.html")
        month_template = self.env.get_template("blog/month_archive.html")
        for year in sorted(years, reverse=True):
            months = []
            for month in sorted(years[year], reverse=True):
                entries = sorted(years[year][month],
                                 key=lambda p: p.pub_date, reverse=True)
                months.append({
                    "month": month,
                    "month_name": MONTH_NAMES[month],
                    "entries": entries,
                })
                self._write("%d/%d/index.html" % (year, month),
                            month_template.render(**self._context(
                                entry={"year": year,
                                       "month_name": MONTH_NAMES[month],
                                       "entries": entries},
                                slug="/%d/%d/" % (year, month),
                            )))
            self._write("%d/index.html" % year, year_template.render(**self._context(
                entry={"year": year, "months": months},
                slug="/%d/" % year,
            )))

    def build_tags(self):
        cloud = self.env.get_template("tagcloud.html")
        self._write("tags/index.html", cloud.render(**self._context(slug="/tags/")))

        tag_template = self.env.get_template("tag.html")
        for tag, entries in self.by_tag.items():
            entries = sorted(entries, key=lambda p: (p.pub_date or datetime.min),
                             reverse=True)
            self._write("tags/%s/index.html" % tag, tag_template.render(**self._context(
                tag={"name": tag, "count": len(entries)},
                entries=entries,
                slug="/tags/%s/" % tag,
            )))

    def build_feeds(self):
        atom = self.env.get_template("feed.atom")
        rss = self.env.get_template("feed.xml")
        dated = [p for p in self.posts if p.pub_date]
        recent = dated[:CONFIG["feed_count"]]
        self._write("feed.atom", atom.render(**self._context(posts=recent)))
        self._write("feed.xml", rss.render(**self._context(posts=recent)))

    def build_404(self):
        template = self.env.get_template("404.html")
        self._write("404/index.html", template.render(**self._context(slug="/404/")))

    def copy_static(self):
        if self.static_dir.exists():
            shutil.copytree(
                self.static_dir,
                self.output_dir / CONFIG["static_folder"],
                dirs_exist_ok=True,
            )

    def write_pygments_css(self):
        (self.output_dir / CONFIG["static_folder"]).mkdir(parents=True, exist_ok=True)
        (self.output_dir / CONFIG["static_folder"] / "_pygments.css").write_text(
            get_pygments_css(), encoding="utf-8")
