#!/usr/bin/env python3
"""Static dev server for questlog.

python3's http.server is almost enough, but it lets the browser cache ES
modules, which makes an edit look like it did nothing. This serves the same
files with no-store and the right MIME types.

    python3 tools/serve.py [port] [host]

Pass 0.0.0.0 as the host to reach it from another device on the same network
(http://<your-mac-ip>:8123). Note that a service worker will not install over
plain http on a phone, so that mode is for a quick look, not offline use.
"""
import http.server
import os
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    handler = partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"questlog dev server: http://localhost:{port}/  (root: {ROOT})")
        print(f"tests:               http://localhost:{port}/tests/run.html")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
