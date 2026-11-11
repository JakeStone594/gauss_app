#!/usr/bin/env python3
# Snapshot of linear_algebra/tools/gauss_gui.py (the Python reference engine), taken 2026-11-11.
# The JavaScript engine in web/engine.js is verified against THIS code via tools/golden.py.
"""A graphical front end for gauss.py — opens in your browser.

    python3 tools/gauss_gui.py                 start a local server and open the page
    python3 tools/gauss_gui.py --port 8765     use a fixed port (default 8765, or the next free one)
    python3 tools/gauss_gui.py --no-browser    just print the address

Everything runs on this machine. A small standard-library HTTP server, bound to 127.0.0.1 only,
serves the page from tools/gauss_gui/ and answers POST /api/solve by running the gauss.py engine —
the same engine as the command line, so the two always agree. No extra packages.

The page: a grid (or typed equations) → every row operation in the lecture's notation with the
pivot and the changed rows highlighted → echelon form → canonical form → the solution, checked
by substitution. Practice mode hides the steps and reveals them one at a time.

⚠ Same rule as the CLI: for CHECKING your own computation, not as the way you solve homework.
"""
import argparse
import contextlib
import io
import json
import multiprocessing
import os
import re
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sympy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gauss  # noqa: E402

STATIC = os.path.join(HERE, "gauss_gui")
FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}
MAX_LEN = 4000          # characters of input
MAX_DIM = 10            # rows, and coefficient columns
MAX_BODY = 20_000       # bytes of request
# Every character an entry or an equation may contain. The engine parses with sympy, which
# evaluates expressions, so the server is strict about what reaches it.
ALLOWED = re.compile(r"[0-9A-Za-z_+\-*/^().,;|=\s−·×]*")
# Powers: at most a two-digit exponent, and never chained (9^9^9^9 would run forever).
BIG_POWER = re.compile(r"(\^|\*\*)\s*\(?\s*-?\d{3,}|(\^|\*\*)[^,;|\s]*(\^|\*\*)")
TIMEOUT = 20            # seconds a single solve may take


# ─────────────────────────────── the engine, as JSON ───────────────────────────────

def analyse(text, system=False):
    """Run the engine on `text` and return a JSON-serialisable description of the whole run."""
    if len(text) > MAX_LEN:
        raise ValueError(f"input too long ({len(text)} characters; the limit is {MAX_LEN})")
    if not ALLOWED.fullmatch(text):
        ch = next(c for c in text if not ALLOWED.fullmatch(c))
        raise ValueError(f"the character {ch!r} is not allowed. Entries are numbers like 3, -1/2, 0.25, "
                         "2-3i, (1+i)/2; equations use letters for unknowns.")
    if BIG_POWER.search(text):
        raise ValueError("powers may have at most a two-digit exponent and cannot be chained")

    rows, bar, names = gauss.parse_matrix(text, system=system)
    if len(rows) > MAX_DIM or len(rows[0]) - (1 if bar is not None else 0) > MAX_DIM:
        raise ValueError(f"at most {MAX_DIM} rows and {MAX_DIM} columns (plus the right-hand side)")

    field = "ℂ" if any(sp.im(x) != 0 for r in rows for x in r) else "ℝ"
    red = gauss.Reducer(rows, bar, quiet=True)
    red.forward()
    red.backward()

    def F(M):
        return [[gauss.fmt(x) for x in row] for row in M]

    out = {
        "input": F(rows), "bar": bar, "names": names, "field": field,
        "rows": len(rows), "cols": len(rows[0]),
        "steps": [{"phase": s["phase"], "pivot": s["pivot"], "ops": s["ops"], "matrix": F(s["matrix"])}
                  for s in red.trace],
        "echelon": F(red.echelon), "canonical": F(red.A),
        "pivots": red.pivots, "rank": len(red.pivots),
    }
    if bar is not None:
        res = gauss.solution(red, rows)
        if res["status"] == "none":
            out["solution"] = {"status": "none", "row": F([res["row"]])[0],
                               "rhs": gauss.fmt(res["row"][bar])}
        else:
            sol, free, params = res["sol"], res["free"], res["params"]
            values = [gauss.lin(*sol[c]) for c in range(bar)]
            ps = [params[f] for f in free]
            out["solution"] = {
                "status": res["status"], "values": values,
                "free": [names[f] for f in free], "params": ps,
                "set": "S = {(" + ", ".join(values) + ")" + (f" | {', '.join(ps)} ∈ {field}" if free else "") + "}",
                "example": [gauss.fmt(sol[c][0]) for c in range(bar)] if free else None,
                "ok": res["ok"],
            }
    out["text"] = cli_text(text, system)
    return out


def cli_text(text, system):
    """The command-line tool's own output for the same input — for 'copy as text'."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        try:
            gauss.main((["-s"] if system else []) + [text])
        except SystemExit:
            pass
    return buf.getvalue()


# ─────────────────────────────── a worker with a time limit ───────────────────────────────
# The engine runs in a separate process. If an input makes it run away, the process is killed
# and replaced, and the page gets an error instead of a spinner that never stops.

_ctx = multiprocessing.get_context("spawn")
_lock = threading.Lock()
_pool = None


def _pool_get():
    global _pool
    if _pool is None:
        _pool = _ctx.Pool(1)
    return _pool


def _pool_reset():
    global _pool
    if _pool is not None:
        _pool.terminate()
        _pool = None


def analyse_safely(text, system=False):
    with _lock:
        try:
            return _pool_get().apply_async(analyse, (text, system)).get(timeout=TIMEOUT)
        except multiprocessing.TimeoutError:
            _pool_reset()
            raise ValueError(f"gave up after {TIMEOUT} seconds — this input is too heavy for an exact "
                             "calculator") from None


# ─────────────────────────────── the server ───────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):   # keep the terminal quiet
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path not in FILES:
            return self._send(404, "text/plain; charset=utf-8", b"not found")
        name, ctype = FILES[path]
        with open(os.path.join(STATIC, name), "rb") as f:
            self._send(200, ctype, f.read())

    def do_POST(self):
        if self.path != "/api/solve":
            return self._send(404, "text/plain; charset=utf-8", b"not found")
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"error": "request too large"})
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            self._json(200, analyse_safely(str(req.get("text", "")), bool(req.get("system"))))
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 — report, never crash the server
            self._json(500, {"error": f"internal error — {e.__class__.__name__}: {e}"})

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Browser GUI for the Gaussian-elimination calculator.")
    ap.add_argument("--port", type=int, default=8765, help="port to listen on (default 8765)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    a = ap.parse_args(argv)

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)   # port busy: take any free one
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"Gauss calculator: {url}   (Ctrl+C stops it)")
    _pool_get()   # start the worker now, so the first solve is as fast as the rest
    if not a.no_browser:
        threading.Timer(0.4, webbrowser.open, [url]).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        _pool_reset()


if __name__ == "__main__":
    main()
