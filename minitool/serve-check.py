"""Browser debugging only: restrictive HTTP CSP; not a XHS container emulator."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT = Path(__file__).resolve().parent / 'dist'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'")
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
ThreadingHTTPServer(('127.0.0.1', 5412), Handler).serve_forever()
