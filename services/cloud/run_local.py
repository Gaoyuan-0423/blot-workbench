#!/usr/bin/env python3
"""Run the isolated development backend on loopback; no production changes."""
import argparse
import os
from pathlib import Path
from download import ROOT, install

ORIGINS = ["https://wisplab.top", "https://wb.wisplab.top", "https://pathology.wisplab.top", "https://pcr.wisplab.top", "https://gaoyuan-0423.github.io", "app://wisplab", "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5187", "http://localhost:5187"]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--data", type=Path, default=ROOT / ".runtime" / "data")
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        parser.error("Use an unprivileged loopback port (1024–65535)")
    binary = install(ROOT / ".runtime" / "bin")
    data = arguments.data.resolve()
    data.mkdir(parents=True, exist_ok=True)
    data.chmod(0o700)
    os.environ["WISPLAB_ENV"] = "development"
    os.environ.setdefault("WISPLAB_REGISTRATION", "open")
    os.execv(str(binary), [str(binary), "serve", "--hooksWatch=false", "--http=127.0.0.1:" + str(arguments.port), "--dir=" + str(data), "--hooksDir=" + str(ROOT / "pb_hooks"), "--migrationsDir=" + str(ROOT / "pb_migrations"), "--origins=" + ",".join(ORIGINS)])
