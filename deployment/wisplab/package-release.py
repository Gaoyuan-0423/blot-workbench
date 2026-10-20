#!/usr/bin/env python3
"""Package public, pre-built WispLab sites; never build, push, or deploy.

Standard library only. See README.md for input provenance and validation limits.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import unquote, urlsplit
import zipfile

HERE = Path(__file__).resolve().parent
DEFAULT_REPOS = {
    "wb": Path("/Users/kururugao/.codex/worktrees/wb-ui-release/WB分析"),
    "pathology": Path("/Users/kururugao/Downloads/pathology-workbench"),
    "pcr": Path("/Users/kururugao/Downloads/pcr-workbench"),
}
REPOSITORIES = {
    "wb": "Gaoyuan-0423/blot-workbench",
    "pathology": "Gaoyuan-0423/pathology-workbench",
    "pcr": "Gaoyuan-0423/pcr-workbench",
}
PORTAL_FILES = {"index.html", "styles.css", "favicon.svg"}
PORTAL_OPTIONAL_FILES = {"locale.js", "platform/client.js", "platform/wisplab.js", "platform/wisplab.css", "platform/manifest.json"}
PLATFORM_FILES = {"platform/client.js", "platform/wisplab.js", "platform/wisplab.css", "platform/manifest.json"}
ORT_FILES = {"ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"}
FORBIDDEN_COMPONENTS = {
    "node_modules", "src", "tests", "test", "fixtures", "test-results",
    "playwright-report", "private", "secrets", "credentials", "__pycache__",
}
FORBIDDEN_SUFFIXES = {
    ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".env", ".map",
    ".ts", ".tsx", ".jsx", ".py", ".pyc", ".sh", ".bash", ".zsh",
    ".ipynb", ".sqlite", ".sqlite3", ".db", ".log", ".bak",
}
FORBIDDEN_NAMES = {"id_rsa", "id_ed25519", "id_ecdsa", "authorized_keys", "known_hosts", "package.json", "package-lock.json"}
VITE_ASSET = re.compile(r"[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css|wasm|svg|png|jpe?g|gif|webp|ico|woff2?)\Z", re.IGNORECASE)
SECRET_PATTERNS = [
    re.compile(rb"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----"),
    re.compile(rb"openssh-key-v1\x00"),
    re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b"),
]
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_FILES = 10_000
MAX_ZIP_BYTES = 256 * 1024 * 1024


class PackageError(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(root: Path, *args: str) -> bytes:
    process = subprocess.run(["git", "-C", str(root), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if process.returncode:
        # Do not echo arbitrary git stderr: remote URLs can contain credentials.
        raise PackageError(f"Git command failed for {root.name}: {args[0]}")
    return process.stdout


def safe_relative(name: str) -> str:
    if not name or name.startswith("/") or "\\" in name or ":" in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise PackageError(f"Unsafe relative path: {name!r}")
    parts = name.split("/")
    if any(part in {"", ".", ".."} or part.startswith(".") for part in parts):
        raise PackageError(f"Hidden or escaping path is forbidden: {name!r}")
    if any(part.lower() in FORBIDDEN_COMPONENTS for part in parts):
        raise PackageError(f"Private, source, or test directory is forbidden: {name!r}")
    leaf = parts[-1].lower()
    if leaf in FORBIDDEN_NAMES or PurePosixPath(leaf).suffix in FORBIDDEN_SUFFIXES:
        raise PackageError(f"Sensitive or source filename is forbidden: {name!r}")
    return name


def no_symlink_components(path: Path) -> Path:
    absolute = Path(os.path.abspath(path.expanduser()))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError as error:
            raise PackageError(f"Required input is missing: {current}") from error
        if stat.S_ISLNK(mode):
            raise PackageError(f"Symbolic links are forbidden: {current}")
    return absolute


def read_regular(path: Path) -> bytes:
    path = no_symlink_components(path)
    try:
        # Keep each parent directory open so a concurrent symlink replacement
        # cannot redirect a checked pathname outside the selected source.
        directory = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for component in path.parts[1:-1]:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                os.close(directory)
                directory = child
            descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
        with os.fdopen(descriptor, "rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise PackageError(f"Only ordinary, unlinked files are accepted: {path}")
            if before.st_size > MAX_FILE_BYTES:
                raise PackageError(f"Input exceeds the file size limit: {path}")
            data = source.read(MAX_FILE_BYTES + 1)
            after = os.fstat(source.fileno())
            if len(data) > MAX_FILE_BYTES or (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise PackageError(f"Input changed while being read: {path}")
            return data
    except OSError as error:
        raise PackageError(f"Unable to read a regular input file: {path}") from error


def scan_content(name: str, data: bytes, *, nested: bool = False) -> None:
    if any(pattern.search(data) for pattern in SECRET_PATTERNS):
        raise PackageError(f"Credential or private-key signature found in {name}; values are not printed.")
    if not name.lower().endswith(".zip"):
        return
    if nested:
        raise PackageError(f"Nested archives are not accepted: {name}")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES or sum(item.file_size for item in members) > MAX_ZIP_BYTES:
                raise PackageError(f"Example archive exceeds unpacked limits: {name}")
            seen = set()
            for item in members:
                member = safe_relative(item.filename.rstrip("/"))
                if member in seen:
                    raise PackageError(f"Duplicate archive entry in {name}: {member}")
                seen.add(member)
                mode = item.external_attr >> 16
                if item.flag_bits & 1 or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}):
                    raise PackageError(f"Encrypted or non-regular archive entry in {name}: {member}")
                if not item.is_dir():
                    scan_content(f"{name}/{member}", archive.read(item), nested=True)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        raise PackageError(f"Cannot safely inspect example archive: {name}") from error


def collect_files(root: Path, *, portal: bool = False) -> dict[str, bytes]:
    root = no_symlink_components(root)
    if not root.is_dir():
        raise PackageError(f"Expected an input directory: {root}")
    collected: dict[str, bytes] = {}
    total = 0

    def walk(folder: Path) -> None:
        nonlocal total
        for entry in sorted(folder.iterdir(), key=lambda p: p.name):
            mode = entry.lstat().st_mode
            if stat.S_ISLNK(mode):
                raise PackageError(f"Symbolic links are forbidden: {entry}")
            relative = entry.relative_to(root).as_posix()
            if portal and relative == ".qa":
                if not stat.S_ISDIR(mode):
                    raise PackageError("portal/.qa must be an ordinary directory when present")
                continue
            safe_relative(relative)
            if stat.S_ISDIR(mode):
                walk(entry)
            elif stat.S_ISREG(mode):
                data = read_regular(entry)
                total += len(data)
                if total > MAX_TOTAL_BYTES or len(collected) >= MAX_FILES:
                    raise PackageError(f"Site exceeds package limits: {root}")
                scan_content(relative, data)
                collected[relative] = data
            else:
                raise PackageError(f"Special filesystem entry is forbidden: {entry}")

    walk(root)
    if "index.html" not in collected:
        raise PackageError(f"Built index.html is missing: {root}")
    if portal and (not PORTAL_FILES.issubset(collected)
                   or set(collected) - PORTAL_FILES - PORTAL_OPTIONAL_FILES):
        raise PackageError("Portal requires index.html, styles.css, favicon.svg; only locale.js, the verified platform assets and excluded .qa/ are additionally allowed.")
    validate_platform(collected)
    return collected


def validate_platform(files: dict[str, bytes]) -> None:
    present = set(files) & PLATFORM_FILES
    if not present:
        return  # Historical releases remain deployable.
    if present != PLATFORM_FILES:
        raise PackageError("Shared platform assets must be complete")
    try:
        manifest = json.loads(files["platform/manifest.json"])
        expected = {name.removeprefix("platform/"): sha256(files[name]) for name in PLATFORM_FILES if name != "platform/manifest.json"}
        if manifest.get("schemaVersion") != 1 or manifest.get("sourceRepository") != "Gaoyuan-0423/blot-workbench" or manifest.get("sourceDirectory") != "platform" or manifest.get("files") != expected:
            raise ValueError("mismatch")
    except (ValueError, TypeError, AttributeError) as error:
        raise PackageError("Shared platform asset manifest mismatch") from error


def validate_platform_suite(files: dict[str, bytes]) -> None:
    manifests = [files.get(f"{site}/platform/manifest.json") for site in ("portal", "wb", "pathology", "pcr")]
    if any(manifests) and (not all(manifests) or len(set(manifests)) != 1):
        raise PackageError("All four sites must use the same generated platform version")


class IndexAssets(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in {"script", "img"} and values.get("src"):
            self.urls.append(values["src"] or "")
        if tag == "link" and values.get("href") and set((values.get("rel") or "").lower().split()) & {"stylesheet", "icon", "modulepreload", "preload"}:
            self.urls.append(values["href"] or "")


def check_index(site: str, files: dict[str, bytes]) -> None:
    parser = IndexAssets()
    try:
        parser.feed(files["index.html"].decode("utf-8"))
    except UnicodeError as error:
        raise PackageError(f"{site}/index.html must be UTF-8") from error
    for url in parser.urls:
        split = urlsplit(url)
        if split.scheme or split.netloc:
            raise PackageError(f"{site}/index.html requires a non-local asset: {url!r}")
        name = unquote(split.path)
        if name.startswith("./"):
            name = name[2:]
        elif name.startswith("/"):
            name = name[1:]
        safe_relative(name)
        if name not in files:
            raise PackageError(f"{site}/index.html references a missing built asset: {name}")


def current_commit(root: Path, expected_repo: str) -> str:
    root = no_symlink_components(root)
    if Path(os.fsdecode(git(root, "rev-parse", "--show-toplevel")).strip()).resolve() != root.resolve():
        raise PackageError(f"Expected repository root, not a subdirectory: {root}")
    remote = os.fsdecode(git(root, "remote", "get-url", "origin")).strip().removesuffix(".git").lower()
    accepted = {f"https://github.com/{expected_repo.lower()}", f"git@github.com:{expected_repo.lower()}"}
    if remote not in accepted:
        raise PackageError(f"Repository origin does not match the configured public repository: {expected_repo}")
    if git(root, "status", "--porcelain", "--untracked-files=normal").strip():
        raise PackageError(f"Commit source changes before packaging: {root}")
    commit = git(root, "rev-parse", "HEAD").decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise PackageError(f"Unexpected Git commit identity for {expected_repo}")
    return commit


def validate_provenance(site: str, repo: Path, files: dict[str, bytes], commit: str) -> None:
    tracked = {os.fsdecode(name) for name in git(repo, "ls-files", "-z").split(b"\0") if name}
    for name, data in files.items():
        source = f"public/{name}"
        if source in tracked:
            if data != git(repo, "show", f"{commit}:{source}"):
                raise PackageError(f"{site}/{name} differs from its committed public source; rebuild first.")
            continue
        if name == "index.html" or (name.startswith("assets/") and VITE_ASSET.fullmatch(name[7:])):
            continue
        if name == "THIRD_PARTY_NOTICES.txt":
            continue
        if site == "pathology" and name.startswith("screenshots/"):
            source = f"docs/{name}"
            if source in tracked and data == git(repo, "show", f"{commit}:{source}"):
                continue
        if site == "pathology" and name.startswith("ort/") and name[4:] in ORT_FILES:
            runtime = repo / "node_modules" / "onnxruntime-web" / "dist" / name[4:]
            if data == read_regular(runtime):
                continue
        raise PackageError(f"Unrecognized or unverified static file: {site}/{name}; do not include test/private inputs.")


def canonical_input_root(path: Path) -> Path:
    """Resolve host aliases such as macOS /tmp, but never a symlink input root."""
    path = Path(path).expanduser()
    if path.is_symlink():
        raise PackageError(f"Symbolic-link input roots are forbidden: {path}")
    return no_symlink_components(path.resolve(strict=True))


def validate_ci_provenance(provenance: dict) -> tuple[dict, dict | None]:
    """Validate supplied CI identity; the release orchestrator verifies it on GitHub."""
    if not isinstance(provenance, dict) or type(provenance.get("schemaVersion")) is not int or provenance["schemaVersion"] != 1:
        raise PackageError("CI provenance must have schemaVersion 1")
    sites = provenance.get("sites")
    if not isinstance(sites, dict) or set(sites) != set(REPOSITORIES):
        raise PackageError("CI provenance requires exactly wb/pathology/pcr site identities")
    validated = {}
    for site, repository in REPOSITORIES.items():
        entry = sites[site]
        if not isinstance(entry, dict) or entry.get("repository") != repository:
            raise PackageError(f"CI provenance must identify the configured {site} repository")
        commit = entry.get("gitSha")
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise PackageError(f"CI provenance needs a full lowercase Git SHA for {site}")
        run_id = entry.get("runId")
        if type(run_id) is not int or run_id <= 0:
            raise PackageError(f"CI provenance needs a positive integer runId for {site}")
        if entry.get("artifactName", "web-dist") != "web-dist":
            raise PackageError(f"CI artifact for {site} must be web-dist")
        run_url = f"https://github.com/{repository}/actions/runs/{run_id}"
        if "runUrl" in entry and entry["runUrl"] != run_url:
            raise PackageError(f"CI runUrl does not match repository and runId for {site}")
        identity = {
            "sourceKind": "github-actions-artifact", "repository": repository,
            "gitSha": commit, "runId": run_id, "runUrl": run_url,
            "artifactName": "web-dist",
        }
        if "artifactId" in entry:
            if type(entry["artifactId"]) is not int or entry["artifactId"] <= 0:
                raise PackageError(f"Invalid artifactId for {site}")
            identity["artifactId"] = entry["artifactId"]
        if "artifactDigest" in entry:
            digest = entry["artifactDigest"]
            if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
                raise PackageError(f"Invalid artifactDigest for {site}")
            identity["artifactDigest"] = digest
        validated[site] = identity
    portal = provenance.get("portal")
    if portal is not None:
        if not isinstance(portal, dict) or portal.get("repository") != REPOSITORIES["wb"] or portal.get("gitSha") != validated["wb"]["gitSha"] or portal.get("sourcePath") != "deployment/wisplab/portal":
            raise PackageError("Portal provenance must identify deployment/wisplab/portal at the exact WB commit")
        portal = {"sourceKind": "repository-portal", **{key: portal[key] for key in ("repository", "gitSha", "sourcePath")}}
    return validated, portal


def validate_ci_layout(site: str, files: dict[str, bytes]) -> None:
    """CI replaces local Git comparison; retain narrow public static layouts."""
    public_suffixes = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".json", ".csv", ".txt", ".md", ".zip", ".rdml", ".xml", ".xlsx"}
    validate_platform(files)
    for name in files:
        if name in PLATFORM_FILES:
            continue
        if name in {"index.html", "THIRD_PARTY_NOTICES.txt"}:
            continue
        if name.startswith("assets/") and VITE_ASSET.fullmatch(name[7:]):
            continue
        if site == "wb" and name.startswith("examples/") and PurePosixPath(name).suffix.lower() in public_suffixes:
            continue
        if site == "pathology" and (name == "favicon.svg" or (name.startswith("ort/") and name[4:] in ORT_FILES) or (name.startswith("screenshots/") and PurePosixPath(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})):
            continue
        if site == "pcr" and (name in {"favicon.svg", "icons.svg"} or (name.startswith("demo/") and PurePosixPath(name).suffix.lower() in public_suffixes)):
            continue
        raise PackageError(f"Unrecognized CI static path: {site}/{name}")


def package_ci_release(*, version: str, portal: Path, artifact_dirs: dict[str, Path], provenance: dict, output_dir: Path, check_only: bool = False) -> dict:
    """Package exact extracted CI assets without consulting or rebuilding local repos.

    The caller must obtain artifacts from successful CI at the recorded main-branch
    commits and verify GitHub artifact provenance before invoking this function.
    Returns JSON-compatible archive/checksum/sha256/sizeBytes/manifest fields.
    """
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version):
        raise PackageError("Invalid release version")
    if set(artifact_dirs) != set(REPOSITORIES):
        raise PackageError("Artifact directories must identify exactly wb/pathology/pcr")
    identities, portal_identity = validate_ci_provenance(provenance)
    roots = {site: canonical_input_root(Path(path)) for site, path in artifact_dirs.items()}
    roots["portal"] = canonical_input_root(Path(portal))
    all_files: dict[str, bytes] = {}
    sites = {}
    for site in ("portal", *REPOSITORIES):
        files = collect_files(roots[site], portal=site == "portal")
        check_index(site, files)
        if site != "portal":
            validate_ci_layout(site, files)
        entry = dict((portal_identity or {"sourceKind": "portal", "gitSha": None}) if site == "portal" else identities[site])
        entry["files"] = {name: sha256(data) for name, data in sorted(files.items())}
        sites[site] = entry
        all_files.update({f"{site}/{name}": data for name, data in files.items()})
    validate_platform_suite(all_files)
    if sum(map(len, all_files.values())) > MAX_TOTAL_BYTES or len(all_files) > MAX_FILES:
        raise PackageError("Combined sites exceed package limits")
    manifest = {
        "schemaVersion": 1, "version": version,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sites": sites,
        "validation": "Site payloads are byte-for-byte copies of the supplied extracted GitHub Actions artifacts. Repository, commit and run identities are supplied by the release orchestrator, which must verify successful main-branch CI and artifact provenance on GitHub. This packager makes no GitHub requests and does not rebuild assets. File digests cover the packaged bytes; signature scanning cannot prove the absence of all sensitive data.",
    }
    all_files["release.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if check_only:
        return {"archive": None, "checksum": None, "sha256": None, "sizeBytes": 0, "manifest": manifest}
    archive, checksum = write_archive(Path(output_dir), version, all_files)
    return {"archive": str(archive.resolve()), "checksum": str(checksum.resolve()), "sha256": sha256(archive.read_bytes()), "sizeBytes": archive.stat().st_size, "manifest": manifest}


def write_archive(output: Path, version: str, files: dict[str, bytes]) -> tuple[Path, Path]:
    output.mkdir(parents=True, exist_ok=True)
    no_symlink_components(output)
    archive_path = output / f"wisplab-{version}.tar.gz"
    checksum_path = output / f"wisplab-{version}.tar.gz.sha256"
    if archive_path.exists() or checksum_path.exists() or archive_path.is_symlink() or checksum_path.is_symlink():
        raise PackageError("Output already exists; choose a fresh version instead of overwriting a release.")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".package-", suffix=".tmp", dir=output)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as target:
            with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                    for name, data in sorted(files.items()):
                        safe_relative(name)
                        info = tarfile.TarInfo(name)
                        info.size = len(data)
                        info.mode = 0o644
                        info.uid = info.gid = 0
                        info.uname = info.gname = ""
                        info.mtime = 0
                        archive.addfile(info, io.BytesIO(data))
        digest = sha256(temporary.read_bytes())
        # Linking a complete temporary file publishes it atomically and fails
        # when the destination already exists; removing the temp leaves nlink=1.
        temporary.chmod(0o644)
        os.link(temporary, archive_path)
        with checksum_path.open("x", encoding="ascii") as target:
            target.write(f"{digest}  {archive_path.name}\n")
    finally:
        temporary.unlink(missing_ok=True)
    return archive_path, checksum_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), help="Release identifier (default: current UTC time)")
    parser.add_argument("--portal", type=Path, default=HERE / "portal")
    parser.add_argument("--output-dir", type=Path, default=HERE / "releases")
    parser.add_argument("--check-only", action="store_true", help="Validate inputs and print commits/counts; write no bundle")
    parser.add_argument("--ci-provenance", type=Path, help="CI identity JSON; requires all three --*-artifact directories")
    for name, root in DEFAULT_REPOS.items():
        parser.add_argument(f"--{name}-repo", type=Path, default=root)
        parser.add_argument(f"--{name}-artifact", type=Path, help="Extracted web-dist CI artifact directory (CI mode)")
        parser.add_argument(f"--expect-{name}-sha", help="Optional expected full Git SHA; refuse a different checkout")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", args.version):
        raise PackageError("Version must be 1–80 ASCII letters/digits/dots/dashes/underscores, starting with a letter or digit.")
    artifact_dirs = {site: getattr(args, f"{site}_artifact") for site in REPOSITORIES}
    if args.ci_provenance is not None or any(artifact_dirs.values()):
        if args.ci_provenance is None or not all(artifact_dirs.values()):
            raise PackageError("CI mode requires --ci-provenance and all three --*-artifact directories")
        provenance = json.loads(read_regular(canonical_input_root(args.ci_provenance)).decode("utf-8"))
        identities, _ = validate_ci_provenance(provenance)
        for site, identity in identities.items():
            expected = getattr(args, f"expect_{site}_sha")
            if expected is not None and expected != identity["gitSha"]:
                raise PackageError(f"{site} CI identity does not match --expect-{site}-sha")
        result = package_ci_release(version=args.version, portal=args.portal, artifact_dirs=artifact_dirs, provenance=provenance, output_dir=args.output_dir, check_only=args.check_only)
        for site, entry in result["manifest"]["sites"].items():
            print(f"{site}: {len(entry['files'])} files; Git {entry['gitSha'] or 'not applicable'}; CI {entry.get('runId', 'not applicable')}")
        if args.check_only:
            print("CI input checks passed. No archive was written.")
        else:
            print(f"Created {result['archive']}\nSHA256 {result['sha256']}\nBytes {result['sizeBytes']}\nChecksum {result['checksum']}")
        return 0
    all_files: dict[str, bytes] = {}
    sites: dict[str, dict] = {}
    roots = {site: no_symlink_components(getattr(args, f"{site}_repo")) for site in DEFAULT_REPOS}
    commits = {site: current_commit(root, REPOSITORIES[site]) for site, root in roots.items()}
    for site, commit in commits.items():
        expected = getattr(args, f"expect_{site}_sha")
        if expected is not None and expected != commit:
            raise PackageError(f"{site} HEAD does not match --expect-{site}-sha")
    for site, root in [("portal", args.portal), *((site, root / "dist") for site, root in roots.items())]:
        files = collect_files(root, portal=site == "portal")
        check_index(site, files)
        if site != "portal":
            validate_provenance(site, roots[site], files, commits[site])
        entry = {
            "sourceKind": "portal" if site == "portal" else "git-dist",
            "gitSha": commits.get(site),
            "files": {name: sha256(data) for name, data in sorted(files.items())},
        }
        if site in REPOSITORIES:
            entry["repository"] = REPOSITORIES[site]
        sites[site] = entry
        all_files.update({f"{site}/{name}": data for name, data in files.items()})
    validate_platform_suite(all_files)
    if sum(map(len, all_files.values())) > MAX_TOTAL_BYTES or len(all_files) > MAX_FILES:
        raise PackageError("Combined sites exceed package limits")
    for site, root in roots.items():
        if current_commit(root, REPOSITORIES[site]) != commits[site]:
            raise PackageError(f"{site} source changed while packaging; retry after the build finishes.")
    manifest = {
        "schemaVersion": 1,
        "version": args.version,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sites": sites,
        "validation": "Public static inputs only; file digests cover the packaged bytes. Packaging does not build or attest that dist was generated from the recorded Git commits, and signature scanning cannot prove the absence of all sensitive data. Build and review the clean commits before packaging.",
    }
    all_files["release.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    for site, entry in sites.items():
        print(f"{site}: {len(entry['files'])} files; Git {entry['gitSha'] or 'not applicable (standalone portal)'}")
    if args.check_only:
        print("Input checks passed. No archive was written.")
        return 0
    archive, checksum = write_archive(args.output_dir, args.version, all_files)
    print(f"Created {archive}\nChecksum {checksum}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (PackageError, OSError, ValueError) as error:
        print(f"Packaging refused: {error}", file=sys.stderr)
        sys.exit(1)
