"""Updater simulations: all HTTP downloads and deploy subprocesses are faked."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_deploy import archive

spec = importlib.util.spec_from_file_location("wisplab_update", Path(__file__).with_name("update.py"))
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


def source_records():
    return {site: {"repository": repo, "gitSha": "1" * 40,
                   "ci": {"conclusion": "success", "headSha": "1" * 40, "runId": 100},
                   "pages": {"conclusion": "success", "headSha": "1" * 40, "runId": 200}}
            for site, repo in update.SOURCE_REPOS.items()}


class FakeGitHub:
    def __init__(self):
        self.entries = []
        self.files = {}
        self.downloads = []
        self.list_calls = 0

    def releases(self):
        self.list_calls += 1
        return self.entries

    def release_by_tag(self, tag):
        return next(item for item in self.entries if item["tag_name"] == tag)

    def download(self, url, destination, expected_size, limit):
        data = self.files[url]
        self.downloads.append(url)
        if len(data) != expected_size or len(data) > limit:
            raise update.UpdateError("Fake size mismatch")
        destination.write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    def add(self, root, version, release_id, published="2026-10-16T10:00:00Z", tag=None):
        path, checksum, _ = archive(root, version)
        tag = tag or update.PREFIX + version
        document = {"schemaVersion": 1, "version": version,
                    "archive": {"fileName": path.name, "sha256": checksum}, "sources": source_records()}
        release = {"id": release_id, "tag_name": tag, "draft": False, "prerelease": False,
                   "published_at": published, "assets": []}
        for name, data in (("deployment.json", json.dumps(document).encode()), (path.name, path.read_bytes())):
            url = f"https://github.com/{update.REPOSITORY}/releases/download/{tag}/{name}"
            self.files[url] = data
            release["assets"].append({"name": name, "state": "uploaded", "size": len(data), "browser_download_url": url})
        self.entries.append(release)
        return release, document

    def change_manifest(self, release, document):
        entry = next(item for item in release["assets"] if item["name"] == "deployment.json")
        data = json.dumps(document).encode()
        entry["size"] = len(data)
        self.files[entry["browser_download_url"]] = data


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.base = self.root / "wisplab"
        (self.base / "bin").mkdir(parents=True)
        (self.base / ".managed-by-wisplab-deploy.json").write_text(json.dumps({"owner": "wisplab-deploy-v1"}))
        (self.base / "bin/deploy.py").write_text("# fixed installed script, not executed by these tests\n")
        (self.base / "bin/deploy.py").chmod(0o644)
        self.github = FakeGitHub()
        self.calls = []
        self.deploy_status = 0
        def runner(command, **kwargs):
            self.calls.append(command)
            return subprocess.CompletedProcess(command, self.deploy_status, stdout="{}", stderr="simulated deployment failure" if self.deploy_status else "")
        self.updater = update.Updater(self.base, self.github, runner)

    def tearDown(self):
        self.temp.cleanup()

    def state(self):
        return json.loads((self.base / "updater/state.json").read_text())

    def test_picks_latest_published_matching_release_and_skips_drafts(self):
        first, _ = self.github.add(self.root, "v1", 1)
        second, _ = self.github.add(self.root, "v2", 2, "2026-10-17T10:00:00Z")
        bad = copy.deepcopy(second)
        bad.update(id=3, published_at="2026-10-18T10:00:00Z", draft=True)
        unrelated = copy.deepcopy(second)
        unrelated.update(id=4, tag_name="ordinary-release", published_at="2026-10-19T10:00:00Z")
        prerelease = copy.deepcopy(second)
        prerelease.update(id=5, prerelease=True, published_at="2026-10-20T10:00:00Z")
        self.github.entries = [first, bad, unrelated, second, prerelease]
        result = self.updater.run()
        self.assertEqual(result["version"], "v2")
        self.assertEqual(self.state()["releaseId"], 2)

    def test_downloads_only_manifest_and_archive_executes_fixed_script(self):
        release, _ = self.github.add(self.root, "v1", 1)
        self.updater.run()
        self.assertEqual(len(self.github.downloads), 2)
        self.assertEqual(self.calls[0][:3], ["/usr/bin/python3", "-I", str(self.base / "bin/deploy.py")])
        self.assertEqual(self.calls[0][-2:], ["--version", "v1"])
        self.assertEqual(self.state()["tag"], release["tag_name"])
        self.assertEqual(list((self.base / "updater").glob("download-*")), [])

    def test_same_release_skips_download_and_deploy(self):
        self.github.add(self.root, "v1", 1)
        self.updater.run()
        self.assertEqual(self.updater.run()["status"], "unchanged")
        self.assertEqual(len(self.github.downloads), 2)
        self.assertEqual(len(self.calls), 1)

    def test_manual_rollback_pins_until_resume(self):
        self.github.add(self.root, "v1", 1)
        self.github.add(self.root, "v2", 2, "2026-10-17T10:00:00Z")
        self.updater.run()
        self.assertEqual(self.updater.run(tag="wisplab-deploy-v1")["version"], "v1")
        listing_calls = self.github.list_calls
        self.assertEqual(self.updater.run()["status"], "pinned")
        self.assertEqual(self.github.list_calls, listing_calls)
        self.assertEqual(self.updater.run(resume=True)["version"], "v2")
        self.assertNotIn("pinnedTag", self.state())

    def test_republished_rollback_tag_can_reference_original_bundle_version(self):
        release, _ = self.github.add(self.root, "original-version", 9, tag="wisplab-deploy-rollback-20261016")
        self.assertEqual(self.updater.run()["version"], "original-version")
        self.assertEqual(self.state()["tag"], release["tag_name"])

    def test_failed_deploy_keeps_success_state_and_records_failure(self):
        self.github.add(self.root, "v1", 1)
        self.updater.run()
        before = self.state()
        self.github.add(self.root, "v2", 2, "2026-10-17T10:00:00Z")
        self.deploy_status = 1
        with self.assertRaisesRegex(update.UpdateError, "Fixed deploy.py failed"):
            self.updater.run()
        self.assertEqual(self.state(), before)
        self.assertIn("failure", (self.base / "updater/last-error.json").read_text())
        self.assertIn("Update failed", (self.base / "updater/update.log").read_text())

    def test_failed_checksum_never_invokes_installer(self):
        release, document = self.github.add(self.root, "v1", 1)
        document["archive"]["sha256"] = "0" * 64
        self.github.change_manifest(release, document)
        with self.assertRaisesRegex(update.UpdateError, "SHA256"):
            self.updater.run()
        self.assertEqual(self.calls, [])

    def test_wrong_archive_git_sha_never_invokes_installer(self):
        release, document = self.github.add(self.root, "v1", 1)
        document["sources"]["pcr"].update(gitSha="2" * 40)
        for step in ("ci", "pages"):
            document["sources"]["pcr"][step]["headSha"] = "2" * 40
        self.github.change_manifest(release, document)
        with self.assertRaisesRegex(update.UpdateError, "Archive source SHA differs"):
            self.updater.run()
        self.assertEqual(self.calls, [])

    def test_manifest_requires_successful_exact_ci_and_pages(self):
        _, document = self.github.add(self.root, "v1", 1)
        for step in ("ci", "pages"):
            bad = copy.deepcopy(document)
            bad["sources"]["wb"][step]["conclusion"] = "failure"
            with self.assertRaisesRegex(update.UpdateError, "successful"):
                update.validate_manifest(bad)
            bad["sources"]["wb"][step].update(conclusion="success", headSha="2" * 40)
            with self.assertRaisesRegex(update.UpdateError, "exact Git SHA"):
                update.validate_manifest(bad)

    def test_pages_dispatch_commit_can_differ_from_workflow_head(self):
        _, document = self.github.add(self.root, "v1", 1)
        document["sources"]["wb"]["pages"].update(workflowHeadSha="2" * 40, commitInput="1" * 40)
        update.validate_manifest(document)
        document["sources"]["wb"]["pages"]["commitInput"] = "3" * 40
        with self.assertRaises(update.UpdateError):
            update.validate_manifest(document)

    def test_missing_or_foreign_assets_rejected(self):
        release, _ = self.github.add(self.root, "v1", 1)
        entry = release["assets"][0]
        original = entry["browser_download_url"]
        for url in (original.replace("https:", "http:"), original.replace("Gaoyuan-0423", "attacker"), "https://example.com/file.json"):
            entry["browser_download_url"] = url
            with self.assertRaises(update.UpdateError):
                update.asset(release, "deployment.json")
        release["assets"] = []
        with self.assertRaisesRegex(update.UpdateError, "exactly one"):
            update.asset(release, "deployment.json")

    def test_redirects_cannot_downgrade_or_leave_github(self):
        for url in ("http://github.com/a", "https://127.0.0.1/a", "https://example.com/a", "https://github.com:444/a", "https://user@github.com/a"):
            with self.assertRaises(update.UpdateError):
                update.check_https(url)
        update.check_https("https://release-assets.githubusercontent.com/signed?value=1")

    def test_unknown_updater_directory_and_writable_installer_are_refused(self):
        (self.base / "bin/deploy.py").chmod(0o666)
        with self.assertRaisesRegex(update.UpdateError, "not writable"):
            self.updater.run()
        (self.base / "bin/deploy.py").chmod(0o644)
        (self.base / "updater").mkdir()
        (self.base / "updater/keep").write_text("existing")
        with self.assertRaisesRegex(update.UpdateError, "not managed"):
            self.updater.run()
        self.assertEqual((self.base / "updater/keep").read_text(), "existing")

    def test_no_release_makes_no_deployment(self):
        self.assertEqual(self.updater.run()["status"], "no-release")
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
