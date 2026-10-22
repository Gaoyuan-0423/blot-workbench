#!/usr/bin/env python3
"""Real PocketBase black-box tests. Only temporary local data and synthetic ZIPs."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from download import ROOT, LOCK, install

PASSWORD = "Synthetic-test-password-2026!"


def synthetic_package(size=160, value="synthetic"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps({"format": "synthetic-test-only", "value": value}))
        archive.writestr("pixels.bin", bytes(range(256))[:size] if size <= 256 else b"x" * size)
    return buffer.getvalue()


class Backend:
    def __init__(self, **limits):
        self.temporary = tempfile.TemporaryDirectory(prefix="wisplab-cloud-test-")
        self.path = Path(self.temporary.name)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.log = open(self.path / "server.log", "w+")
        binary = Path(os.environ.get("WISPLAB_TEST_BINARY", ROOT / ".runtime/bin/pocketbase"))
        if not binary.exists():
            binary = install(ROOT / ".runtime/bin")
        version = subprocess.check_output([str(binary), "--version"], text=True)
        if LOCK["version"] not in version:
            raise AssertionError("Tests require the pinned PocketBase version")
        env = {**os.environ, "WISPLAB_ENV": "production", "WISPLAB_REGISTRATION": "open", "WISPLAB_PROJECT_STORAGE": "cloud", "WISPLAB_MAX_FILE_BYTES": "2048", "WISPLAB_USER_BYTES": "20000", "WISPLAB_TOTAL_BYTES": "40000", "WISPLAB_MAX_PROJECTS": "10", "WISPLAB_MAX_REVISIONS": "10"}
        for key, value in limits.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = str(value)
        self.process = subprocess.Popen([str(binary), "serve", "--hooksWatch=false", f"--http=127.0.0.1:{self.port}", f"--dir={self.path / 'data'}", f"--hooksDir={ROOT / 'pb_hooks'}", f"--migrationsDir={ROOT / 'pb_migrations'}", "--origins=https://wisplab.top,https://wb.wisplab.top,https://pathology.wisplab.top,https://pcr.wisplab.top,https://gaoyuan-0423.github.io,app://wisplab"], env=env, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(160):
            if self.process.poll() is not None:
                self.log.seek(0)
                message = self.log.read()
                self.close()
                raise AssertionError("PocketBase failed to start: " + message[:3000])
            try:
                if self.request("GET", "/api/health")[0] == 200:
                    return
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(0.05)
        self.close()
        raise AssertionError("PocketBase startup timed out")

    def close(self):
        if hasattr(self, "process") and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=15)
        self.log.close()
        self.temporary.cleanup()

    def request(self, method, path, body=None, token=None, headers=None):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = token
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, body, headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            if response.headers.get_content_type() == "application/json":
                content = json.loads(content)
            return response.status, content, dict(response.headers)

    def account(self, name):
        status, user, _ = self.request("POST", "/api/collections/users/records", {"username": name, "password": PASSWORD, "passwordConfirm": PASSWORD})
        assert status == 200, (status, user)
        status, auth, _ = self.request("POST", "/api/collections/users/auth-with-password", {"identity": name, "password": PASSWORD})
        assert status == 200, (status, auth)
        return auth["token"], user

    def project(self, token, name="Synthetic project"):
        status, project, _ = self.request("POST", "/api/wisplab/projects", {"title": name, "tool": "wb-single"}, token)
        assert status == 201, (status, project)
        return project

    def upload(self, token, project, data=None, base="", filename="project.zip", **extra):
        data = synthetic_package() if data is None else data
        fields = {"baseRevision": base, "sha256": hashlib.sha256(data).hexdigest(), "schemaVersion": "1", "appVersion": "synthetic-test-1", **extra}
        boundary = "wisplab-synthetic-boundary"
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/zip\r\n\r\n'.encode(), data, f"\r\n--{boundary}--\r\n".encode()])
        return self.request("POST", f"/api/wisplab/projects/{project['id']}/snapshots", b"".join(parts), token, {"Content-Type": f"multipart/form-data; boundary={boundary}"})


class CloudIntegration(unittest.TestCase):
    def setUp(self):
        self.backend = Backend()
        self.addCleanup(self.backend.close)
        self.alice, self.alice_user = self.backend.account("alice")
        self.bob, self.bob_user = self.backend.account("bob")

    def test_account_deletion_requires_reauth_and_erases_only_owner(self):
        b = self.backend
        own = b.project(self.alice)
        other = b.project(self.bob)
        self.assertEqual(b.upload(self.alice, own)[0], 201)
        self.assertEqual(b.upload(self.bob, other)[0], 201)
        confirmation = {"password": PASSWORD, "confirmUsername": "alice"}
        self.assertIn(b.request("POST", "/api/wisplab/delete-account", confirmation)[0], (401, 403))
        self.assertEqual(b.request("POST", "/api/wisplab/delete-account", {**confirmation, "password": "wrong"}, self.alice)[0], 400)
        self.assertEqual(b.request("POST", "/api/wisplab/delete-account", {**confirmation, "confirmUsername": "bob"}, self.alice)[0], 400)
        self.assertEqual(b.request("POST", "/api/wisplab/delete-account", {**confirmation, "owner": self.bob_user["id"]}, self.alice)[0], 400)
        self.assertEqual(b.request("POST", "/api/wisplab/delete-account", confirmation, self.alice)[0], 204)
        self.assertNotEqual(b.request("POST", "/api/collections/users/auth-refresh", token=self.alice)[0], 200)
        self.assertNotEqual(b.request("POST", "/api/collections/users/auth-with-password", {"identity": "alice", "password": PASSWORD})[0], 200)
        self.assertEqual(b.request("POST", "/api/collections/users/auth-refresh", token=self.bob)[0], 200)
        with sqlite3.connect(b.path / "data/data.db") as db:
            for table in ("cloud_snapshots", "cloud_projects"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table} WHERE owner = ?", (self.alice_user["id"],)).fetchone()[0], 0)
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table} WHERE owner = ?", (self.bob_user["id"],)).fetchone()[0], 1)
        # File deletion runs in PocketBase's after-success lifecycle.
        self.assertEqual(len(list((b.path / "data/storage").rglob("*.zip"))), 1)

    def test_account_deletion_works_with_local_only_service(self):
        b = Backend(WISPLAB_PROJECT_STORAGE="local")
        self.addCleanup(b.close)
        token, _ = b.account("disposable")
        self.assertEqual(b.request("POST", "/api/wisplab/delete-account", {"password": PASSWORD, "confirmUsername": "disposable"}, token)[0], 204)

    def test_headless_start_does_not_create_or_print_installer_credentials(self):
        b = self.backend
        with sqlite3.connect(b.path / "data" / "data.db") as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM _superusers").fetchone()[0], 0)
        b.log.flush()
        b.log.seek(0)
        self.assertNotIn("/pbinstall/", b.log.read())

    def test_explicit_cloud_mode_reports_capabilities(self):
        status, body, headers = self.backend.request("GET", "/api/wisplab/capabilities")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"version": 1, "accounts": True, "registration": "open", "projectStorage": "cloud"})
        self.assertIn("no-store", headers.get("Cache-Control", ""))

    def test_registration_login_and_user_privacy(self):
        b = self.backend
        self.assertEqual(b.request("POST", "/api/collections/users/auth-with-password", {"identity": "alice", "password": "incorrect-password"})[0], 400)
        self.assertEqual(b.request("POST", "/api/collections/users/records", {"username": "alice", "password": PASSWORD, "passwordConfirm": PASSWORD})[0], 400)
        self.assertEqual(b.request("POST", "/api/collections/users/records", {"username": "Uppercase", "password": PASSWORD, "passwordConfirm": PASSWORD})[0], 400)
        self.assertEqual(b.request("POST", "/api/collections/users/records", {"username": "shortpass", "password": "123456789", "passwordConfirm": "123456789"})[0], 400)
        self.assertEqual(b.request("GET", "/api/collections/users/records", token=self.alice)[0], 403)
        self.assertEqual(b.request("GET", f"/api/collections/users/records/{self.bob_user['id']}", token=self.alice)[0], 404)

    def test_private_files_and_exact_binary_roundtrip(self):
        b = self.backend
        project = b.project(self.alice)
        payload = synthetic_package(256)
        status, saved, _ = b.upload(self.alice, project, payload)
        self.assertEqual(status, 201, saved)
        snap = saved["snapshot"]
        self.assertEqual(snap["sizeBytes"], len(payload))
        self.assertEqual(b.request("GET", "/api/collections/cloud_projects/records", token=self.bob)[1]["items"], [])
        self.assertEqual(b.request("GET", "/api/collections/cloud_snapshots/records", token=self.bob)[1]["items"], [])
        self.assertEqual(b.request("GET", f"/api/collections/cloud_snapshots/records/{snap['id']}", token=self.bob)[0], 404)
        self.assertEqual(b.upload(self.bob, project)[0], 404)
        self.assertEqual(b.request("PATCH", f"/api/wisplab/projects/{project['id']}", {"archived": True}, self.bob)[0], 404)
        file_url = f"/api/files/cloud_snapshots/{snap['id']}/{snap['file']}"
        self.assertIn(b.request("GET", file_url)[0], (401, 403, 404))
        bob_file_token = b.request("POST", "/api/files/token", token=self.bob)[1]["token"]
        self.assertIn(b.request("GET", file_url + "?token=" + bob_file_token)[0], (401, 403, 404))
        alice_file_token = b.request("POST", "/api/files/token", token=self.alice)[1]["token"]
        status, downloaded, headers = b.request("GET", file_url + "?token=" + alice_file_token + "&download=1")
        self.assertEqual(status, 200)
        self.assertEqual(downloaded, payload)
        self.assertEqual(hashlib.sha256(downloaded).hexdigest(), snap["sha256"])
        self.assertIn("no-store", headers.get("Cache-Control", ""))

    def test_immutable_history_and_archive_restore(self):
        b = self.backend
        project = b.project(self.alice)
        status, first, _ = b.upload(self.alice, project)
        self.assertEqual(status, 201, first)
        status, second, _ = b.upload(self.alice, project, base=first["snapshot"]["id"])
        self.assertEqual(status, 201, second)
        self.assertEqual(second["snapshot"]["revision"], 2)
        sid = first["snapshot"]["id"]
        for method, path, data in [("PATCH", f"/api/collections/cloud_snapshots/records/{sid}", {"sha256": "0" * 64}), ("DELETE", f"/api/collections/cloud_snapshots/records/{sid}", None), ("DELETE", f"/api/collections/cloud_projects/records/{project['id']}", None), ("POST", "/api/collections/cloud_snapshots/records", {"owner": self.alice_user["id"]})]:
            self.assertEqual(b.request(method, path, data, self.alice)[0], 403)
        self.assertEqual(b.request("PATCH", f"/api/wisplab/projects/{project['id']}", {"archived": True}, self.alice)[0], 200)
        archived = b.upload(self.alice, project, base=second["snapshot"]["id"])
        self.assertEqual(archived[0], 409)
        self.assertEqual(archived[1]["data"]["code"]["code"], "project_archived")
        self.assertEqual(len(b.request("GET", "/api/collections/cloud_snapshots/records", token=self.alice)[1]["items"]), 2)
        self.assertEqual(b.request("PATCH", f"/api/wisplab/projects/{project['id']}", {"archived": False}, self.alice)[0], 200)
        self.assertEqual(b.upload(self.alice, project, base=second["snapshot"]["id"])[0], 201)

    def test_parallel_same_base_creates_only_one_revision(self):
        b = self.backend
        project = b.project(self.alice)
        with ThreadPoolExecutor(max_workers=2) as workers:
            responses = list(workers.map(lambda _: b.upload(self.alice, project), range(2)))
        self.assertEqual(sorted(r[0] for r in responses), [201, 409], responses)
        self.assertEqual(next(r for r in responses if r[0] == 409)[1]["data"]["code"]["code"], "revision_conflict")
        snapshots = b.request("GET", "/api/collections/cloud_snapshots/records", token=self.alice)[1]["items"]
        self.assertEqual(len(snapshots), 1)
        usage = b.request("GET", "/api/wisplab/usage", token=self.alice)[1]
        self.assertEqual(usage["usedBytes"], len(synthetic_package()))

    def test_limits_file_type_and_invalid_metadata_are_atomic(self):
        b = self.backend
        project = b.project(self.alice)
        self.assertEqual(b.upload(self.alice, project, synthetic_package(2100))[0], 413)
        self.assertEqual(b.upload(self.alice, project, b"<html>untrusted</html>", filename="project.zip")[0], 400)
        self.assertEqual(b.upload(self.alice, project, filename="project.exe")[0], 400)
        self.assertEqual(b.upload(self.alice, project, sha256="incorrect")[0], 400)
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=self.alice)[1]["usedBytes"], 0)
        item = b.request("GET", f"/api/collections/cloud_projects/records/{project['id']}", token=self.alice)[1]
        self.assertEqual(item["currentRevision"], "")

    def test_json_snapshot_with_unicode_is_supported(self):
        b = self.backend
        project = b.project(self.alice)
        data = json.dumps({"format": "synthetic-test-only", "note": "实验同步"}, ensure_ascii=False).encode()
        status, saved, _ = b.upload(self.alice, project, data, filename="project.json")
        self.assertEqual(status, 201, saved)
        self.assertEqual(saved["snapshot"]["sizeBytes"], len(data))

    def test_token_refresh_and_account_wide_revocation(self):
        b = self.backend
        project = b.project(self.alice)
        status, saved, _ = b.upload(self.alice, project)
        self.assertEqual(status, 201, saved)
        old_file_token = b.request("POST", "/api/files/token", token=self.alice)[1]["token"]
        claims = json.loads(base64.urlsafe_b64decode(self.alice.split(".")[1] + "=="))
        self.assertGreater(claims["exp"], time.time() + 3500)
        status, refreshed, _ = b.request("POST", "/api/collections/users/auth-refresh", token=self.alice)
        self.assertEqual(status, 200)
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=refreshed["token"])[0], 200)
        self.assertEqual(b.request("GET", "/api/wisplab/usage")[0], 401)
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=self.alice[:-10] + "invalidxxx")[0], 401)
        self.assertEqual(b.request("POST", "/api/wisplab/logout-all", token=self.alice)[0], 204)
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=self.alice)[0], 401)
        self.assertEqual(b.request("POST", "/api/collections/users/auth-refresh", token=refreshed["token"])[0], 401)
        snap = saved["snapshot"]
        self.assertIn(b.request("GET", f"/api/files/cloud_snapshots/{snap['id']}/{snap['file']}?token={old_file_token}")[0], (401, 403, 404))
        self.assertEqual(b.request("POST", "/api/collections/users/auth-with-password", {"identity": "alice", "password": PASSWORD})[0], 200)

    def test_registration_and_password_attempts_are_rate_limited(self):
        b = self.backend
        statuses = [b.request("POST", "/api/collections/users/auth-with-password", {"identity": "alice", "password": "incorrect-password"})[0] for _ in range(21)]
        self.assertIn(429, statuses)

    def test_origins_are_explicit(self):
        b = self.backend
        for origin in ("https://evil.example", "null", "https://wisplab.top.evil.example", "http://localhost:5173"):
            self.assertEqual(b.request("OPTIONS", "/api/wisplab/projects", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})[0], 403)
        status, _, headers = b.request("OPTIONS", "/api/wisplab/projects", headers={"Origin": "https://wisplab.top", "Access-Control-Request-Method": "POST"})
        self.assertIn(status, (200, 204))
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://wisplab.top")


class AccountsOnly(unittest.TestCase):
    def test_missing_or_empty_storage_mode_defaults_to_local(self):
        for mode in (None, "", "local"):
            with self.subTest(mode=mode):
                b = Backend(WISPLAB_PROJECT_STORAGE=mode, WISPLAB_REGISTRATION="closed")
                try:
                    status, capabilities, headers = b.request("GET", "/api/wisplab/capabilities")
                    self.assertEqual(status, 200)
                    self.assertEqual(capabilities, {"version": 1, "accounts": True, "registration": "closed", "projectStorage": "local"})
                    self.assertIn("no-store", headers.get("Cache-Control", ""))
                finally:
                    b.close()

    def test_local_mode_auth_works_and_project_requests_do_not_store_data(self):
        b = Backend(WISPLAB_PROJECT_STORAGE="local")
        self.addCleanup(b.close)
        token, _ = b.account("localonly")
        before = b.request("GET", "/api/wisplab/usage", token=token)[1]
        requests = [
            b.request("POST", "/api/wisplab/projects", {"title": "Must not save", "tool": "wb-single"}, token),
            b.request("PATCH", "/api/wisplab/projects/000000000000000", {"archived": True}, token),
            b.upload(token, {"id": "000000000000000"}),
            # A malformed multipart request must be rejected before file parsing.
            b.request("POST", "/api/wisplab/projects/000000000000000/snapshots", b"not multipart", token, {"Content-Type": "multipart/form-data; boundary=absent"}),
        ]
        for status, body, _ in requests:
            self.assertEqual(status, 403, body)
            self.assertEqual(body["data"]["code"]["code"], "cloud_disabled")
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=token)[1], before)
        self.assertEqual(before["usedBytes"], 0)
        self.assertEqual(before["projectCount"], 0)
        with sqlite3.connect(b.path / "data" / "data.db") as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM cloud_projects").fetchone()[0], 0)
            self.assertEqual(database.execute("SELECT COUNT(*) FROM cloud_snapshots").fetchone()[0], 0)
        storage = b.path / "data" / "storage"
        self.assertFalse(any(path.is_file() for path in storage.rglob("*")))
        self.assertEqual(b.request("POST", "/api/collections/users/auth-refresh", token=token)[0], 200)
        self.assertEqual(b.request("POST", "/api/wisplab/logout-all", token=token)[0], 204)
        self.assertEqual(b.request("POST", "/api/collections/users/auth-refresh", token=token)[0], 401)

    def test_invalid_storage_mode_refuses_startup(self):
        for mode in ("cluod", "CLOUD"):
            with self.subTest(mode=mode):
                with self.assertRaisesRegex(AssertionError, "Invalid WISPLAB_PROJECT_STORAGE"):
                    Backend(WISPLAB_PROJECT_STORAGE=mode)


class QuotaConcurrency(unittest.TestCase):
    def test_registration_can_be_closed_without_creating_accounts(self):
        b = Backend(WISPLAB_REGISTRATION="closed")
        self.addCleanup(b.close)
        self.assertEqual(b.request("POST", "/api/collections/users/records", {"username": "nobody", "password": PASSWORD, "passwordConfirm": PASSWORD})[0], 403)

    def test_missing_registration_setting_is_closed_in_production(self):
        for mode in (None, ""):
            with self.subTest(mode=mode):
                b = Backend(WISPLAB_REGISTRATION=mode)
                try:
                    self.assertEqual(b.request("POST", "/api/collections/users/records", {"username": "nobody", "password": PASSWORD, "passwordConfirm": PASSWORD})[0], 403)
                finally:
                    b.close()

    def test_invalid_registration_setting_refuses_startup(self):
        for mode in ("closde", "OPEN", " open "):
            with self.subTest(mode=mode):
                with self.assertRaisesRegex(AssertionError, "Invalid WISPLAB_REGISTRATION"):
                    Backend(WISPLAB_REGISTRATION=mode)

    def test_service_requires_operator_environment_file(self):
        unit = (ROOT / "ubuntu" / "wisplab-cloud.service").read_text()
        self.assertIn("\nEnvironmentFile=/etc/wisplab-cloud/environment\n", unit)
        self.assertNotIn("EnvironmentFile=-", unit)

    def test_concurrent_distinct_projects_cannot_exceed_account_quota(self):
        data = synthetic_package()
        b = Backend(WISPLAB_USER_BYTES=len(data) + 1)
        self.addCleanup(b.close)
        token, _ = b.account("alice")
        projects = [b.project(token, str(i)) for i in range(2)]
        with ThreadPoolExecutor(max_workers=2) as workers:
            responses = list(workers.map(lambda project: b.upload(token, project, data), projects))
        self.assertEqual(sorted(r[0] for r in responses), [201, 507], responses)
        self.assertEqual(next(r for r in responses if r[0] == 507)[1]["data"]["code"]["code"], "storage_quota")
        self.assertEqual(b.request("GET", "/api/wisplab/usage", token=token)[1]["usedBytes"], len(data))

    def test_project_version_and_global_quotas(self):
        data = synthetic_package()
        b = Backend(WISPLAB_MAX_PROJECTS=1, WISPLAB_MAX_REVISIONS=1, WISPLAB_TOTAL_BYTES=len(data) + 1)
        self.addCleanup(b.close)
        alice, _ = b.account("alice")
        bob, _ = b.account("bob")
        project = b.project(alice)
        self.assertEqual(b.request("POST", "/api/wisplab/projects", {"title": "extra", "tool": "pcr"}, alice)[0], 507)
        status, saved, _ = b.upload(alice, project, data)
        self.assertEqual(status, 201, saved)
        self.assertEqual(b.upload(alice, project, base=saved["snapshot"]["id"])[0], 507)
        self.assertEqual(b.upload(bob, b.project(bob), data)[0], 507)


if __name__ == "__main__":
    unittest.main(verbosity=2)
