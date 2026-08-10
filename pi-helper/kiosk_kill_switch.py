#!/usr/bin/env python3
"""
Kiosk local-control helper.

Runs on the Pi itself, listening ONLY on 127.0.0.1 — never reachable from
the network. The kiosk/admin pages (served from your home server) call this
via a plain fetch() to localhost for two things:
  - killing Chromium (the hidden exit-kiosk gesture)
  - toggling the onboard on-screen keyboard's visibility (since Chromium's
    accessibility auto-show is unreliable, this uses onboard's own D-Bus API
    directly instead)

Deliberately uses only the Python standard library (http.server) so there's
nothing to pip install on the Pi.
"""
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 8765


class ControlHandler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        # Chromium is displaying a page served from the home server (a
        # different origin than localhost), so the browser will send a
        # preflight/cross-origin request. Allow it — this endpoint is only
        # reachable from the Pi itself anyway, since we bind to 127.0.0.1.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _respond(self, status, body=b"ok"):
        self.send_response(status)
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/kill-kiosk":
            subprocess.run(["pkill", "-9", "-f", "chromium"])
            self._respond(200)
        elif self.path == "/toggle-keyboard":
            result = subprocess.run(
                [
                    "dbus-send",
                    "--type=method_call",
                    "--dest=org.onboard.Onboard",
                    "/org/onboard/Onboard/Keyboard",
                    "org.onboard.Onboard.Keyboard.ToggleVisible",
                ],
                capture_output=True,
            )
            if result.returncode == 0:
                self._respond(200)
            else:
                # Most likely cause: onboard isn't running in the background.
                self._respond(500, result.stderr or b"onboard not reachable")
        else:
            self._respond(404, b"not found")

    def log_message(self, format, *args):
        pass  # keep the journal quiet; this fires rarely and isn't interesting


if __name__ == "__main__":
    HTTPServer((HOST, PORT), ControlHandler).serve_forever()
