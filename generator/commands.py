# -*- coding: utf-8 -*-
"""Entry points: ``build-blog`` and ``serve-blog``."""
import queue
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote

from generator.builder import Builder

HOST = "127.0.0.1"
PORT = 5001

RELOAD_SCRIPT = """
<script>
(function () {
  const es = new EventSource('%s/sse');
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
  es.onerror = () => setTimeout(() => location.reload(), 1000);
})();
</script>
"""


class LiveReloadHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, base_path="", **kwargs):
        self.base_path = base_path
        super().__init__(*args, **kwargs)

    def do_GET(self):
        if self.path == "/sse":
            return self.handle_sse()
        return self.handle_file()

    def handle_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(b"data: connected\n\n")
            self.wfile.flush()
            while not RELOAD_EVENT.wait(timeout=10):
                self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
            self.wfile.write(b"data: reload\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_file(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith(self.base_path):
            path = path[len(self.base_path):] or "/"
        file_path = path.lstrip("/") or "index.html"
        if file_path.endswith("/"):
            file_path += "index.html"
        full = Path(self.directory) / file_path
        if full.is_file() and file_path.endswith(".html"):
            content = full.read_text(encoding="utf-8")
            script = RELOAD_SCRIPT % self.base_path
            if "</body>" in content:
                content = content.replace("</body>", script + "</body>")
            else:
                content += script
            data = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            # Let the default handler resolve the (prefix-stripped) path.
            self.path = path
            super().do_GET()

    def log_message(self, *args):
        pass


RELOAD_EVENT = threading.Event()


def notify_reload():
    RELOAD_EVENT.set()
    threading.Timer(0.2, RELOAD_EVENT.clear).start()


def main_build():
    Builder().build()


def _watch_and_rebuild(builder):
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

    from generator.builder import TEMPLATE_DIR

    watch_dirs = [builder.content_dir, TEMPLATE_DIR]

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event):
            if event.is_directory:
                return
            # Ignore ''/'opened'/'closed' events: reading a file during the
            # build must not trigger another build (infinite loop).
            if getattr(event, "event_type", None) not in (
                "created", "modified", "deleted", "moved"
            ):
                return
            src = str(getattr(event, "src_path", ""))
            if "__pycache__" in src or "/_build/" in src:
                return
            try:
                builder.build()
                notify_reload()
            except Exception as exc:  # keep the server alive on errors
                print("Build error:", exc)

    observer = Observer()
    for path in watch_dirs:
        if path.exists():
            observer.schedule(Handler(), str(path), recursive=True)
    observer.start()
    return observer


def main_serve():
    builder = Builder()
    builder.build()
    observer = _watch_and_rebuild(builder)
    base_path = builder.env.globals["config"]["base_path"] or ""
    handler = lambda *a, **kw: LiveReloadHandler(*a, base_path=base_path,
                                                 directory=str(builder.output_dir), **kw)
    server = ThreadingHTTPServer((HOST, PORT), handler)
    server.allow_reuse_address = True
    print("Serving http://%s:%d%s/ (live reload on change)" % (HOST, PORT, base_path))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        observer.stop()
        observer.join()
