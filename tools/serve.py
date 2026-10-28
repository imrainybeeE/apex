#!/usr/bin/env python3
"""Dev server for Apex: plain static files with caching off, so a reload always picks up edited CSS and JS.
Usage: python3 tools/serve.py [port]   (default 8642)"""
import http.server, os, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
