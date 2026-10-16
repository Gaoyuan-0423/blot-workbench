#!/usr/bin/env python3
"""从完整成功 CI 同步发布 GitHub Pages 与 WispLab；仅依赖 Python 标准库和 gh。"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
REPOS = {"wb": "Gaoyuan-0423/blot-workbench", "pathology": "Gaoyuan-0423/pathology-workbench", "pcr": "Gaoyuan-0423/pcr-workbench"}
RELEASE_REPO = REPOS["wb"]
PREFIX = "wisplab-deploy-"
PORTAL_SOURCE = "deployment/wisplab/portal"
HOSTS = ("wisplab.top", "wb.wisplab.top", "pathology.wisplab.top", "pcr.wisplab.top")
VERSION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")


class ReleaseError(Exception):
    pass


def log(message):
    print(message, flush=True)


def command(*args, timeout=180):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                                env={**os.environ, "GH_PROMPT_DISABLED": "1"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseError(f"命令未完成：{args[0]} {args[1]}；可用同一命令恢复。") from error
    if result.returncode:
        # 不回显任意 gh stderr，以免外部 URL/认证信息进入日志。
        raise ReleaseError(f"命令失败（{result.returncode}）：{' '.join(args[:4])}；请检查 gh auth status 和网络。")
    return result.stdout


def api(path):
    return json.loads(command("gh", "api", path))


def optional_api(path):
    try:
        result = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=180,
                                env={**os.environ, "GH_PROMPT_DISABLED": "1"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseError("GitHub 查询未完成；停止以免重复创建。") from error
    if result.returncode and "HTTP 404" in result.stderr:
        return None
    if result.returncode:
        raise ReleaseError("GitHub 查询失败；停止以免重复创建。")
    return json.loads(result.stdout)


def write_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def download_artifact(repository, artifact, destination, *, required_file):
    return load_module("wisplab_artifact_download", "artifact_download.py").download_artifact(
        repository, artifact, destination, required_file=required_file, progress=log)


def validate_version(version):
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        raise ReleaseError("版本必须为 1–80 个英文字母/数字/点/短横线/下划线，首字母为字母或数字。")
    return version


def validate_deployment(document):
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise ReleaseError("deployment.json schemaVersion 必须为 1。")
    validate_version(document.get("version"))
    archive = document.get("archive", {})
    name = archive.get("fileName", "")
    if name != f"wisplab-{document['version']}.tar.gz" or not DIGEST_RE.fullmatch(archive.get("sha256", "")):
        raise ReleaseError("发布附件名称或 SHA256 无效。")
    if set(document.get("sources", {})) != set(REPOS):
        raise ReleaseError("发布清单必须包含三个工具。")
    for site, repo in REPOS.items():
        source = document["sources"][site]
        sha = source.get("gitSha", "")
        if source.get("repository") != repo or not SHA_RE.fullmatch(sha):
            raise ReleaseError(f"{site} 的仓库或 SHA 无效。")
        for phase in ("ci", "pages"):
            record = source.get(phase, {})
            if (record.get("conclusion") != "success" or record.get("headSha") != sha
                    or type(record.get("runId")) is not int or record["runId"] <= 0):
                raise ReleaseError(f"{site} 缺少成功且同 SHA 的 {phase} 记录。")
        if source["pages"].get("commitInput", sha) != sha:
            raise ReleaseError(f"{site} Pages 输入 SHA 不匹配。")
    return document


def matching_ci(run, repo, sha):
    return (run.get("head_sha") == sha and run.get("head_branch") == "main"
            and run.get("head_repository", {}).get("full_name", "").lower() == repo.lower()
            and run.get("event") in ("push", "workflow_dispatch"))


def get_ci(repo, sha, timeout):
    deadline = time.monotonic() + timeout
    while True:
        response = api(f"repos/{repo}/actions/workflows/ci.yml/runs?head_sha={sha}&branch=main&per_page=100")
        runs = [run for run in response["workflow_runs"] if matching_ci(run, repo, sha)]
        successful = [run for run in runs if run.get("status") == "completed" and run.get("conclusion") == "success"]
        if successful:
            # 与现有 Pages workflow 一致：选择 API 返回的首个完整成功 CI。
            run = successful[0]
            artifacts = api(f"repos/{repo}/actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
            artifacts = [a for a in artifacts if a["name"] == "web-dist" and not a["expired"]]
            if len(artifacts) != 1:
                raise ReleaseError(f"{repo} {sha[:7]} 的 web-dist 缺失或已过期；先 gh run rerun {run['id']} --repo {repo}，待完整 CI 后重试；字节不同会阻止回滚。")
            return run, artifacts[0]
        active = any(run.get("status") != "completed" for run in runs)
        if runs and not active:
            raise ReleaseError(f"{repo} {sha[:7]} 没有完整成功 CI；最新结果：{runs[0].get('conclusion')}。")
        if time.monotonic() >= deadline:
            raise ReleaseError(f"等待 {repo} {sha[:7]} 完整 CI 超时。")
        log(f"等待 CI：{repo} {sha[:7]}")
        time.sleep(20)


def record_ci(run, artifact):
    return {"runId": run["id"], "headSha": run["head_sha"], "conclusion": "success",
            "runUrl": run["html_url"], "artifactId": artifact["id"], "artifactName": "web-dist",
            "artifactDigest": artifact.get("digest")}


def file_hashes(folder):
    result = {}
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            raise ReleaseError(f"CI 产物包含符号链接：{path.name}")
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha256(path)
    return result


def check_rollback_bytes(manifest, sources, artifact_dirs):
    if manifest.get("schemaVersion") != 1 or set(manifest.get("sites", {})) != {"portal", *REPOS}:
        raise ReleaseError("归档的 release.json 格式无效。")
    for site, source in sources.items():
        old = manifest["sites"][site]
        if old.get("gitSha") != source["gitSha"] or old.get("repository") != source["repository"]:
            raise ReleaseError(f"{site} 归档来源与 deployment.json 不一致。")
        if file_hashes(artifact_dirs[site]) != old.get("files"):
            raise ReleaseError(f"{site} 当前可取的 CI 产物与旧发布归档不逐文件一致，不能声称同一版本回滚；请检查依赖/产物变化并创建新版本。")


def parse_dispatch_url(output, repo):
    matches = re.findall(r"https://github\.com/" + re.escape(repo) + r"/actions/runs/(\d+)", output, re.I)
    if len(matches) != 1:
        raise ReleaseError("Pages dispatch 未返回唯一 run URL；结果未知，停止以免重复触发。检查 Actions 后把准确 runId 写入本地 state 再恢复。")
    return int(matches[0])


def pages_tar_hashes(path):
    hashes = {}
    total = 0
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            name = member.name
            while name.startswith("./"):
                name = name[2:]
            if member.isdir():
                continue
            if (not member.isfile() or not name or name.startswith("/") or "\\" in name
                    or any(part in ("", ".", "..") for part in name.split("/")) or name in hashes):
                raise ReleaseError("Pages artifact 含链接、重复或不安全路径。")
            total += member.size
            if len(hashes) >= 10000 or total > 512 * 1024 * 1024:
                raise ReleaseError("Pages artifact 超出静态产物限制。")
            digest = hashlib.sha256()
            with archive.extractfile(member) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            hashes[name] = digest.hexdigest()
    return hashes


def require_asset_digest(asset, path):
    if not asset or asset.get("size") != path.stat().st_size:
        raise ReleaseError("公开前附件核验失败；保留草稿供检查。")
    if asset.get("digest") != "sha256:" + sha256(path):
        raise ReleaseError("公开前附件 SHA256 缺失或不一致；保留草稿。")


class Release:
    def __init__(self, args):
        self.args = args
        self.version = validate_version(args.version)
        self.tag = PREFIX + self.version
        self.folder = args.output_dir.resolve() / self.version
        self.folder.mkdir(parents=True, exist_ok=True)
        self.state_path = self.folder / "state.json"
        self.lock = (self.folder / ".lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError("该版本已有发布进程，等待它结束后重试。") from error
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {
            "schemaVersion": 1, "version": self.version, "tag": self.tag, "sources": {}, "pages": {}}
        if (self.state.get("schemaVersion") != 1 or self.state.get("version") != self.version
                or self.state.get("tag") != self.tag):
            raise ReleaseError("本地状态版本与命令不一致，拒绝恢复。")
        requested_rollback = getattr(args, "release_tag", None)
        if self.state.get("rollbackFrom") != requested_rollback and self.state_path.exists():
            raise ReleaseError("该版本已用于不同的发布/回滚操作，请使用原命令或新版本。")
        if requested_rollback:
            self.state["rollbackFrom"] = requested_rollback

    def save(self):
        write_json(self.state_path, self.state)

    def sources(self):
        if self.state["sources"]:
            if set(self.state["sources"]) != set(REPOS):
                raise ReleaseError("本地状态必须包含三个固定仓库。")
            for site, source in self.state["sources"].items():
                if source.get("repository") != REPOS[site] or not SHA_RE.fullmatch(source.get("gitSha", "")):
                    raise ReleaseError(f"{site} 本地状态仓库或 SHA 无效。")
            return
        if self.state.get("rollbackFrom"):
            tag = self.state["rollbackFrom"]
            if not tag.startswith(PREFIX) or not VERSION_RE.fullmatch(tag[len(PREFIX):]):
                raise ReleaseError("只能回滚 wisplab-deploy- 前缀的既有发布。")
            release = api(f"repos/{RELEASE_REPO}/releases/tags/{tag}")
            if release["draft"] or release["prerelease"]:
                raise ReleaseError("不能回滚草稿或预发布。")
            destination = self.folder / "rollback-input"
            destination.mkdir(exist_ok=True)
            command("gh", "release", "download", tag, "--repo", RELEASE_REPO, "--pattern", "deployment.json", "--dir", str(destination), "--clobber", timeout=900)
            document = validate_deployment(json.loads((destination / "deployment.json").read_text()))
            command("gh", "release", "download", tag, "--repo", RELEASE_REPO, "--pattern", document["archive"]["fileName"], "--dir", str(destination), "--clobber", timeout=900)
            archive = destination / document["archive"]["fileName"]
            if sha256(archive) != document["archive"]["sha256"]:
                raise ReleaseError("旧发布归档的 SHA256 不一致。")
            manifest, _ = load_module("wisplab_deploy", "deploy.py").read_archive(archive, document["archive"]["sha256"], document["version"])
            self.state["archive"] = {**document["archive"], "path": str(archive)}
            self.state["bundleVersion"] = document["version"]
            self.state["manifest"] = manifest
            self.state["sources"] = {site: {"repository": REPOS[site], "gitSha": document["sources"][site]["gitSha"]} for site in REPOS}
        else:
            for site, repo in REPOS.items():
                sha = api(f"repos/{repo}/git/ref/heads/main")["object"]["sha"]
                if not SHA_RE.fullmatch(sha):
                    raise ReleaseError(f"{repo} main SHA 无效。")
                self.state["sources"][site] = {"repository": repo, "gitSha": sha}
            self.state["bundleVersion"] = self.version
        self.save()

    def artifacts(self):
        folders = {}
        for site, source in self.state["sources"].items():
            run, artifact = get_ci(source["repository"], source["gitSha"], self.args.timeout)
            folder = self.folder / "artifacts" / site
            stored = source.get("ci", {})
            verified_cache = (stored.get("artifactId") == artifact["id"]
                              and stored.get("artifactDigest") == artifact.get("digest")
                              and stored.get("archiveDigestVerified") is True)
            if not verified_cache and folder.exists():
                shutil.rmtree(folder)
            if not folder.exists():
                folder.parent.mkdir(exist_ok=True)
                log(f"下载完整成功 CI：{site} {source['gitSha'][:7]} / run {run['id']}")
                download_artifact(source["repository"], artifact, folder, required_file="index.html")
            source["ci"] = record_ci(run, artifact)
            source["ci"]["archiveDigestVerified"] = True
            folders[site] = folder
            self.save()
        return folders

    def portal(self):
        if self.args.portal:
            log("使用显式 --portal 暂存首页；这只用于首次迁移，正式发布默认取 WB 提交内首页。")
            return self.args.portal.resolve(), None
        folder = self.folder / "portal"
        folder.mkdir(exist_ok=True)
        sha = self.state["sources"]["wb"]["gitSha"]
        for name in ("index.html", "styles.css", "favicon.svg"):
            data = api(f"repos/{RELEASE_REPO}/contents/{PORTAL_SOURCE}/{name}?ref={sha}")
            if data.get("type") != "file" or data.get("encoding") != "base64":
                raise ReleaseError("WB 提交中缺少可发布的 portal 文件。")
            (folder / name).write_bytes(base64.b64decode(data["content"], validate=False))
        return folder, {"repository": RELEASE_REPO, "gitSha": sha, "sourcePath": PORTAL_SOURCE}

    def prepare(self):
        self.sources()
        folders = self.artifacts()
        if self.state.get("rollbackFrom"):
            check_rollback_bytes(self.state["manifest"], self.state["sources"], folders)
        elif "archive" not in self.state:
            packager = load_module("wisplab_packager", "package-release.py")
            portal, provenance_portal = self.portal()
            provenance = {"schemaVersion": 1, "sites": {site: {
                "repository": source["repository"], "gitSha": source["gitSha"],
                "runId": source["ci"]["runId"], "artifactName": "web-dist",
                "artifactId": source["ci"]["artifactId"], "runUrl": source["ci"]["runUrl"],
                **({"artifactDigest": source["ci"]["artifactDigest"]} if source["ci"].get("artifactDigest") else {})
            } for site, source in self.state["sources"].items()}}
            if provenance_portal:
                provenance["portal"] = provenance_portal
            write_json(self.folder / "ci-provenance.json", provenance)
            orphan = self.folder / f"wisplab-{self.version}.tar.gz"
            if orphan.exists():
                # 处理 archive 写完、state 尚未落盘时的中断，不覆盖已存在产物。
                expected = packager.package_ci_release(version=self.version, portal=portal, artifact_dirs=folders,
                                                       provenance=provenance, output_dir=self.folder, check_only=True)
                digest = sha256(orphan)
                manifest, _ = load_module("wisplab_deploy", "deploy.py").read_archive(orphan, digest, self.version)
                if manifest["sites"] != expected["manifest"]["sites"]:
                    raise ReleaseError("未登记的同名归档与本次 CI/首页输入不同；请检查后使用新版本。")
                result = {"archive": str(orphan), "sha256": digest, "manifest": manifest}
            else:
                result = packager.package_ci_release(version=self.version, portal=portal, artifact_dirs=folders,
                                                     provenance=provenance, output_dir=self.folder)
            archive = Path(result["archive"])
            self.state["archive"] = {"fileName": archive.name, "sha256": result["sha256"], "path": str(archive)}
            self.state["manifest"] = result["manifest"]
            self.save()
        archive = Path(self.state["archive"]["path"])
        if sha256(archive) != self.state["archive"]["sha256"]:
            raise ReleaseError("本地缓存的发布包发生变化，拒绝继续。")
        # 恢复运行时也重新校验 CI 与缓存包的逐文件一致性。
        check_rollback_bytes(self.state["manifest"], self.state["sources"], folders)
        log(f"已准备：{self.tag}；归档 {archive.name} / {self.state['archive']['sha256']}")

    def verify_pages_build(self, site, source, run):
        record = self.state["pages"][site]
        attempt = run.get("run_attempt", 1)
        if record.get("verifiedRunAttempt") == attempt and record.get("verifiedRunId") == run["id"]:
            return
        repo = source["repository"]
        jobs = api(f"repos/{repo}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=100")["jobs"]
        verify = [job for job in jobs if job["name"] == "verify" and job.get("conclusion") == "success"]
        if len(verify) != 1:
            raise ReleaseError(f"{site} Pages 缺少唯一成功 verify job。")
        output = command("gh", "run", "view", str(run["id"]), "--repo", repo, "--job", str(verify[0]["id"]), "--log")
        inputs = set(re.findall(r"\bDEPLOY_COMMIT:\s*([0-9a-f]{40})\b", output))
        if inputs != {source["gitSha"]}:
            raise ReleaseError(f"{site} Pages 实际 commit 输入与所选 SHA 不一致；检查恢复 run ID。")
        artifacts = api(f"repos/{repo}/actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
        artifacts = [item for item in artifacts if item["name"] == "github-pages" and not item["expired"]]
        if len(artifacts) != 1:
            raise ReleaseError(f"{site} Pages 产物已过期或不可用；重跑该 Pages run 后重试。")
        with tempfile.TemporaryDirectory(prefix=f".pages-{site}-", dir=self.folder) as temporary:
            log(f"核对 Pages 实际部署字节：{site} / run {run['id']}")
            destination = Path(temporary) / "pages"
            download_artifact(repo, artifacts[0], destination, required_file="artifact.tar")
            path = destination / "artifact.tar"
            if not path.is_file() or pages_tar_hashes(path) != self.state["manifest"]["sites"][site]["files"]:
                raise ReleaseError(f"{site} Pages 实际产物与服务器包不同；可能在准备后重新执行过同 SHA CI。未公开新服务器版本，请核对并使用新版本重发。")
        record["verifiedRunAttempt"] = attempt
        record["verifiedRunId"] = run["id"]
        record["verifiedArtifactId"] = artifacts[0]["id"]
        record["verifiedFiles"] = True
        self.save()

    def deploy_pages(self):
        for site, source in self.state["sources"].items():
            record = self.state["pages"].get(site)
            if not record:
                # 写入 pending 标记后才派发；若网络响应未知，不自动重复派发。
                self.state["pages"][site] = {"status": "dispatch-pending", "commitInput": source["gitSha"]}
                self.save()
                output = command("gh", "workflow", "run", "pages.yml", "--repo", source["repository"], "--ref", "main", "-f", f"commit={source['gitSha']}")
                run_id = parse_dispatch_url(output, source["repository"])
                record = {"runId": run_id, "status": "queued", "commitInput": source["gitSha"]}
                self.state["pages"][site] = record
                self.save()
            if not record.get("runId"):
                raise ReleaseError(f"{site} Pages dispatch 结果未知；检查 Actions 后在 {self.state_path} 的 pages.{site}.runId 填入准确 ID，勿重复派发。")
        deadline = time.monotonic() + self.args.timeout
        while True:
            complete = True
            for site, source in self.state["sources"].items():
                record = self.state["pages"][site]
                run = api(f"repos/{source['repository']}/actions/runs/{record['runId']}")
                if run.get("path", "").split("@")[0] != ".github/workflows/pages.yml" or run.get("event") != "workflow_dispatch" or run.get("head_branch") != "main":
                    raise ReleaseError(f"{site} 记录的 run 不是 main 上的 Pages dispatch。")
                record.update(status=run["status"], conclusion=run.get("conclusion"), workflowHeadSha=run["head_sha"],
                              headSha=source["gitSha"], runUrl=run["html_url"])
                self.save()
                if run["status"] == "completed" and run["conclusion"] != "success":
                    raise ReleaseError(f"{site} Pages {record['runId']} 失败：{run['conclusion']}；修复原因后 gh run rerun {record['runId']} --repo {source['repository']}，再恢复发布。")
                complete &= run["status"] == "completed"
            if complete:
                for site, source in self.state["sources"].items():
                    record = self.state["pages"][site]
                    run = api(f"repos/{source['repository']}/actions/runs/{record['runId']}")
                    if run["status"] != "completed" or run["conclusion"] != "success":
                        raise ReleaseError(f"{site} Pages 状态在校验前变化，请恢复重试。")
                    self.verify_pages_build(site, source, run)
                log("三个 Pages 已全部成功；现在发布供服务器拉取的版本。")
                return
            if time.monotonic() >= deadline:
                raise ReleaseError("等待 Pages 超时；未公开新服务器版本。")
            log("等待 Pages：" + ", ".join(f"{site}={record['status']}" for site, record in self.state["pages"].items()))
            time.sleep(20)

    def publish_release(self):
        document = {"schemaVersion": 1, "version": self.state["bundleVersion"],
                    "archive": {key: self.state["archive"][key] for key in ("fileName", "sha256")},
                    "sources": {site: {**source, "pages": self.state["pages"][site]} for site, source in self.state["sources"].items()}}
        if self.state.get("rollbackFrom"):
            document["rollbackFrom"] = self.state["rollbackFrom"]
        validate_deployment(document)
        path = self.folder / "deployment.json"
        write_json(path, document)
        notes = self.folder / "release-notes.md"
        notes.write_text("WispLab 统一发布。三站使用完整成功 CI 的同一份静态产物，Pages 已成功。服务器自动拉取后逐站验证。\n\n" +
                         "\n".join(f"- {site}: `{source['gitSha']}`，CI {source['ci']['runId']}，Pages {self.state['pages'][site]['runId']}" for site, source in self.state["sources"].items()) + "\n", encoding="utf-8")
        release = optional_api(f"repos/{RELEASE_REPO}/releases/tags/{self.tag}")
        if release and not self.state.get("releaseCreateStarted"):
            raise ReleaseError(f"{self.tag} 已存在，但不属于本地恢复状态；不会覆盖。")
        if not release:
            existing_tag = optional_api(f"repos/{RELEASE_REPO}/git/ref/tags/{self.tag}")
            if existing_tag and api(f"repos/{RELEASE_REPO}/commits/{self.tag}")["sha"] != self.state["sources"]["wb"]["gitSha"]:
                raise ReleaseError("同名 Git tag 指向其他提交，不会覆盖。")
            self.state["releaseCreateStarted"] = True
            self.save()
            command("gh", "release", "create", self.tag, str(path), self.state["archive"]["path"], "--repo", RELEASE_REPO,
                    "--target", self.state["sources"]["wb"]["gitSha"], "--title", f"WispLab {self.version}", "--notes-file", str(notes), "--draft", "--latest=false", timeout=900)
            release = api(f"repos/{RELEASE_REPO}/releases/tags/{self.tag}")
        if release.get("prerelease"):
            raise ReleaseError("该 release 意外成为预发布，停止发布。")
        assets = {asset["name"]: asset for asset in release["assets"]}
        for file in (path, Path(self.state["archive"]["path"])):
            asset = assets.get(file.name)
            if not asset and release["draft"]:
                command("gh", "release", "upload", self.tag, str(file), "--repo", RELEASE_REPO, timeout=900)
                fresh = api(f"repos/{RELEASE_REPO}/releases/tags/{self.tag}")
                asset = next((item for item in fresh["assets"] if item["name"] == file.name), None)
            require_asset_digest(asset, file)
        if release["draft"]:
            command("gh", "release", "edit", self.tag, "--repo", RELEASE_REPO, "--draft=false", "--latest=false")
            release = api(f"repos/{RELEASE_REPO}/releases/tags/{self.tag}")
        self.state["releasePublished"] = True
        self.state["releaseUrl"] = release["html_url"]
        self.save()
        log(f"已公开：{release['html_url']}；等待服务器更新。")

    def wait_server(self):
        deadline = time.monotonic() + self.args.server_timeout
        expected = self.state["manifest"]
        def inspect(host):
            try:
                request = urllib.request.Request(f"https://{host}/release.json?release={self.tag}&t={int(time.time())}", headers={"Cache-Control": "no-cache", "User-Agent": "WispLab-release/1"})
                with urllib.request.urlopen(request, timeout=12) as response:
                    data = json.loads(response.read(4 * 1024 * 1024))
                if data.get("version") != expected["version"] or data.get("sites") != expected["sites"]:
                    return host, {"status": "waiting", "version": data.get("version")}
                return host, {"status": "success", "version": data["version"]}
            except (OSError, ValueError, urllib.error.URLError):
                return host, {"status": "unavailable"}
        while True:
            with ThreadPoolExecutor(max_workers=4) as pool:
                self.state["server"] = dict(pool.map(inspect, HOSTS))
            self.save()
            if all(item["status"] == "success" for item in self.state["server"].values()):
                log("已完成：三个 Pages 成功，四个自有域的 release.json 版本、来源和文件清单一致。")
                return
            if time.monotonic() >= deadline:
                raise ReleaseError("服务器验收超时；Pages 已成功且 Release 已公开，自有域尚未全部一致。检查 updater/timer 后用同一命令恢复；若此前手动 pin 旧版，需要管理员明确执行 update.py --resume 才恢复自动更新。")
            log("等待服务器：" + ", ".join(f"{host}={info['status']}({info.get('version', '-')})" for host, info in self.state["server"].items()))
            time.sleep(20)

    def run(self):
        if not self.state.get("releasePublished"):
            self.prepare()
            if self.args.action == "plan":
                log("预览完成：未触发 Pages、未创建/公开 Release、未改服务器。")
                return
            self.deploy_pages()
            self.publish_release()
        elif self.args.action == "plan":
            log("该版本已公开；plan 不更改发布状态。")
            return
        self.wait_server()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("action", choices=("plan", "publish", "rollback"))
    result.add_argument("release_tag", nargs="?", help="rollback 的既有 wisplab-deploy-* tag")
    result.add_argument("--version", required=True, help="本次操作版本；回滚也使用新的操作版本")
    result.add_argument("--output-dir", type=Path, default=HERE / "releases", help="本地恢复状态和产物目录")
    result.add_argument("--portal", type=Path, help="首次迁移才使用；默认从 WB 锁定 SHA 获取已提交首页")
    result.add_argument("--timeout", type=int, default=7200, help="等待完整 CI / Pages 的秒数")
    result.add_argument("--server-timeout", type=int, default=600, help="等待四域服务器验收的秒数")
    return result


def main():
    args = parser().parse_args()
    if (args.action == "rollback") != bool(args.release_tag):
        parser().error("只有 rollback 必须提供既有 release tag。")
    if args.timeout <= 0 or args.server_timeout <= 0:
        parser().error("等待时间必须为正数。")
    release = None
    try:
        release = Release(args)
        release.run()
        return 0
    except Exception as error:
        print(f"发布未完成：{error}", file=sys.stderr)
        if release:
            print("当前状态：" + json.dumps({"pages": release.state.get("pages"), "releasePublished": release.state.get("releasePublished", False), "server": release.state.get("server", {})}, ensure_ascii=False), file=sys.stderr)
        print("恢复重试：" + shlex.join([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]), file=sys.stderr)
        print("各主机按顺序更新，失败时可能存在暂时版本差异；不是跨主机原子发布。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
