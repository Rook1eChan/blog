# -*- coding: utf-8 -*-
"""Simple pagination helper used by the index / tag pages."""


class Pagination:
    def __init__(self, items, per_page, page, url_key="page"):
        self.items = items
        self.per_page = per_page
        self.page = page
        self.url_key = url_key
        self.pages = max(1, (len(items) + per_page - 1) // per_page)

    @property
    def has_prev(self):
        return self.page > 1

    @property
    def has_next(self):
        return self.page < self.pages

    @property
    def prev_page(self):
        return self.page - 1

    @property
    def next_page(self):
        return self.page + 1

    def get_slice(self):
        start = (self.page - 1) * self.per_page
        return self.items[start:start + self.per_page]
