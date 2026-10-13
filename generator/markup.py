# -*- coding: utf-8 -*-
"""Markdown -> HTML rendering with Pygments highlighting and smartypants."""
import re

import marko
import smartypants
from marko.ext.gfm import GFM
from marko.ext import footnote
from marko.html_renderer import HTMLRenderer
from markupsafe import Markup

from pygments import highlight
from pygments.lexers import get_lexer_by_name, TextLexer
from pygments.formatters import HtmlFormatter
from pygments.styles import get_style_by_name

from generator.config import CONFIG

BASE_PATH = CONFIG["base_path"].rstrip("/")

html_formatter = HtmlFormatter(style=get_style_by_name(CONFIG["pygments_style"]))


def get_pygments_css():
    """Return CSS rules for highlighted code blocks."""
    return html_formatter.get_style_defs()


def highlight_code(code, language):
    try:
        lexer = get_lexer_by_name(language) if language else TextLexer()
    except ValueError:
        lexer = TextLexer()
    return highlight(code, lexer, html_formatter)


class PygmentsRenderer(HTMLRenderer):
    """Marko renderer that runs fenced code blocks through Pygments."""

    def render_fenced_code(self, element):
        code = element.children[0].children if element.children else ""
        if isinstance(code, str):
            language = getattr(element, "lang", None) or ""
            return highlight_code(code, language)
        return super().render_fenced_code(element)

    @staticmethod
    def escape_html(raw: str) -> str:
        # Keep quotes as-is so smartypants can do its thing later.
        return HTMLRenderer.escape_html(raw).replace("&quot;", '"')


markdown_parser = marko.Markdown(
    extensions=[GFM, footnote.make_extension()], renderer=PygmentsRenderer
)


def prefix_urls(html):
    """Rewrite root-relative links/images so they work under a sub-path.

    ``href="/about/"`` becomes ``href="/blog/about/"`` when base_path is
    ``/blog``. Already-prefixed and protocol-relative (``//``) URLs and
    external links are left untouched.
    """
    if not BASE_PATH:
        return html

    def _rewrite(match):
        attr, path = match.group(1), match.group(2)
        if path.startswith("//"):
            return match.group(0)
        if path == BASE_PATH or path.startswith(BASE_PATH + "/"):
            return match.group(0)
        return '%s="%s%s"' % (attr, BASE_PATH, path)

    return re.sub(r'(href|src)="(/[^"]*)"', _rewrite, html)


def markdown_to_html(content):
    """Convert Markdown to HTML and fix up internal links."""
    rendered = markdown_parser(content)
    rendered = smartypants.smartypants(rendered)
    return Markup(prefix_urls(rendered))


def extract_title_from_content(content):
    """Title is the first level-1 heading."""
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return markdown_to_html(line[2:].strip()).striptags()
    return None


def render_markdown(content):
    """Render a post body. The leading H1 is removed (rendered separately)."""
    filtered = []
    found_title = False
    for line in content.split("\n"):
        if not found_title and line.strip().startswith("# "):
            found_title = True
            continue
        filtered.append(line)
    return {
        "fragment": markdown_to_html("\n".join(filtered)),
    }


def render_summary(summary):
    if not summary:
        return ""
    return markdown_to_html(summary)
