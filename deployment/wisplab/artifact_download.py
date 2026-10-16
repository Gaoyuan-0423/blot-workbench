#!/usr/bin/env python3
"""下载 GitHub Actions ZIP：有限并行、完整摘要校验、临时目录安全解压。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import http.client
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import unicodedata
from urllib.parse import urlsplit
import urllib.error
import urllib.request
import zipfile

REPOSITORIES = {"Gaoyuan-0423/blot-workbench", "Gaoyuan-0423/pathology-workbench", "Gaoyuan-0423/pcr-workbench"}
MAX_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_FILES = 10000
WORKERS = 12
SOCKET_TIMEOUT = 30
PART_TIMEOUT = 180


class ArtifactError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def download_host(url):
    if not isinstance(url, str) or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ArtifactError("GitHub 返回了无效下载地址。")
    parts = urlsplit(url)
    host = parts.hostname or ""
    allowed = bool(re.fullmatch(r"productionresultssa[a-z0-9]+\.blob\.core\.windows\.net", host)) or host in {
        "results-receiver.actions.githubusercontent.com", "pipelines.actions.githubusercontent.com",
        "objects.githubusercontent.com", "release-assets.githubusercontent.com",
    }
    try:
        port = parts.port
    except ValueError:
        port = -1
    if parts.scheme != "https" or not allowed or parts.username or parts.password or port not in (None, 443) or parts.fragment:
        raise ArtifactError("GitHub 返回了不受支持的下载地址；未发送凭据或继续下载。")
    return url


def signed_url(repository, artifact_id):
    if repository not in REPOSITORIES or type(artifact_id) is not int or artifact_id <= 0:
        raise ArtifactError("工件仓库或 ID 无效。")
    try:
        token_result = subprocess.run(["gh", "auth", "token", "--hostname", "github.com"],
                                      capture_output=True, text=True, timeout=30)
        if token_result.returncode or not token_result.stdout.strip():
            raise ArtifactError("无法读取 GitHub CLI 的已登录凭据。")
        # token 只发往固定 API；禁止自动跟随携带 Authorization 的重定向。
        request = urllib.request.Request(
            f"https://api.github.com/repos/{repository}/actions/artifacts/{artifact_id}/zip",
            headers={"Authorization": "Bearer " + token_result.stdout.strip(),
                     "Accept": "application/vnd.github+json", "User-Agent": "WispLab-release/1"})
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=SOCKET_TIMEOUT):
                raise ArtifactError("GitHub 工件 API 未返回预期的 302 下载跳转。")
        except urllib.error.HTTPError as error:
            if error.code != 302:
                raise ArtifactError(f"GitHub 工件 API 返回 HTTP {error.code}。") from None
            location = error.headers.get("Location", "")
            error.close()
            return download_host(location)
    except ArtifactError:
        raise
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ArtifactError("获取工件下载地址失败；请检查 gh 认证与网络。") from None


def check_range(response, start, end, total):
    expected = f"bytes {start}-{end}/{total}"
    if response.status != 206 or response.headers.get("Content-Range") != expected:
        raise ArtifactError("下载服务器没有返回请求的精确 206 Content-Range，拒绝拼接。")
    encoding = response.headers.get("Content-Encoding", "identity").lower()
    if encoding != "identity":
        raise ArtifactError("Range 响应被重新编码，拒绝拼接。")
    length = response.headers.get("Content-Length")
    if length is not None and length != str(end - start + 1):
        raise ArtifactError("Range 响应长度与请求不一致。")


def fetch_part(url, start, end, total, output, cancel):
    deadline = time.monotonic() + PART_TIMEOUT
    last_error = None
    for attempt in range(2):
        if cancel.is_set():
            raise ArtifactError("另一分段失败，下载已取消。")
        try:
            # 全新请求：不含 GitHub Authorization、Cookie 或 Referer，且不跟随重定向。
            request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}",
                "Accept-Encoding": "identity", "User-Agent": "WispLab-release/1"})
            opener = urllib.request.build_opener(NoRedirect())
            with opener.open(request, timeout=SOCKET_TIMEOUT) as response:
                check_range(response, start, end, total)
                received = 0
                expected = end - start + 1
                with output.open("wb") as target:
                    while True:
                        if cancel.is_set() or time.monotonic() > deadline:
                            raise ArtifactError("分段下载已取消或超时。")
                        chunk = response.read(min(64 * 1024, expected - received + 1))
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > expected:
                            raise ArtifactError("Range 实际内容超过声明长度。")
                        target.write(chunk)
                if received != expected:
                    raise ArtifactError("Range 实际内容不足，拒绝拼接。")
            return output
        except ArtifactError:
            raise
        except (OSError, urllib.error.URLError, http.client.HTTPException, ValueError):
            # HTTPError 包含签名 URL，不能直接打印原始异常。
            last_error = ArtifactError("分段下载网络失败；重试后仍未完成。")
            if attempt == 0 and time.monotonic() < deadline:
                continue
    raise last_error from None


def download_ranges(url, size, digest, archive, progress=None):
    download_host(url)
    if type(size) is not int or not 0 < size <= MAX_BYTES or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest or ""):
        raise ArtifactError("GitHub 工件缺少有效大小或 SHA256 摘要，拒绝下载。")
    count = min(WORKERS, max(1, (size + 256 * 1024 - 1) // (256 * 1024)))
    cancel = threading.Event()
    with tempfile.TemporaryDirectory(prefix=".parts-", dir=archive.parent) as temporary:
        parts = [Path(temporary) / str(i) for i in range(count)]
        with ThreadPoolExecutor(max_workers=count) as pool:
            futures = [pool.submit(fetch_part, url, size * i // count, size * (i + 1) // count - 1,
                                   size, path, cancel) for i, path in enumerate(parts)]
            try:
                for finished, future in enumerate(as_completed(futures), 1):
                    future.result()
                    if progress:
                        progress(f"下载分段 {finished}/{count} 完成")
            except BaseException:
                cancel.set()
                for future in futures:
                    future.cancel()
                raise
        actual = hashlib.sha256()
        total = 0
        with archive.open("xb") as target:
            for path in parts:
                with path.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        actual.update(chunk)
                        total += len(chunk)
                        target.write(chunk)
        if total != size or "sha256:" + actual.hexdigest() != digest:
            archive.unlink(missing_ok=True)
            raise ArtifactError("完整工件 SHA256 或长度与 GitHub 元数据不一致，拒绝解压。")


def zip_path(info):
    original = info.orig_filename
    if original != info.filename or not original or original.startswith("/") or "\\" in original or ":" in original or any(ord(c) < 32 or ord(c) == 127 for c in original):
        raise ArtifactError("ZIP 包含不安全路径。")
    name = original[:-1] if info.is_dir() else original
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise ArtifactError("ZIP 包含路径逃逸或不规范路径。")
    mode = info.external_attr >> 16
    kind = stat.S_IFMT(mode)
    if info.flag_bits & 1 or kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR and not info.is_dir()):
        raise ArtifactError("ZIP 包含加密文件、链接或特殊文件。")
    return name


def safe_extract_zip(archive, destination):
    if destination.exists() or destination.is_symlink():
        raise ArtifactError("ZIP 解压目标必须是新的目录。")
    destination.mkdir(mode=0o700)
    try:
        with zipfile.ZipFile(archive) as source:
            members = source.infolist()
            if len(members) > MAX_FILES or sum(info.file_size for info in members) > MAX_BYTES:
                raise ArtifactError("ZIP 文件数或总展开大小超出限制。")
            seen = set()
            validated = []
            for info in members:
                name = zip_path(info)
                key = unicodedata.normalize("NFC", name).casefold()
                if key in seen or info.file_size > MAX_FILE_BYTES or info.file_size < 0:
                    raise ArtifactError("ZIP 包含重复路径或超限文件。")
                seen.add(key)
                validated.append((info, name))
            total = 0
            for info, name in validated:
                target = destination / name
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                received = 0
                with source.open(info) as content, target.open("xb") as output:
                    while True:
                        chunk = content.read(64 * 1024)
                        if not chunk:
                            break
                        received += len(chunk)
                        total += len(chunk)
                        if received > info.file_size or received > MAX_FILE_BYTES or total > MAX_BYTES:
                            raise ArtifactError("ZIP 实际展开大小超出限制。")
                        output.write(chunk)
                if received != info.file_size:
                    raise ArtifactError("ZIP 实际文件大小与记录不一致。")
                target.chmod(0o644)
    except ArtifactError:
        shutil.rmtree(destination)
        raise
    except Exception:
        shutil.rmtree(destination)
        raise ArtifactError("ZIP 解压失败或内容损坏，未保存为完整工件。") from None


def download_artifact(repository, artifact, destination, *, required_file, progress=None):
    destination = Path(destination)
    artifact_id = artifact.get("id")
    size = artifact.get("size_in_bytes")
    digest = artifact.get("digest")
    if repository not in REPOSITORIES or artifact.get("name") not in ("web-dist", "github-pages") or artifact.get("expired") is not False:
        raise ArtifactError("不是受支持且仍有效的 GitHub Actions 工件。")
    if type(size) is not int or not 0 < size <= MAX_BYTES or not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ArtifactError("GitHub 工件大小或 SHA256 摘要缺失，拒绝下载。")
    if required_file not in ("index.html", "artifact.tar"):
        raise ArtifactError("工件入口无效。")
    if destination.exists() or destination.is_symlink():
        raise ArtifactError("完整工件目标已存在，拒绝覆盖。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix=".artifact-", dir=destination.parent) as temporary:
        staging = Path(temporary)
        archive = staging / "artifact.zip"
        download_ranges(signed_url(repository, artifact_id), size, digest, archive, progress)
        extracted = staging / "files"
        safe_extract_zip(archive, extracted)
        if not (extracted / required_file).is_file():
            raise ArtifactError(f"工件缺少 {required_file}，未标记下载完成。")
        if destination.exists() or destination.is_symlink():
            raise ArtifactError("工件目标被其他进程创建，拒绝覆盖。")
        extracted.rename(destination)
    if progress:
        progress(f"工件 SHA256 与安全解压通过：{size:,} bytes，{time.monotonic() - started:.1f} 秒")
    return {"artifactId": artifact_id, "digest": digest, "sizeBytes": size}
