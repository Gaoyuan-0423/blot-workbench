#!/usr/bin/env python3
"""Fetch only the pinned official release; verify archive before extracting."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / "pocketbase.lock.json").read_text())


def host_platform():
    system = {"Darwin": "darwin", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64", "AMD64": "amd64"}.get(platform.machine())
    if not system or not arch:
        raise RuntimeError("Unsupported platform: specify a pinned --platform")
    return f"{system}_{arch}"


def install(destination, target=None):
    target = target or host_platform()
    asset = LOCK["assets"][target]
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    name = "pocketbase.exe" if target.startswith("windows_") else "pocketbase"
    binary = destination / name
    marker = destination / "installed.json"
    if binary.is_file() and marker.is_file():
        installed = json.loads(marker.read_text())
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        if installed == {"version": LOCK["version"], "platform": target, "binarySha256": digest, "archiveSha256": asset["sha256"]}:
            return binary
        raise RuntimeError("Existing binary differs from its verified installation; use a new destination")
    with tempfile.TemporaryDirectory(prefix="wisplab-pb-download-") as temporary:
        archive = Path(temporary) / "release.zip"
        urls = [asset["url"]]
        if asset.get("apiUrl"):
            urls.append(asset["apiUrl"])
        for url in urls:
            args = ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2", "--connect-timeout", "15", "--max-time", "600", "--output", str(archive)]
            if "api.github.com" in url:
                args += ["--header", "Accept: application/octet-stream"]
            result = subprocess.run(args + [url], check=False)
            if result.returncode == 0:
                break
        else:
            raise RuntimeError("Official PocketBase download failed")
        if hashlib.sha256(archive.read_bytes()).hexdigest() != asset["sha256"]:
            raise RuntimeError("PocketBase SHA-256 mismatch; binary was not installed")
        with zipfile.ZipFile(archive) as package:
            info = package.getinfo(name)
            if info.file_size > 128 * 1024 * 1024:
                raise RuntimeError("Unexpected binary size")
            content = package.read(name)
        pending = destination / (name + ".new")
        pending.write_bytes(content)
        pending.chmod(0o755)
        os.replace(pending, binary)
        marker.write_text(json.dumps({"version": LOCK["version"], "platform": target, "binarySha256": hashlib.sha256(content).hexdigest(), "archiveSha256": asset["sha256"]}, indent=2) + "\n")
    return binary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".runtime" / "bin")
    parser.add_argument("--platform", choices=list(LOCK["assets"]))
    arguments = parser.parse_args()
    print(install(arguments.output, arguments.platform))
