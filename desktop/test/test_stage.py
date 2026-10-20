import argparse
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('desktop_stage', Path(__file__).resolve().parents[1] / 'scripts/stage.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class ProvenanceTests(unittest.TestCase):
    def test_full_immutable_sha_required(self):
        sha = 'ab' * 20
        self.assertEqual(stage.full_sha(sha), sha)
        for value in ('main', 'latest', 'eea419f', 'a' * 39, 'A' * 40, 'g' * 40, ''):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                stage.full_sha(value)

    def test_failed_ci_cannot_supply_package_bytes(self):
        args = types.SimpleNamespace(wb_sha='a' * 40, pathology_sha='b' * 40, pcr_sha='c' * 40, ci_wait=0)
        run = {'head_sha': args.wb_sha, 'head_branch': 'main', 'head_repository': {'full_name': stage.REPOS['wb']}, 'event': 'push', 'conclusion': 'failure'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(stage.release, 'get_ci', return_value=(run, {})), patch.object(stage.artifact_download, 'download_artifact') as download:
            with self.assertRaisesRegex(RuntimeError, 'fully successful'):
                stage.stage_ci(args, Path(tmp) / 'apps', Path(tmp))
            download.assert_not_called()

    def test_different_commit_ci_is_rejected_even_if_successful(self):
        args = types.SimpleNamespace(wb_sha='a' * 40, pathology_sha='b' * 40, pcr_sha='c' * 40, ci_wait=0)
        run = {'head_sha': 'd' * 40, 'head_branch': 'main', 'head_repository': {'full_name': stage.REPOS['wb']}, 'event': 'push', 'conclusion': 'success'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(stage.release, 'get_ci', return_value=(run, {})), patch.object(stage.artifact_download, 'download_artifact') as download:
            with self.assertRaisesRegex(RuntimeError, 'fully successful'):
                stage.stage_ci(args, Path(tmp) / 'apps', Path(tmp))
            download.assert_not_called()

    def test_local_uncommitted_sources_need_explicit_development_flag(self):
        args = types.SimpleNamespace(wb=Path('/tmp/wb'), pathology=Path('/tmp/pathology'), pcr=Path('/tmp/pcr'), allow_dirty=False, build=False)
        with patch.object(stage, 'git', side_effect=['a' * 40, ' M src/App.tsx']), patch.object(stage, 'put_files') as copy:
            with self.assertRaisesRegex(RuntimeError, 'uncommitted changes'):
                stage.stage_local(args, Path('/unused'))
            copy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
