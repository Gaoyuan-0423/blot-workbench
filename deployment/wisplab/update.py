#!/usr/bin/env python3
"""Pull verified public WispLab releases; execute only the already-installed deploy.py.

Default: follow the latest published wisplab-deploy-* release.
--tag TAG: deploy and pin an earlier release; --resume: resume automatic updates.
No GitHub token, SSH key, web listener, or downloaded executable is used.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

REPOSITORY = "Gaoyuan-0423/blot-workbench"
API = f"https://api.github.com/repos/{REPOSITORY}"
PREFIX = "wisplab-deploy-"
SOURCE_REPOS = {"wb": REPOSITORY, "pathology": "Gaoyuan-0423/pathology-workbench", "pcr": "Gaoyuan-0423/pcr-workbench"}
SHA256_RE = re.compile(r"[a-f0-9]{64}\Z")
SHA_RE = re.compile(r"[a-f0-9]{40}\Z")
VERSION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
TAG_RE = re.compile(r"wisplab-deploy-[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")
MAX_JSON = 4 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024
ALLOWED_HOSTS = {"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


class UpdateError(RuntimeError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def json_load(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise UpdateError(f"Duplicate JSON field: {key}")
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as error:
        raise UpdateError("Invalid JSON document") from error


def check_https(url):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise UpdateError("Download URL is outside the permitted HTTPS GitHub hosts")


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class GitHub:
    def __init__(self):
        self.opener = build_opener(SafeRedirect())

    def open(self, url):
        check_https(url)
        headers = {"User-Agent": "WispLab-static-updater/1", "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28"}
        try:
            return self.opener.open(Request(url, headers=headers), timeout=30)
        except HTTPError as error:
            raise UpdateError(f"GitHub request returned HTTP {error.code}; next timer run will retry") from error
        except URLError as error:
            raise UpdateError("GitHub HTTPS request failed; current deployment is unchanged") from error

    def get_json(self, url):
        with self.open(url) as response:
            data = response.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise UpdateError("GitHub JSON response is too large")
        return json_load(data)

    def releases(self):
        result = []
        for page in range(1, 11):
            entries = self.get_json(f"{API}/releases?per_page=100&page={page}")
            if not isinstance(entries, list):
                raise UpdateError("Unexpected release listing")
            result.extend(entries)
            if len(entries) < 100:
                return result
        raise UpdateError("Release listing exceeded 1000 entries; review pagination before continuing")

    def release_by_tag(self, tag):
        return self.get_json(f"{API}/releases/tags/{quote(tag, safe='')}")

    def download(self, url, destination, expected_size, limit):
        if not isinstance(expected_size, int) or not 0 < expected_size <= limit:
            raise UpdateError("Asset size is outside the allowed range")
        digest = hashlib.sha256()
        size = 0
        with self.open(url) as response, destination.open("xb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit or size > expected_size:
                    raise UpdateError("Downloaded asset exceeded its declared size")
                digest.update(chunk)
                output.write(chunk)
        if size != expected_size:
            raise UpdateError("Downloaded asset size does not match its release record")
        return digest.hexdigest()


def valid_release(release):
    if (not isinstance(release, dict) or not isinstance(release.get("id"), int)
            or release.get("id", 0) <= 0 or release.get("draft") is not False
            or release.get("prerelease") is not False
            or not TAG_RE.fullmatch(str(release.get("tag_name", "")))
            or not isinstance(release.get("published_at"), str)):
        return False
    try:
        timestamp = datetime.fromisoformat(release["published_at"].replace("Z", "+00:00"))
    except ValueError:
        return False
    return timestamp.tzinfo is not None


def latest_release(releases):
    candidates = [release for release in releases if valid_release(release)]
    if not candidates:
        return None
    return max(candidates, key=lambda release: (
        datetime.fromisoformat(release["published_at"].replace("Z", "+00:00")), release["id"]))


def asset(release, name):
    matches = [item for item in release.get("assets", []) if item.get("name") == name]
    if len(matches) != 1 or matches[0].get("state") != "uploaded":
        raise UpdateError(f"Published release needs exactly one uploaded {name} asset")
    entry = matches[0]
    url = entry.get("browser_download_url", "")
    check_https(url)
    parsed = urlparse(url)
    expected = f"/{REPOSITORY}/releases/download/{release['tag_name']}/{name}"
    if parsed.hostname != "github.com" or unquote(parsed.path).casefold() != expected.casefold() or parsed.query or parsed.fragment:
        raise UpdateError("Asset download URL does not belong to the selected repository and release")
    return entry


def validate_manifest(document):
    if (not isinstance(document, dict) or document.get("schemaVersion") != 1
            or not VERSION_RE.fullmatch(str(document.get("version", "")))):
        raise UpdateError("Invalid deployment manifest schema or version")
    archive = document.get("archive")
    if (not isinstance(archive, dict) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tar\.gz", str(archive.get("fileName", "")))
            or not SHA256_RE.fullmatch(str(archive.get("sha256", "")))):
        raise UpdateError("Manifest archive name or SHA256 is invalid")
    sources = document.get("sources")
    if not isinstance(sources, dict) or set(sources) != set(SOURCE_REPOS):
        raise UpdateError("Manifest must identify all three source repositories")
    for site, expected_repo in SOURCE_REPOS.items():
        source = sources[site]
        if (not isinstance(source, dict) or source.get("repository", "").casefold() != expected_repo.casefold()
                or not SHA_RE.fullmatch(str(source.get("gitSha", "")))):
            raise UpdateError(f"Unexpected source repository or Git SHA for {site}")
        for step in ("ci", "pages"):
            evidence = source.get(step)
            if (not isinstance(evidence, dict) or evidence.get("conclusion") != "success"
                    or evidence.get("headSha") != source["gitSha"]
                    or not isinstance(evidence.get("runId"), int) or evidence["runId"] <= 0
                    or ("commitInput" in evidence and evidence["commitInput"] != source["gitSha"])):
                raise UpdateError(f"Missing successful {step} evidence for {site} at its exact Git SHA")
    return document


def crosscheck_bundle(path, document):
    # Read only one bounded JSON member; the fixed deploy.py performs full safe-tar validation.
    with tarfile.open(path, "r:gz") as package:
        matches = []
        for index, member in enumerate(package):
            if index >= 50000:
                raise UpdateError("Archive has too many entries")
            if member.name == "release.json":
                matches.append(member)
        if len(matches) != 1 or not matches[0].isfile() or matches[0].issparse() or not 0 < matches[0].size <= MAX_JSON:
            raise UpdateError("Archive requires one regular, bounded release.json")
        stream = package.extractfile(matches[0])
        with stream:
            manifest = json_load(stream.read(MAX_JSON + 1))
    if manifest.get("schemaVersion") != 1 or manifest.get("version") != document["version"]:
        raise UpdateError("Archive version differs from deployment.json")
    for site, source in document["sources"].items():
        if manifest.get("sites", {}).get(site, {}).get("gitSha") != source["gitSha"]:
            raise UpdateError(f"Archive source SHA differs from deployment.json for {site}")


def atomic_json(path, data):
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("x") as output:
            json.dump(data, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Updater:
    def __init__(self, base=Path("/srv/wisplab"), github=None, runner=subprocess.run):
        self.base = Path(base)
        self.home = self.base / "updater"
        self.installer = self.base / "bin/deploy.py"
        self.state_path = self.home / "state.json"
        self.github = github or GitHub()
        self.runner = runner
        self.logger = logging.getLogger(f"wisplab-updater-{id(self)}")

    def prepare(self):
        for path in [self.base, self.installer, *self.installer.parents]:
            if path.is_symlink():
                raise UpdateError(f"Refusing symlinked installation path: {path}")
        marker = self.base / ".managed-by-wisplab-deploy.json"
        if marker.is_symlink() or not marker.is_file() or json_load(marker.read_bytes()).get("owner") != "wisplab-deploy-v1":
            raise UpdateError("Install the initial managed deployment before enabling automatic updates")
        if (not self.installer.is_file() or not stat.S_ISREG(self.installer.stat().st_mode)
                or self.installer.stat().st_uid != os.geteuid() or self.installer.stat().st_mode & 0o022):
            raise UpdateError("The fixed installed deploy.py must be owned by the service user and not writable by others")
        marker = self.home / ".managed-by-updater"
        if self.home.exists() or self.home.is_symlink():
            if self.home.is_symlink() or not marker.is_file() or marker.is_symlink() or marker.read_text() != "wisplab-updater-v1\n":
                raise UpdateError("Existing updater directory is not managed; refusing to overwrite")
        else:
            self.home.mkdir(mode=0o700)
            marker.write_text("wisplab-updater-v1\n")
        self.home.chmod(0o700)
        handler = RotatingFileHandler(self.home / "update.log", maxBytes=1024 * 1024, backupCount=3)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False

    def run(self, tag=None, resume=False):
        if tag is not None and not TAG_RE.fullmatch(tag):
            raise UpdateError("Manual tag must have the wisplab-deploy- prefix and safe characters")
        self.prepare()
        lock_fd = os.open(self.home / "update.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if tag is not None or resume:
                    raise UpdateError("Another update is running; retry the manual operation after it finishes")
                return {"status": "busy"}
            state = {}
            if self.state_path.exists() or self.state_path.is_symlink():
                if self.state_path.is_symlink() or not self.state_path.is_file():
                    raise UpdateError("Updater state is not a regular file")
                state = json_load(self.state_path.read_bytes())
                if not isinstance(state, dict):
                    raise UpdateError("Updater state is invalid")
            if resume:
                state.pop("pinnedTag", None)
                atomic_json(self.state_path, state)
                self.logger.info("Automatic following resumed")
            if state.get("pinnedTag") and tag is None:
                return {"status": "pinned", "tag": state["pinnedTag"]}
            release = self.github.release_by_tag(tag) if tag else latest_release(self.github.releases())
            if release is None:
                return {"status": "no-release"}
            if not valid_release(release) or (tag and release["tag_name"] != tag):
                raise UpdateError("Requested release is not a published stable WispLab deployment")
            if state.get("releaseId") == release["id"] and state.get("tag") == release["tag_name"]:
                if tag:
                    state["pinnedTag"] = tag
                    atomic_json(self.state_path, state)
                return {"status": "unchanged", "tag": release["tag_name"]}
            self.logger.info("Preparing release %s (id %s)", release["tag_name"], release["id"])
            with tempfile.TemporaryDirectory(prefix="download-", dir=self.home) as temporary:
                work = Path(temporary)
                manifest_asset = asset(release, "deployment.json")
                manifest_path = work / "deployment.json"
                manifest_sha = self.github.download(manifest_asset["browser_download_url"], manifest_path, manifest_asset["size"], MAX_JSON)
                document = validate_manifest(json_load(manifest_path.read_bytes()))
                archive_asset = asset(release, document["archive"]["fileName"])
                archive_path = work / document["archive"]["fileName"]
                checksum = self.github.download(archive_asset["browser_download_url"], archive_path, archive_asset["size"], MAX_ARCHIVE)
                if checksum != document["archive"]["sha256"]:
                    raise UpdateError("Archive SHA256 does not match deployment.json")
                crosscheck_bundle(archive_path, document)
                result = self.runner(["/usr/bin/python3", "-I", str(self.installer), "--archive", str(archive_path),
                                      "--sha256", checksum, "--version", document["version"]],
                                     check=False, capture_output=True, text=True)
                if result.returncode:
                    detail = (result.stderr or result.stdout or "no diagnostics").strip()[-1600:]
                    raise UpdateError(f"Fixed deploy.py failed ({result.returncode}): {detail}")
                updated = {"schemaVersion": 1, "releaseId": release["id"], "tag": release["tag_name"],
                           "version": document["version"], "archiveSha256": checksum,
                           "deploymentManifestSha256": manifest_sha, "sources": document["sources"], "deployedAtUtc": now()}
                if tag:
                    updated["pinnedTag"] = tag
                atomic_json(self.state_path, updated)
                (self.home / "last-error.json").unlink(missing_ok=True)
                self.logger.info("Installed %s as version %s", release["tag_name"], document["version"])
                return {"status": "deployed", "tag": release["tag_name"], "version": document["version"], "pinned": bool(tag)}
        except Exception as error:
            self.logger.error("Update failed: %s", error)
            atomic_json(self.home / "last-error.json", {"failedAtUtc": now(), "error": str(error)[:2000]})
            raise
        finally:
            os.close(lock_fd)
            for handler in list(self.logger.handlers):
                handler.close()
                self.logger.removeHandler(handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--tag", help="Deploy and pin this published release tag (manual rollback)")
    options.add_argument("--resume", action="store_true", help="Remove a manual pin and follow the latest published release")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run the installed updater as root")
    os.umask(0o077)
    try:
        print(json.dumps(Updater().run(args.tag, args.resume)))
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
