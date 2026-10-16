import argparse
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('release_tool', Path(__file__).with_name('release.py'))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


def source(site, n):
    sha = str(n) * 40
    return {'repository': r.REPOS[site], 'gitSha': sha,
            'ci': {'headSha': sha, 'conclusion': 'success', 'runId': n},
            'pages': {'headSha': sha, 'conclusion': 'success', 'runId': n + 10, 'commitInput': sha}}


def deployment():
    return {'schemaVersion': 1, 'version': 'old',
            'archive': {'fileName': 'wisplab-old.tar.gz', 'sha256': 'a' * 64},
            'sources': {site: source(site, n) for n, site in enumerate(r.REPOS, 1)}}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.args = argparse.Namespace(version='test', output_dir=self.root, release_tag=None,
                                       portal=None, timeout=1, server_timeout=1, action='publish')
        self.locks = []

    def tearDown(self):
        for lock in self.locks:
            lock.close()
        self.temporary.cleanup()

    def release(self):
        value = r.Release(self.args)
        self.locks.append(value.lock)
        return value

    def test_manifest_rejects_different_sha_and_repository(self):
        for field, bad in [('gitSha', 'f' * 40), ('repository', 'other/repo')]:
            doc = deployment()
            doc['sources']['wb'][field] = bad
            with self.assertRaises(r.ReleaseError):
                r.validate_deployment(doc)

    def test_manifest_accepts_rollback_with_different_workflow_sha(self):
        doc = deployment()
        doc['sources']['wb']['pages']['workflowHeadSha'] = 'f' * 40
        self.assertEqual(r.validate_deployment(doc), doc)
        doc['sources']['wb']['pages']['commitInput'] = 'f' * 40
        with self.assertRaises(r.ReleaseError):
            r.validate_deployment(doc)

    def test_manifest_rejects_bad_archive_name(self):
        doc = deployment()
        doc['archive']['fileName'] = '../secret.tar.gz'
        with self.assertRaises(r.ReleaseError):
            r.validate_deployment(doc)

    def test_ci_only_accepts_complete_same_repo_main_run(self):
        run = {'id': 5, 'head_sha': 'a' * 40, 'head_branch': 'main', 'head_repository': {'full_name': r.REPOS['wb']},
               'event': 'push', 'status': 'in_progress', 'conclusion': 'success'}
        self.assertTrue(r.matching_ci(run, r.REPOS['wb'], 'a' * 40))
        with patch.object(r, 'api', return_value={'workflow_runs': [run]}), patch.object(r.time, 'sleep', side_effect=r.ReleaseError('waited')):
            with self.assertRaisesRegex(r.ReleaseError, 'waited'):
                r.get_ci(r.REPOS['wb'], 'a' * 40, 1)
        run['head_repository']['full_name'] = 'fork/repo'
        self.assertFalse(r.matching_ci(run, r.REPOS['wb'], 'a' * 40))

    def test_failed_ci_never_fetches_artifacts(self):
        run = {'head_sha': 'a' * 40, 'head_branch': 'main', 'head_repository': {'full_name': r.REPOS['wb']},
               'event': 'push', 'status': 'completed', 'conclusion': 'failure'}
        with patch.object(r, 'api', return_value={'workflow_runs': [run]}) as api:
            with self.assertRaisesRegex(r.ReleaseError, '没有完整成功 CI'):
                r.get_ci(r.REPOS['wb'], 'a' * 40, 1)
            self.assertEqual(api.call_count, 1)

    def test_expired_artifact_requires_rerun(self):
        run = {'id': 5, 'head_sha': 'a' * 40, 'head_branch': 'main', 'head_repository': {'full_name': r.REPOS['wb']},
               'event': 'push', 'status': 'completed', 'conclusion': 'success'}
        with patch.object(r, 'api', side_effect=[{'workflow_runs': [run]}, {'artifacts': [{'name': 'web-dist', 'expired': True}]}]):
            with self.assertRaisesRegex(r.ReleaseError, 'gh run rerun 5'):
                r.get_ci(r.REPOS['wb'], 'a' * 40, 1)

    def test_exact_rollback_bytes_include_added_and_removed_files(self):
        folders = {}
        manifest = {'schemaVersion': 1, 'sites': {'portal': {}}}
        sources = deployment()['sources']
        for site in r.REPOS:
            folder = self.root / site
            folder.mkdir()
            (folder / 'index.html').write_text('same')
            folders[site] = folder
            manifest['sites'][site] = {'repository': r.REPOS[site], 'gitSha': sources[site]['gitSha'], 'files': r.file_hashes(folder)}
        r.check_rollback_bytes(manifest, sources, folders)
        (folders['wb'] / 'new.txt').write_text('changed dependency')
        with self.assertRaisesRegex(r.ReleaseError, '不逐文件一致'):
            r.check_rollback_bytes(manifest, sources, folders)

    def test_dispatch_url_cannot_select_other_repository(self):
        self.assertEqual(r.parse_dispatch_url('https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/123\n', r.REPOS['wb']), 123)
        with self.assertRaises(r.ReleaseError):
            r.parse_dispatch_url('https://github.com/other/repo/actions/runs/123', r.REPOS['wb'])

    def test_pending_dispatch_is_not_repeated(self):
        release = self.release()
        release.state['sources'] = {'wb': source('wb', 1)}
        release.state['pages']['wb'] = {'status': 'dispatch-pending'}
        with patch.object(r, 'command') as command:
            with self.assertRaisesRegex(r.ReleaseError, '结果未知'):
                release.deploy_pages()
            command.assert_not_called()

    def test_failed_pages_stops_before_release(self):
        release = self.release()
        release.state['sources'] = {'wb': source('wb', 1)}
        release.state['pages']['wb'] = {'runId': 11, 'commitInput': '1' * 40}
        failed = {'path': '.github/workflows/pages.yml', 'event': 'workflow_dispatch', 'head_branch': 'main',
                  'head_sha': '1' * 40, 'status': 'completed', 'conclusion': 'failure', 'html_url': 'https://github.com/run'}
        with patch.object(release, 'prepare'), patch.object(release, 'publish_release') as publish, patch.object(r, 'api', return_value=failed):
            with self.assertRaisesRegex(r.ReleaseError, 'Pages 11 失败'):
                release.run()
            publish.assert_not_called()

    def test_plan_never_dispatches_or_publishes(self):
        self.args.action = 'plan'
        release = self.release()
        with patch.object(release, 'prepare') as prepare, patch.object(release, 'deploy_pages') as pages, patch.object(release, 'publish_release') as publish:
            release.run()
            prepare.assert_called_once()
            pages.assert_not_called()
            publish.assert_not_called()

    def test_published_resume_only_rechecks_server(self):
        release = self.release()
        release.state['releasePublished'] = True
        with patch.object(release, 'prepare') as prepare, patch.object(release, 'deploy_pages') as pages, patch.object(release, 'wait_server') as server:
            release.run()
            prepare.assert_not_called()
            pages.assert_not_called()
            server.assert_called_once()

    def test_server_same_version_wrong_sources_is_failure(self):
        release = self.release()
        release.state['manifest'] = {'version': 'test', 'sites': {'wb': {'gitSha': 'a' * 40}}}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *unused): pass
            def read(self, size): return json.dumps({'version': 'test', 'sites': {'wb': {'gitSha': 'b' * 40}}}).encode()
        with patch.object(r.urllib.request, 'urlopen', return_value=Response()), patch.object(r.time, 'monotonic', side_effect=[0, 2]):
            with self.assertRaisesRegex(r.ReleaseError, '服务器验收超时'):
                release.wait_server()
        self.assertEqual(len(release.state['server']), 4)
        self.assertTrue(all(v['status'] == 'waiting' for v in release.state['server'].values()))

    def test_pages_rejects_wrong_recovered_run_input(self):
        release = self.release()
        release.state['pages']['wb'] = {'runId': 500}
        jobs = {'jobs': [{'name': 'verify', 'conclusion': 'success', 'id': 600}]}
        with patch.object(r, 'api', return_value=jobs), patch.object(r, 'command', return_value='DEPLOY_COMMIT: ' + '9' * 40):
            with self.assertRaisesRegex(r.ReleaseError, '实际 commit 输入'):
                release.verify_pages_build('wb', source('wb', 1), {'id': 500, 'run_attempt': 1})

    def test_pages_rejects_same_sha_different_actual_build(self):
        release = self.release()
        release.state['pages']['wb'] = {'runId': 500}
        release.state['manifest'] = {'sites': {'wb': {'files': {'index.html': hashlib.sha256(b'old').hexdigest()}}}}
        responses = [{'jobs': [{'name': 'verify', 'conclusion': 'success', 'id': 600}]},
                     {'artifacts': [{'name': 'github-pages', 'id': 700, 'expired': False}]}]
        def cmd(*args, **kwargs):
            if '--log' in args:
                return 'DEPLOY_COMMIT: ' + '1' * 40
            folder = Path(args[args.index('--dir') + 1])
            with tarfile.open(folder / 'artifact.tar', 'w') as tar:
                item = tarfile.TarInfo('./index.html')
                item.size = 3
                tar.addfile(item, io.BytesIO(b'new'))
            return ''
        with patch.object(r, 'api', side_effect=responses), patch.object(r, 'command', side_effect=cmd):
            with self.assertRaisesRegex(r.ReleaseError, '实际产物与服务器包不同'):
                release.verify_pages_build('wb', source('wb', 1), {'id': 500, 'run_attempt': 1})
        self.assertNotIn('verifiedRunAttempt', release.state['pages']['wb'])

    def test_release_asset_needs_digest_even_when_size_matches(self):
        path = self.root / 'deployment.json'
        path.write_bytes(b'example')
        with self.assertRaisesRegex(r.ReleaseError, 'SHA256 缺失'):
            r.require_asset_digest({'size': 7}, path)
        r.require_asset_digest({'size': 7, 'digest': 'sha256:' + r.sha256(path)}, path)

    def test_pages_tar_rejects_symlinks(self):
        path = self.root / 'unsafe.tar'
        with tarfile.open(path, 'w') as tar:
            item = tarfile.TarInfo('./index.html')
            item.type = tarfile.SYMTYPE
            item.linkname = '/etc/passwd'
            tar.addfile(item)
        with self.assertRaisesRegex(r.ReleaseError, '不安全路径'):
            r.pages_tar_hashes(path)

    def test_artifact_packaging_real_api_without_network(self):
        release = self.release()
        portal = self.root / 'input-portal'
        portal.mkdir()
        for name, data in [('index.html', '<html><body>Portal</body></html>'), ('styles.css', 'body{}'), ('favicon.svg', '<svg/>')]:
            (portal / name).write_text(data)
        release.args.portal = portal
        for n, site in enumerate(r.REPOS, 1):
            release.state['sources'][site] = {'repository': r.REPOS[site], 'gitSha': str(n) * 40}
        release.state['bundleVersion'] = release.version
        release.save()
        def ci(repo, sha, timeout):
            return ({'id': 100, 'head_sha': sha, 'html_url': f'https://github.com/{repo}/actions/runs/100'}, {'id': 200})
        def cmd(*args, **kwargs):
            destination = Path(args[args.index('--dir') + 1])
            (destination / 'index.html').write_text('<html><body>CI build</body></html>')
            return ''
        with patch.object(r, 'get_ci', side_effect=ci), patch.object(r, 'command', side_effect=cmd):
            release.prepare()
        archive = Path(release.state['archive']['path'])
        self.assertTrue(archive.exists())
        self.assertEqual(r.sha256(archive), release.state['archive']['sha256'])
        manifest, _ = r.load_module('deploy_test', 'deploy.py').read_archive(archive, release.state['archive']['sha256'], 'test')
        self.assertEqual(set(manifest['sites']), {'portal', 'wb', 'pathology', 'pcr'})
        self.assertEqual(manifest['sites']['wb']['gitSha'], '1' * 40)
        # 模拟归档已落盘、state.archive 尚未保存时中断，恢复必须复用相同字节。
        original_digest = release.state['archive']['sha256']
        del release.state['archive']
        del release.state['manifest']
        release.save()
        with patch.object(r, 'get_ci', side_effect=ci), patch.object(r, 'command', side_effect=cmd):
            release.prepare()
        self.assertEqual(release.state['archive']['sha256'], original_digest)


if __name__ == '__main__':
    unittest.main()
