"""Filesystem simulations only: no remote access and no actual Caddy/systemctl."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("wisplab_deploy", Path(__file__).with_name("deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

ORIGINAL = b'''{
    acme_ca https://acme-v02.api.letsencrypt.org/directory
}
blotlens.top {
    encode zstd gzip
    request_body {
        max_size 24MB
    }
    header {
        Strict-Transport-Security "max-age=31536000"
        -Server
    }
    reverse_proxy 127.0.0.1:4317
}
www.blotlens.top {
    redir https://blotlens.top{uri} permanent
}
'''


def archive(root, version="v1", extra=None, mutate=None):
    files = {f"{site}/index.html": f"<html>{site}-{version}</html>".encode() for site in deploy.SITES}
    files[f"wb/assets/main-{version}12345678.js"] = b"console.log('public build');"
    if extra:
        files.update(extra)
    manifest = {"schemaVersion": 1, "version": version, "sites": {
        site: {"sourceKind": "portal" if site == "portal" else "git-dist",
               "gitSha": None if site == "portal" else "1" * 40,
               "files": {name[len(site) + 1:]: hashlib.sha256(data).hexdigest()
                         for name, data in files.items() if name.startswith(site + "/")}}
        for site in deploy.SITES}}
    if mutate:
        mutate(manifest)
    files["release.json"] = json.dumps(manifest).encode()
    path = root / f"{version}.tar.gz"
    with tarfile.open(path, "w:gz") as package:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            package.addfile(info, io.BytesIO(data))
    return path, deploy.sha256(path), version


class Runner:
    def __init__(self):
        self.calls = []
        self.fail_candidate = False
        self.reload_failures = 0

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        status = 0
        if args[:2] == ["/usr/bin/caddy", "validate"] and "candidate" in args[3] and self.fail_candidate:
            status = 1
        if args == ["systemctl", "reload", "caddy"] and self.reload_failures:
            self.reload_failures -= 1
            status = 1
        return subprocess.CompletedProcess(args, status, stdout="", stderr="simulated")


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.caddy = self.root / "etc-caddy" / "Caddyfile"
        self.caddy.parent.mkdir()
        self.caddy.write_bytes(ORIGINAL)
        self.base = self.root / "wisplab"
        self.runner = Runner()
        self.target = deploy.Deployment(self.base, self.caddy, self.runner)

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, version="v1"):
        return self.target.deploy(*archive(self.root, version))

    def test_archive_validates_manifest_and_every_file(self):
        args = archive(self.root, extra={"pathology/ort/ort-wasm-simd-threaded.wasm": b"wasm", "pcr/demo/cfx-style.csv": b"well,ct"})
        manifest, hashes = deploy.read_archive(*args)
        self.assertEqual(set(manifest["sites"]), set(deploy.SITES))
        self.assertEqual(len(hashes), 8)

    def test_bad_checksum_never_creates_release_directory(self):
        path, _, version = archive(self.root)
        with self.assertRaisesRegex(deploy.DeployError, "SHA256 mismatch"):
            self.target.deploy(path, "0" * 64, version)
        self.assertFalse(self.base.exists())

    def test_verified_archive_uses_same_descriptor_after_path_replacement(self):
        path, checksum, _ = archive(self.root, "v1")
        replacement, _, _ = archive(self.root, "v2")
        with deploy.verified_tar(path, checksum) as package:
            os.replace(replacement, path)
            manifest = json.load(package.extractfile("release.json"))
            self.assertEqual(manifest["version"], "v1")

    def test_verified_archive_detects_in_place_mutation(self):
        path, checksum, _ = archive(self.root)
        with self.assertRaisesRegex(deploy.DeployError, "changed while"):
            with deploy.verified_tar(path, checksum) as package:
                package.getmembers()
                with path.open("ab") as output:
                    output.write(b"changed after verification")

    def test_mismatched_manifest_rejected(self):
        args = archive(self.root, mutate=lambda m: m["sites"]["wb"]["files"].update({"index.html": "0" * 64}))
        with self.assertRaisesRegex(deploy.DeployError, "Manifest/files mismatch"):
            deploy.read_archive(*args)

    def test_unsafe_paths_and_source_files_rejected(self):
        for name in ("../escape.js", "/escape.js", "wb/../escape.js", "wb/.env", "wb/src/main.js", "wb/id_rsa", "wb/private.pem", "wb/main.ts", "other/index.html", "wb/assets/main.js.map", "wb/credentials.json"):
            with self.subTest(name=name):
                args = archive(self.root, extra={name: b"forbidden"})
                with self.assertRaises(deploy.DeployError):
                    deploy.read_archive(*args)

    def test_archive_links_and_duplicate_paths_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                path = self.root / "bad.tar.gz"
                with tarfile.open(path, "w:gz") as package:
                    entry = tarfile.TarInfo("wb/link.js")
                    entry.type = kind
                    entry.linkname = "/etc/passwd"
                    package.addfile(entry)
                with self.assertRaisesRegex(deploy.DeployError, "regular"):
                    deploy.read_archive(path, deploy.sha256(path), "v1")
        path = self.root / "duplicate.tar.gz"
        with tarfile.open(path, "w:gz") as package:
            for _ in range(2):
                package.addfile(tarfile.TarInfo("wb/index.html"))
        with self.assertRaisesRegex(deploy.DeployError, "Duplicate archive"):
            deploy.read_archive(path, deploy.sha256(path), "v1")

    def test_fresh_deploy_preserves_original_config_and_uses_one_import(self):
        result = self.publish()
        self.assertEqual(result["status"], "deployed")
        self.assertEqual(self.target.current.resolve(), self.base / "releases/v1")
        self.assertTrue(self.caddy.read_bytes().startswith(ORIGINAL))
        self.assertEqual(self.caddy.read_text().count(f"import {self.target.snippet}"), 1)
        snippet = self.target.snippet.read_text()
        self.assertEqual(snippet.count("root *"), 8)
        self.assertEqual(snippet.count("handle /release.json {"), 4)
        self.assertEqual(snippet.count(f"root * {self.base}/current\n"), 4)
        for site in deploy.SITES:
            self.assertIn(f"root * {self.base}/current/{site}\n", snippet)
        self.assertNotIn("browse", snippet)
        self.assertNotIn("Content-Security-Policy", snippet)
        self.assertEqual((Path(result["backup"]) / "Caddyfile").read_bytes(), ORIGINAL)
        self.assertFalse((self.base / "pending.json").exists())

    def test_repeating_same_release_is_idempotent(self):
        args = archive(self.root)
        self.target.deploy(*args)
        calls = len([c for c in self.runner.calls if c == ["systemctl", "reload", "caddy"]])
        self.assertEqual(self.target.deploy(*args)["status"], "unchanged")
        self.assertEqual(len(list((self.base / "backups").iterdir())), 1)
        self.assertEqual(calls, len([c for c in self.runner.calls if c == ["systemctl", "reload", "caddy"]]))

    def test_new_version_retains_old_assets_and_release(self):
        self.publish("v1")
        self.publish("v2")
        self.assertTrue((self.base / "releases/v1/wb/assets/main-v112345678.js").exists())
        self.assertTrue((self.base / "current/wb/assets/main-v112345678.js").exists())
        self.assertTrue((self.base / "current/wb/assets/main-v212345678.js").exists())
        self.target.verify_release(self.base / "releases/v2")

    def test_unknown_base_snippet_and_current_refused(self):
        self.base.mkdir()
        (self.base / "private-data.txt").write_text("keep")
        with self.assertRaises(deploy.DeployError):
            self.publish()
        self.assertEqual((self.base / "private-data.txt").read_text(), "keep")
        self.assertEqual(self.caddy.read_bytes(), ORIGINAL)

    def test_unknown_snippet_refused_and_preserved(self):
        self.target.snippet.write_text("existing unrelated content")
        with self.assertRaisesRegex(deploy.DeployError, "unknown content"):
            self.publish()
        self.assertEqual(self.target.snippet.read_text(), "existing unrelated content")

    def test_unknown_current_directory_is_preserved(self):
        self.target.prepare_base()
        self.target.current.mkdir()
        (self.target.current / "keep.txt").write_text("existing")
        with self.assertRaisesRegex(deploy.DeployError, "not a managed release symlink"):
            self.publish()
        self.assertEqual((self.target.current / "keep.txt").read_text(), "existing")

    def test_conflicting_version_archive_is_refused(self):
        self.publish()
        args = archive(self.root, extra={"pcr/demo/extra.csv": b"changed"})
        with self.assertRaisesRegex(deploy.DeployError, "different archive"):
            self.target.deploy(*args)
        self.assertFalse((self.base / "current/pcr/demo/extra.csv").exists())

    def test_restrictive_umask_still_leaves_static_files_readable(self):
        old_umask = os.umask(0o077)
        try:
            self.publish()
        finally:
            os.umask(old_umask)
        for directory in [self.base, self.base / "releases", self.base / "releases/v1", self.base / "current/wb", self.base / "current/wb/assets"]:
            self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.base / "current/wb/index.html").stat().st_mode & 0o777, 0o644)

    def test_concurrent_caddyfile_change_is_not_overwritten(self):
        original_runner = self.target.runner
        changed = ORIGINAL + b"\n# concurrent operator edit\n"
        def edit_during_validation(args, **kwargs):
            result = original_runner(args, **kwargs)
            if args[:2] == ["/usr/bin/caddy", "validate"] and "candidate" in args[3]:
                self.caddy.write_bytes(changed)
            return result
        self.target.runner = edit_during_validation
        with self.assertRaisesRegex(deploy.DeployError, "changed during preparation"):
            self.publish()
        self.assertEqual(self.caddy.read_bytes(), changed)
        self.assertFalse(self.target.current.exists())

    def test_modified_release_and_conflicting_version_are_refused(self):
        self.publish()
        (self.base / "current/wb/index.html").write_text("manual edit")
        with self.assertRaisesRegex(deploy.DeployError, "modified outside"):
            self.publish("v2")

    def test_candidate_validation_failure_keeps_original_live(self):
        self.runner.fail_candidate = True
        with self.assertRaisesRegex(deploy.DeployError, "restored"):
            self.publish()
        self.assertEqual(self.caddy.read_bytes(), ORIGINAL)
        self.assertFalse(self.target.snippet.exists())
        self.assertFalse(self.target.current.exists())
        self.assertFalse(any(c == ["systemctl", "reload", "caddy"] for c in self.runner.calls))
        self.assertFalse((self.base / "pending.json").exists())

    def test_first_reload_failure_restores_original_without_new_domain(self):
        self.runner.reload_failures = 1
        with self.assertRaisesRegex(deploy.DeployError, "restored"):
            self.publish()
        self.assertEqual(self.caddy.read_bytes(), ORIGINAL)
        self.assertFalse(self.target.snippet.exists())
        self.assertFalse(self.target.current.exists())
        self.assertEqual(len([c for c in self.runner.calls if c == ["systemctl", "reload", "caddy"]]), 2)

    def test_upgrade_reload_failure_restores_previous_version(self):
        self.publish("v1")
        config = self.caddy.read_bytes()
        self.runner.reload_failures = 1
        with self.assertRaisesRegex(deploy.DeployError, "restored"):
            self.publish("v2")
        self.assertEqual(self.target.current.resolve(), self.base / "releases/v1")
        self.assertEqual(self.caddy.read_bytes(), config)
        self.assertTrue(self.target.snippet.exists())
        self.assertFalse((self.base / "pending.json").exists())

    def test_failed_rollback_leaves_journal_and_blocks_retry(self):
        self.runner.reload_failures = 2
        with self.assertRaisesRegex(deploy.DeployError, "rollback needs manual review"):
            self.publish()
        self.assertTrue((self.base / "pending.json").exists())
        with self.assertRaisesRegex(deploy.DeployError, "incomplete transaction"):
            self.publish("v2")

    def test_existing_target_domain_never_automatically_reconfigured(self):
        self.caddy.write_bytes(ORIGINAL + b"\nwb.wisplab.top {\n respond existing\n}\n")
        before = self.caddy.read_bytes()
        with self.assertRaisesRegex(deploy.DeployError, "already configured"):
            self.publish()
        self.assertEqual(self.caddy.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
