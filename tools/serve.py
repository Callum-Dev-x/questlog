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
import json
import os
import re
import sys
import threading
from datetime import datetime, timezone
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- sync emulator ------------------------------------------------------
# Mirrors worker/sync-worker.js so the sync flow can be exercised (and tested)
# locally, with no Cloudflare account and no deploy. In-memory: restarting the
# server empties it, which is fine for a dev aid.

KEY_RE = re.compile(r"^[a-z0-9]{24,64}$")
DOC_PATH = re.compile(r"^/v1/doc/([^/]+)$")
MAX_BYTES = 2_000_000
_docs = {}
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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

    # ---- sync emulator routes -------------------------------------------

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _doc_key(self):
        match = DOC_PATH.match(self.path)
        return match.group(1) if match else None

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_PUT(self):  # noqa: N802
        key = self._doc_key()
        if not key:
            self._send_json({"error": "not found"}, 404)
            return
        if not KEY_RE.match(key):
            self._send_json({"error": "invalid key"}, 400)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BYTES:
            self._send_json({"error": "document too large"}, 413)
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._send_json({"error": "body was not valid JSON"}, 400)
            return
        if not isinstance(body.get("doc"), dict):
            self._send_json({"error": "no document supplied"}, 400)
            return

        with _lock:
            existing = _docs.get(key)
            current = existing["version"] if existing else 0
            base = body.get("baseVersion") or 0
            if existing and base != current:
                self._send_json({"error": "version conflict", "version": current}, 409)
                return
            record = {"version": current + 1, "updatedAt": _now(), "doc": body["doc"]}
            _docs[key] = record
        self._send_json({"version": record["version"], "updatedAt": record["updatedAt"]})

    def do_GET(self):  # noqa: N802
        key = self._doc_key()
        if key is not None:
            if not KEY_RE.match(key):
                self._send_json({"error": "invalid key"}, 400)
                return
            with _lock:
                record = _docs.get(key)
            if not record:
                self._send_json({"error": "not found"}, 404)
                return
            self._send_json(record)
            return
        super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    handler = partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"questlog dev server: http://localhost:{port}/  (root: {ROOT})")
        print(f"tests:               http://localhost:{port}/tests/run.html")
        print(f"sync emulator:       http://localhost:{port}/v1/doc/<key>  (in-memory)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
