#!/usr/bin/env python3
"""Deploy a checked WispLab static release without replacing existing Caddy sites.

Run on the server as root after downloading the public release archive:
  python3 deploy.py --archive /tmp/release.tar.gz --sha256 <64 hex> --version <id>
Use --check-only to validate the archive locally without changing the server.
This script never downloads files, reads keys, installs services, or edits DNS.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid

SITES = {"portal": "wisplab.top", "wb": "wb.wisplab.top",
         "pathology": "pathology.wisplab.top", "pcr": "pcr.wisplab.top"}
OWNER = "wisplab-deploy-v1"
VERSION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
STATIC_SUFFIXES = {".html", ".css", ".js", ".mjs", ".wasm", ".json", ".txt",
                   ".md", ".csv", ".tsv", ".rdml", ".xml", ".xlsx", ".zip",
                   ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
                   ".tif", ".tiff", ".pdf", ".woff", ".woff2", ".ttf", ".otf"}
FORBIDDEN_PARTS = {"src", "node_modules", ".git", ".env", "secrets", "private",
                   "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                   "secret.json", "secrets.json", "credentials.json", "credentials.txt"}
MAX_FILES = 50000
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


class DeployError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def verified_tar(archive: Path, expected_sha: str):
    """Hash and read the same non-symlink descriptor, then detect in-place changes."""
    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise DeployError("Archive must be a regular local file")
        def digest_source():
            digest = hashlib.sha256()
            source.seek(0)
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
        if digest_source() != expected_sha:
            raise DeployError("Archive SHA256 mismatch")
        source.seek(0)
        with tarfile.open(fileobj=source, mode="r:gz") as package:
            yield package
        if digest_source() != expected_sha:
            raise DeployError("Archive changed while it was being read")


def safe_path(name: str) -> PurePosixPath:
    if (not isinstance(name, str) or not name or "\\" in name
            or any(ord(char) < 32 for char in name)):
        raise DeployError(f"Unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in name.split("/")):
        raise DeployError(f"Unsafe archive path: {name!r}")
    if any(part.startswith(".") or part.lower() in FORBIDDEN_PARTS for part in path.parts):
        raise DeployError(f"Hidden/source/secret path is not permitted: {name!r}")
    return path


def file_path(name: str) -> PurePosixPath:
    path = safe_path(name)
    if name == "release.json":
        return path
    if len(path.parts) < 2 or path.parts[0] not in SITES:
        raise DeployError(f"Unexpected archive root: {name!r}")
    if path.suffix.lower() not in STATIC_SUFFIXES:
        raise DeployError(f"Not an approved static file type: {name!r}")
    return path


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DeployError(f"Duplicate JSON key: {key!r}")
        result[key] = value
    return result


def load_json(data: bytes):
    try:
        return json.loads(data, object_pairs_hook=reject_duplicate_keys)
    except (ValueError, UnicodeError) as error:
        raise DeployError(f"Invalid JSON: {error}") from error


def read_archive(archive: Path, expected_sha: str, version: str, destination: Path | None = None):
    """Verify every byte against checksum + manifest; manually extract regular files only."""
    if not SHA_RE.fullmatch(expected_sha) or not VERSION_RE.fullmatch(version):
        raise DeployError("SHA256 or version has an invalid format")
    if archive.is_symlink() or not archive.is_file():
        raise DeployError("Archive must be a regular local file, not a symlink")
    seen = set()
    hashes = {}
    manifest = None
    total = 0
    with verified_tar(archive, expected_sha) as package:
        for index, member in enumerate(package):
            if index >= MAX_FILES:
                raise DeployError("Archive contains too many entries")
            name = member.name.rstrip("/") if member.isdir() else member.name
            path = safe_path(name)
            if name in seen:
                raise DeployError(f"Duplicate archive entry: {name}")
            seen.add(name)
            if member.isdir():
                if path.parts[0] not in SITES:
                    raise DeployError(f"Unexpected directory: {name}")
                continue
            if not member.isfile() or member.issparse():
                raise DeployError(f"Only regular files and directories are accepted: {name}")
            path = file_path(name)
            total += member.size
            if member.size < 0 or member.size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                raise DeployError("Archive exceeds extraction size limits")
            if name == "release.json" and member.size > 16 * 1024 * 1024:
                raise DeployError("Release manifest is too large")
            source = package.extractfile(member)
            if source is None:
                raise DeployError(f"Cannot read archive member: {name}")
            digest = hashlib.sha256()
            manifest_chunks = []
            output = None
            try:
                if destination is not None:
                    target = destination.joinpath(*path.parts)
                    target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                    output = target.open("xb")
                with source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                        if output is not None:
                            output.write(chunk)
                        if name == "release.json":
                            manifest_chunks.append(chunk)
                if output is not None:
                    output.close()
                    output = None
                    target.chmod(0o644)
                hashes[name] = digest.hexdigest()
                if name == "release.json":
                    manifest = load_json(b"".join(manifest_chunks))
            finally:
                if output is not None:
                    output.close()
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("version") != version:
        raise DeployError("release.json must have schemaVersion 1 and the requested version")
    sites = manifest.get("sites")
    if not isinstance(sites, dict) or set(sites) != set(SITES):
        raise DeployError("Manifest must describe exactly portal/wb/pathology/pcr")
    expected = {}
    for site, info in sites.items():
        if not isinstance(info, dict) or not isinstance(info.get("files"), dict) or "index.html" not in info["files"]:
            raise DeployError(f"Manifest requires {site}/index.html and file checksums")
        if site != "portal" and not re.fullmatch(r"[a-fA-F0-9]{40}", str(info.get("gitSha", ""))):
            raise DeployError(f"Manifest requires a full source Git SHA for {site}")
        for relative, digest in info["files"].items():
            safe_path(relative)
            name = f"{site}/{relative}"
            file_path(name)
            if not isinstance(digest, str) or not SHA_RE.fullmatch(digest):
                raise DeployError(f"Invalid file checksum for {name}")
            expected[name] = digest
    actual = {name: digest for name, digest in hashes.items() if name != "release.json"}
    if actual != expected:
        changed = sorted(name for name in set(actual) | set(expected) if actual.get(name) != expected.get(name))
        raise DeployError(f"Manifest/files mismatch: {', '.join(changed[:10])}")
    return manifest, hashes


def atomic_write(path: Path, data: bytes, mode=0o644, owner=None):
    temp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp, mode)
        if owner is not None:
            os.chown(temp, *owner)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def atomic_symlink(path: Path, target: Path):
    temp = path.parent / f".{path.name}.{uuid.uuid4().hex}.next"
    try:
        os.symlink(str(target), temp)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def regular(path: Path):
    if not path.exists() or path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
        raise DeployError(f"Expected an existing regular file: {path}")


def no_symlink_ancestors(path: Path):
    for component in [path, *path.parents]:
        if component.is_symlink():
            raise DeployError(f"Refusing symlinked deployment/config path: {component}")


def caddy_snippet(base: Path) -> bytes:
    blocks = [f"# Managed by {OWNER}; static files only; preserve the main Caddyfile.\n"]
    for site, domain in SITES.items():
        blocks.append(f'''{domain} {{
    encode zstd gzip
    header Cache-Control "no-cache"
    handle /release.json {{
        root * {base}/current
        file_server
    }}
    handle {{
        root * {base}/current/{site}
        file_server
    }}
}}
''')
    return "\n".join(blocks).encode()


class Deployment:
    """Paths and command runner are injectable for filesystem-only simulation tests."""

    def __init__(self, base=Path("/srv/wisplab"), caddyfile=Path("/etc/caddy/Caddyfile"), runner=subprocess.run):
        self.base = Path(base)
        self.caddyfile = Path(caddyfile)
        self.snippet = self.caddyfile.parent / "wisplab.caddy"
        self.runner = runner
        self.current = self.base / "current"
        self.releases = self.base / "releases"

    def run(self, command):
        result = self.runner(command, check=False, capture_output=True, text=True)
        if result.returncode:
            # Caddy diagnostics can include configuration; do not print arbitrary output.
            raise DeployError(f"Command failed ({result.returncode}): {' '.join(command)}; inspect Caddy's local logs")

    def validate(self, config: Path):
        self.run(["/usr/bin/caddy", "validate", "--config", str(config), "--adapter", "caddyfile"])

    def reload(self):
        self.run(["systemctl", "reload", "caddy"])

    def prepare_base(self):
        no_symlink_ancestors(self.base)
        marker = self.base / ".managed-by-wisplab-deploy.json"
        expected = {"owner": OWNER, "caddyfile": str(self.caddyfile)}
        if self.base.exists():
            regular(marker)
            if load_json(marker.read_bytes()) != expected:
                raise DeployError("Existing WispLab directory is not managed by this deployment script")
        else:
            self.base.mkdir(mode=0o755, parents=False)
            self.base.chmod(0o755)
            atomic_write(marker, json.dumps(expected).encode())
        for directory in (self.releases, self.base / "backups"):
            if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
                raise DeployError(f"Unexpected deployment path: {directory}")
            directory.mkdir(mode=0o755, exist_ok=True)
            directory.chmod(0o755)

    @contextmanager
    def lock(self):
        lock = self.base / ".deploy.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if (self.base / "pending.json").exists() or (self.base / "pending.json").is_symlink():
                raise DeployError("An incomplete transaction exists (pending.json); inspect its backup before retrying")
            yield
        finally:
            os.close(fd)

    def verify_release(self, release: Path):
        if release.parent != self.releases or release.is_symlink() or not release.is_dir():
            raise DeployError(f"Not a managed release directory: {release}")
        metadata = release / ".deployment.json"
        regular(metadata)
        info = load_json(metadata.read_bytes())
        if not isinstance(info, dict) or info.get("owner") != OWNER or not isinstance(info.get("files"), dict):
            raise DeployError(f"Unknown release metadata: {release}")
        found = {}
        for path in release.rglob("*"):
            if path.is_symlink() or (not path.is_file() and not path.is_dir()):
                raise DeployError(f"Non-regular object in existing release: {path}")
            if path.is_file() and path != metadata:
                relative = path.relative_to(release).as_posix()
                file_path(relative)
                found[relative] = sha256(path)
        if found != info["files"]:
            raise DeployError(f"Existing release was modified outside deployment: {release}")
        return info

    def previous_release(self):
        if not self.current.is_symlink():
            if self.current.exists():
                raise DeployError("current exists but is not a managed release symlink")
            return None
        target = Path(os.readlink(self.current))
        if not target.is_absolute():
            raise DeployError("current must have an absolute managed release target")
        self.verify_release(target)
        return target

    def stage_release(self, archive: Path, checksum: str, version: str, previous: Path | None):
        final = self.releases / version
        if final.exists() or final.is_symlink():
            info = self.verify_release(final)
            if info.get("archiveSha256") != checksum or info.get("version") != version:
                raise DeployError("This version already exists with a different archive")
            return final
        stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=self.releases))
        try:
            _, hashes = read_archive(archive, checksum, version, stage)
            # Keep prior Vite assets reachable for already-open browser tabs.
            if previous is not None:
                for site in SITES:
                    old_assets = previous / site / "assets"
                    if not old_assets.exists():
                        continue
                    for old in old_assets.rglob("*"):
                        if not old.is_file():
                            continue
                        relative = old.relative_to(previous)
                        new = stage / relative
                        if new.exists():
                            if sha256(new) != sha256(old):
                                raise DeployError(f"Previous asset path has changed content: {relative}")
                            continue
                        new.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                        shutil.copyfile(old, new)
                        new.chmod(0o644)
                        hashes[relative.as_posix()] = sha256(new)
            metadata = {"owner": OWNER, "version": version, "archiveSha256": checksum, "files": hashes}
            atomic_write(stage / ".deployment.json", json.dumps(metadata, sort_keys=True, indent=2).encode())
            for directory in stage.rglob("*"):
                if directory.is_dir():
                    directory.chmod(0o755)
            stage.chmod(0o755)
            os.rename(stage, final)
            return final
        finally:
            if stage.exists():
                shutil.rmtree(stage)

    def config_candidate(self, original: bytes):
        import_line = f"import {self.snippet}"
        text = original.decode("utf-8")
        lines = text.splitlines()
        matches = [line for line in lines if line.strip() == import_line]
        if len(matches) > 1:
            raise DeployError("Duplicate WispLab import in existing Caddyfile")
        # An exact known import can be reused; unknown references are never overwritten.
        if any(str(self.snippet) in line and line.strip() != import_line and not line.lstrip().startswith("#") for line in lines):
            raise DeployError("Unknown existing WispLab Caddy import; inspect before changing")
        if matches:
            return original
        if any(re.search(r"(?<![A-Za-z0-9.-])" + re.escape(domain) + r"(?![A-Za-z0-9.-])", line)
               for line in lines if not line.lstrip().startswith("#") for domain in SITES.values()):
            raise DeployError("A target domain is already configured in the main Caddyfile; inspect before changing")
        return original + (b"" if original.endswith(b"\n") else b"\n") + f"\n# {OWNER}\n{import_line}\n".encode()

    def deploy(self, archive: Path, checksum: str, version: str):
        read_archive(archive, checksum, version)
        no_symlink_ancestors(self.caddyfile)
        regular(self.caddyfile)
        self.prepare_base()
        with self.lock():
            previous = self.previous_release()
            original = self.caddyfile.read_bytes()
            config_stat = self.caddyfile.stat()
            candidate_bytes = self.config_candidate(original)
            snippet_bytes = caddy_snippet(self.base)
            snippet_original = None
            if self.snippet.exists() or self.snippet.is_symlink():
                regular(self.snippet)
                snippet_original = self.snippet.read_bytes()
                if snippet_original != snippet_bytes:
                    raise DeployError("wisplab.caddy already exists with unknown content; refusing to overwrite")
            if candidate_bytes == original and snippet_original is None:
                raise DeployError("Existing WispLab import has no managed snippet; inspect before changing")
            self.validate(self.caddyfile)
            release = self.stage_release(archive, checksum, version, previous)
            if previous == release and candidate_bytes == original and snippet_original == snippet_bytes:
                return {"status": "unchanged", "version": version, "current": str(release)}
            backup = self.base / "backups" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
            backup.mkdir(mode=0o700)
            atomic_write(backup / "Caddyfile", original, 0o600)
            if snippet_original is not None:
                atomic_write(backup / "wisplab.caddy", snippet_original, 0o600)
            state = {"owner": OWNER, "version": version, "previous": str(previous) if previous else None,
                     "release": str(release), "backup": str(backup), "snippetExisted": snippet_original is not None}
            atomic_write(backup / "transaction.json", json.dumps(state, indent=2).encode(), 0o600)
            pending = self.base / "pending.json"
            atomic_write(pending, json.dumps(state, indent=2).encode(), 0o600)
            candidate = self.caddyfile.parent / f".wisplab-candidate-{uuid.uuid4().hex}.caddy"
            config_changed = False
            current_changed = False
            reload_attempted = False
            snippet_changed = False
            try:
                if snippet_original is None:
                    atomic_write(self.snippet, snippet_bytes)
                    snippet_changed = True
                atomic_write(candidate, candidate_bytes, stat.S_IMODE(config_stat.st_mode),
                             (config_stat.st_uid, config_stat.st_gid) if os.geteuid() == 0 else None)
                self.validate(candidate)
                if self.caddyfile.read_bytes() != original:
                    raise DeployError("Caddyfile changed during preparation; refusing to overwrite the newer file")
                actual_current = Path(os.readlink(self.current)) if self.current.is_symlink() else None
                if actual_current != previous or (previous is None and self.current.exists()):
                    raise DeployError("current changed during preparation; refusing to overwrite it")
                atomic_symlink(self.current, release)
                current_changed = True
                os.replace(candidate, self.caddyfile)
                config_changed = True
                reload_attempted = True
                self.reload()
                self.run(["systemctl", "is-active", "--quiet", "caddy"])
                pending.unlink()
                return {"status": "deployed", "version": version, "current": str(release), "backup": str(backup)}
            except BaseException as error:
                try:
                    if config_changed:
                        atomic_write(self.caddyfile, original, stat.S_IMODE(config_stat.st_mode),
                                     (config_stat.st_uid, config_stat.st_gid) if os.geteuid() == 0 else None)
                    if snippet_changed:
                        self.snippet.unlink()
                    if current_changed:
                        if previous is None:
                            self.current.unlink()
                        else:
                            atomic_symlink(self.current, previous)
                    if reload_attempted:
                        self.validate(self.caddyfile)
                        self.reload()
                    pending.unlink()
                except BaseException as rollback_error:
                    raise DeployError(f"Deployment failed and rollback needs manual review; preserve {pending} and {backup}. Rollback error: {rollback_error}") from error
                raise DeployError(f"Deployment failed; configuration and current target restored. Backup: {backup}. Cause: {error}") from error
            finally:
                candidate.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--check-only", action="store_true", help="Validate archive only; do not change any server files")
    args = parser.parse_args()
    try:
        if args.check_only:
            _, hashes = read_archive(args.archive, args.sha256, args.version)
            print(json.dumps({"status": "valid", "version": args.version, "files": len(hashes)}))
        else:
            if os.geteuid() != 0:
                raise DeployError("Deployment requires root; use --check-only for local archive verification")
            signal.signal(signal.SIGTERM, lambda signum, frame: (_ for _ in ()).throw(InterruptedError("SIGTERM")))
            print(json.dumps(Deployment().deploy(args.archive, args.sha256, args.version)))
    except (DeployError, OSError, tarfile.TarError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
