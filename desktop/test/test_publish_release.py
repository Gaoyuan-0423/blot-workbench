import argparse
import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    'desktop_publisher', Path(__file__).resolve().parents[1] / 'scripts/publish-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
Error = publisher.release.ReleaseError
VERSION = '0.1.0-experimental.3'
TAG = 'wisplab-desktop-' + VERSION
SHAS = {'wb': 'a' * 40, 'pathology': 'b' * 40, 'pcr': 'c' * 40}
SHELL_SHA = 'd' * 40  # Deliberately different from the bundled WB tool.


def build():
    return {'id': 123, 'head_sha': SHELL_SHA, 'run_attempt': 1, 'workflow_id': 456,
            'repository': {'full_name': publisher.REPOSITORY},
            'head_repository': {'full_name': publisher.REPOSITORY},
            'path': publisher.WORKFLOW, 'head_branch': 'main', 'event': 'workflow_dispatch',
            'status': 'completed', 'conclusion': 'success'}


def artifacts():
    return {platform: {'id': 10 + i, 'name': f'WispLab-{platform}-unsigned',
                       'digest': 'sha256:' + str(i) * 64, 'size_in_bytes': 1024, 'expired': False,
                       'workflow_run': {'id': 123, 'head_sha': SHELL_SHA, 'head_branch': 'main'}}
            for i, platform in enumerate(publisher.PLATFORMS, 1)}


def manifest():
    sources = {}
    for tool, repository in publisher.release.REPOS.items():
        sources[tool] = {'repository': repository, 'gitSha': SHAS[tool], 'dirty': False,
                         'buildOrigin': 'successful-ci-artifact',
                         'ci': {'headSha': SHAS[tool], 'conclusion': 'success',
                                'runId': 101, 'artifactId': 201, 'artifactName': 'web-dist',
                                'artifactDigest': 'sha256:' + 'f' * 64}}
    sources['portal'] = {'repository': publisher.REPOSITORY, 'gitSha': SHAS['wb'],
                         'dirty': False, 'buildOrigin': 'pinned-source'}
    return {'schemaVersion': 1, 'product': 'WispLab Desktop', 'version': VERSION,
            'mode': 'ci', 'experimental': True, 'signed': False,
            'desktopTreeDirty': False, 'desktopGitSha': SHELL_SHA, 'sources': sources}


def write_artifact(folder, platform, *, raw=None):
    (folder / 'out').mkdir(parents=True)
    (folder / 'resources').mkdir()
    (folder / 'resources/release.json').write_bytes(raw or json.dumps(manifest()).encode())
    names = publisher.installer_names(VERSION, platform)
    first = sorted(names)[0]
    names.add(first + '.blockmap')
    rows = []
    for name in sorted(names):
        file = folder / 'out' / name
        file.write_bytes(b'Synthetic installer fixture: ' + name.encode())
        rows.append(f'{publisher.release.sha256(file)}  {name}\n')
    (folder / 'out/SHASUMS256.txt').write_text(''.join(rows))
    (folder / 'reports').mkdir()
    (folder / 'reports/synthetic.wisplab.zip').write_bytes(b'MUST NOT BE PUBLISHED')
    (folder / 'reports/screenshot.png').write_bytes(b'MUST NOT BE PUBLISHED')


class SourceGuards(unittest.TestCase):
    def test_arguments_reject_mutable_refs_and_web_release_tags(self):
        self.assertEqual(publisher.full_sha(SHELL_SHA), SHELL_SHA)
        self.assertEqual(publisher.desktop_tag(TAG), TAG)
        self.assertEqual(publisher.run_id('123'), 123)
        for value in ('main', 'abc123', 'A' * 40, 'x' * 40, ''):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                publisher.full_sha(value)
        for value in ('wisplab-deploy-20261020', 'wisplab-desktop-latest', TAG + '/x', TAG + '\n', 'wisplab-desktop-0.1.0'):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                publisher.desktop_tag(value)
        for value in ('0', '-1', '1;echo', 'latest'):
            with self.assertRaises(argparse.ArgumentTypeError):
                publisher.run_id(value)

    def get(self, run=None, items=None, workflow=None, count=None):
        rows = list((items or artifacts()).values())
        responses = [run or build(), workflow or {'path': publisher.WORKFLOW},
                     {'total_count': len(rows) if count is None else count, 'artifacts': rows}]
        with patch.object(publisher.release, 'api', side_effect=responses):
            return publisher.get_build(123)

    def test_exact_successful_main_run_accepts_distinct_shell_sha(self):
        run, items = self.get()
        self.assertEqual(run['head_sha'], SHELL_SHA)
        self.assertEqual(set(items), set(publisher.PLATFORMS))

    def test_non_main_fork_wrong_workflow_or_incomplete_run_rejected(self):
        changes = [{'head_branch': 'feature'}, {'status': 'in_progress'}, {'conclusion': 'failure'},
                   {'path': '.github/workflows/ci.yml'}, {'event': 'pull_request'}, {'id': 124},
                   {'repository': {'full_name': 'other/repo'}},
                   {'head_repository': {'full_name': 'other/repo'}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(Error):
                self.get({**build(), **change})
        with self.assertRaises(Error):
            self.get(workflow={'path': '.github/workflows/other.yml'})

    def test_missing_duplicate_expired_mismatched_artifacts_rejected(self):
        for change in ({'expired': True}, {'digest': None}, {'size_in_bytes': 0},
                       {'workflow_run': {'id': 124, 'head_sha': SHELL_SHA, 'head_branch': 'main'}},
                       {'name': 'wrong-name'}):
            items = artifacts()
            items['mac-arm64'].update(change)
            with self.subTest(change=change), self.assertRaises(Error):
                self.get(items=items)
        items = artifacts()
        items['extra'] = dict(items['mac-arm64'])
        with self.assertRaises(Error):
            self.get(items=items)
        with self.assertRaises(Error):
            self.get(count=101)

    def test_manifest_checks_clean_ci_all_sources_and_shell_sha(self):
        raw = json.dumps(manifest()).encode()
        publisher.validate_manifest(raw, build(), SHAS, VERSION)
        variants = []
        for key, value in [('mode', 'local'), ('desktopTreeDirty', True), ('desktopGitSha', SHAS['wb']),
                           ('signed', True), ('version', '0.2.0-experimental.1')]:
            item = manifest()
            item[key] = value
            variants.append(item)
        for tool in SHAS:
            item = manifest()
            item['sources'][tool]['gitSha'] = 'e' * 40
            variants.append(item)
            item = manifest()
            item['sources'][tool]['dirty'] = True
            variants.append(item)
            item = manifest()
            item['sources'][tool]['ci']['conclusion'] = 'failure'
            variants.append(item)
        item = manifest()
        item['sources']['portal']['gitSha'] = 'e' * 40
        variants.append(item)
        for item in variants:
            with self.subTest(item=item), self.assertRaises(Error):
                publisher.validate_manifest(json.dumps(item).encode(), build(), SHAS, VERSION)
        with self.assertRaisesRegex(Error, 'Duplicate'):
            publisher.validate_manifest(b'{"mode":"ci","mode":"local"}', build(), SHAS, VERSION)


class ArtifactGuards(unittest.TestCase):
    def test_every_checksum_verified_and_only_six_installers_exported(self):
        def download(item, folder):
            write_artifact(folder, next(key for key, value in artifacts().items() if value['id'] == item['id']))
        with tempfile.TemporaryDirectory() as tmp, patch.object(publisher, 'download', side_effect=download):
            output = publisher.prepare_bundle(Path(tmp), build(), artifacts(), SHAS, TAG)
            names = {path.name for path in output.iterdir()}
            six = set().union(*(publisher.installer_names(VERSION, p) for p in publisher.PLATFORMS))
            self.assertEqual(names, six | {'SHASUMS256.txt', 'release.json', 'RELEASE-NOTES.md'})
            sums = (output / 'SHASUMS256.txt').read_text().splitlines()
            self.assertEqual(len(sums), 6)
            for line in sums:
                digest, name = line.split('  ')
                self.assertEqual(digest, publisher.release.sha256(output / name))

    def test_platform_manifest_must_match_byte_for_byte(self):
        def download(item, folder):
            raw = json.dumps(manifest(), indent=2 if item['id'] == 12 else None).encode()
            write_artifact(folder, next(key for key, value in artifacts().items() if value['id'] == item['id']), raw=raw)
        with tempfile.TemporaryDirectory() as tmp, patch.object(publisher, 'download', side_effect=download):
            with self.assertRaisesRegex(Error, 'differ'):
                publisher.prepare_bundle(Path(tmp), build(), artifacts(), SHAS, TAG)

    def test_corrupt_installers_blockmaps_and_missing_or_extra_files_rejected(self):
        for action in ('installer', 'blockmap', 'missing', 'extra', 'duplicate', 'traversal'):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / 'artifact'
                write_artifact(folder, 'mac-arm64')
                first = sorted(publisher.installer_names(VERSION, 'mac-arm64'))[0]
                if action == 'installer':
                    (folder / 'out' / first).write_bytes(b'corrupt')
                elif action == 'blockmap':
                    (folder / 'out' / (first + '.blockmap')).write_bytes(b'corrupt')
                elif action == 'missing':
                    (folder / 'out' / first).unlink()
                elif action == 'extra':
                    (folder / 'out/synthetic.zip').write_bytes(b'do not publish')
                else:
                    sums = folder / 'out/SHASUMS256.txt'
                    line = sums.read_text().splitlines()[0] if action == 'duplicate' else 'a' * 64 + '  ../outside'
                    sums.write_text(sums.read_text() + line + '\n')
                with self.assertRaises(Error):
                    publisher.validate_artifact(folder, 'mac-arm64', VERSION)

    def test_reused_safe_extractor_rejects_path_traversal_symlinks_and_duplicates(self):
        for kind in ('traversal', 'link', 'case-duplicate', 'oversize'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                archive = Path(tmp) / 'artifact.zip'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    if kind == 'traversal':
                        zipped.writestr('../outside', b'x')
                    elif kind == 'link':
                        info = zipfile.ZipInfo('out/link')
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        zipped.writestr(info, b'../outside')
                    elif kind == 'case-duplicate':
                        zipped.writestr('out/A.exe', b'x')
                        zipped.writestr('out/a.exe', b'x')
                    else:
                        zipped.writestr('out/huge.exe', b'xx')
                with patch.object(publisher.transport, 'MAX_FILE_BYTES', 1 if kind == 'oversize' else 1024):
                    with self.assertRaises(publisher.transport.ArtifactError):
                        publisher.transport.safe_extract_zip(archive, Path(tmp) / 'files')
                self.assertFalse((Path(tmp) / 'files').exists())

    def test_download_uses_github_digest_and_verified_transport(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'artifact'
            def transfer(url, size, digest, archive, *, progress):
                self.assertEqual(digest, artifacts()['mac-arm64']['digest'])
                archive.write_bytes(b'fixture')
            with patch.object(publisher.transport, 'signed_url', return_value='signed-url') as signed, \
                    patch.object(publisher.transport, 'download_ranges', side_effect=transfer), \
                    patch.object(publisher.transport, 'safe_extract_zip') as extract, patch.object(publisher.release, 'log'):
                publisher.download(artifacts()['mac-arm64'], folder)
                signed.assert_called_once_with(publisher.REPOSITORY, 11)
                extract.assert_called_once()


class PublicationGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.notes = publisher.notes_for(TAG, build(), artifacts(), SHAS)
        (self.folder / 'RELEASE-NOTES.md').write_text(self.notes)
        (self.folder / 'installer.exe').write_bytes(b'synthetic')
        self.files = {path.name: path for path in self.folder.iterdir()}
        self.document = {'id': 999, 'tag_name': TAG, 'target_commitish': SHELL_SHA,
                         'draft': True, 'prerelease': True, 'body': self.notes, 'assets': [],
                         'html_url': f'https://github.com/{publisher.REPOSITORY}/releases/tag/{TAG}'}
        self.commands = []

    def asset(self, name):
        file = self.files[name]
        return {'name': name, 'state': 'uploaded', 'size': file.stat().st_size,
                'digest': 'sha256:' + publisher.release.sha256(file)}

    def command(self, *args, **kwargs):
        self.commands.append(args)
        if args[:3] == ('gh', 'release', 'upload'):
            self.document['assets'].append(self.asset(Path(args[4]).name))
        if args[:4] == ('gh', 'api', '--method', 'PATCH'):
            self.document['draft'] = False
        return ''

    def publish(self):
        with patch.object(publisher.release, 'optional_api',
                          side_effect=lambda *a: {'ref': TAG} if not self.document['draft'] else None), \
                patch.object(publisher.release, 'api', return_value={'sha': SHELL_SHA}), \
                patch.object(publisher.release, 'find_release', side_effect=lambda *a: copy.deepcopy(self.document)), \
                patch.object(publisher.release, 'command', side_effect=self.command), patch('builtins.print'):
            publisher.publish_bundle(self.folder, TAG, build(), artifacts(), SHAS)

    def test_resume_matching_draft_only_uploads_missing_assets_then_publishes(self):
        self.document['assets'].append(self.asset('installer.exe'))
        self.publish()
        uploads = [args for args in self.commands if args[:3] == ('gh', 'release', 'upload')]
        self.assertEqual(len(uploads), 1)
        self.assertTrue(uploads[0][4].endswith('RELEASE-NOTES.md'))
        self.assertFalse(self.document['draft'])
        self.assertNotIn('--clobber', str(self.commands))

    def test_no_mutation_of_public_wrong_target_wrong_notes_or_normal_release(self):
        for key, value in [('draft', False), ('target_commitish', SHAS['wb']), ('body', 'unrelated'),
                           ('tag_name', TAG + 'x'), ('prerelease', False)]:
            original = copy.deepcopy(self.document)
            self.document[key] = value
            with self.subTest(key=key), self.assertRaises(Error):
                self.publish()
            self.assertEqual(self.commands, [])
            self.document = original

    def test_bad_existing_asset_digest_missing_digest_or_extras_stop_before_upload(self):
        for kind in ('digest', 'missing', 'size', 'state', 'extra', 'duplicate'):
            asset = self.asset('installer.exe')
            if kind == 'digest':
                asset['digest'] = 'sha256:' + '0' * 64
            elif kind == 'missing':
                del asset['digest']
            elif kind == 'size':
                asset['size'] += 1
            elif kind == 'state':
                asset['state'] = 'starter'
            elif kind == 'extra':
                asset['name'] = 'test-data.zip'
            self.document['assets'] = [asset, asset] if kind == 'duplicate' else [asset]
            with self.subTest(kind=kind), self.assertRaises(Error):
                self.publish()
            self.assertEqual(self.commands, [])

    def test_uploaded_server_digest_verified_before_publish(self):
        def corrupt_upload(*args, **kwargs):
            self.command(*args, **kwargs)
            if args[:3] == ('gh', 'release', 'upload'):
                self.document['assets'][-1]['digest'] = 'sha256:' + '0' * 64
        with patch.object(publisher.release, 'optional_api', return_value=None), \
                patch.object(publisher.release, 'find_release', side_effect=lambda *a: copy.deepcopy(self.document)), \
                patch.object(publisher.release, 'command', side_effect=corrupt_upload):
            with self.assertRaises(Error):
                publisher.publish_bundle(self.folder, TAG, build(), artifacts(), SHAS)
        self.assertTrue(self.document['draft'])
        self.assertFalse(any(args[:4] == ('gh', 'api', '--method', 'PATCH') for args in self.commands))

    def test_existing_tag_must_resolve_to_desktop_shell(self):
        with patch.object(publisher.release, 'optional_api', return_value={'ref': TAG}), \
                patch.object(publisher.release, 'api', return_value={'sha': SHAS['wb']}):
            with self.assertRaisesRegex(Error, 'another commit'):
                publisher.check_tag(TAG, SHELL_SHA)
        with patch.object(publisher.release, 'optional_api', return_value={'ref': TAG}), \
                patch.object(publisher.release, 'api', return_value={'sha': SHELL_SHA}):
            publisher.check_tag(TAG, SHELL_SHA)
        with patch.object(publisher.release, 'optional_api', return_value=None):
            with self.assertRaisesRegex(Error, 'missing'):
                publisher.check_tag(TAG, SHELL_SHA, required=True)

    def test_new_draft_is_created_without_public_assets_and_verified_before_publication(self):
        exists = False
        def command(*args, **kwargs):
            nonlocal exists
            if args[:3] == ('gh', 'release', 'create'):
                self.assertIn('--draft', args)
                self.assertIn('--prerelease', args)
                self.assertIn('--latest=false', args)
                self.assertEqual(args[args.index('--target') + 1], SHELL_SHA)
                self.assertIn('--notes-file', args)
                exists = True
            self.command(*args, **kwargs)
        with patch.object(publisher.release, 'optional_api',
                          side_effect=lambda *a: {'ref': TAG} if not self.document['draft'] else None), \
                patch.object(publisher.release, 'api', return_value={'sha': SHELL_SHA}), \
                patch.object(publisher.release, 'find_release',
                             side_effect=lambda *a: copy.deepcopy(self.document) if exists else None), \
                patch.object(publisher.release, 'command', side_effect=command), patch('builtins.print'):
            publisher.publish_bundle(self.folder, TAG, build(), artifacts(), SHAS)
        self.assertFalse(self.document['draft'])
        self.assertEqual(self.commands[0][:3], ('gh', 'release', 'create'))
        self.assertEqual(self.commands[-1][:4], ('gh', 'api', '--method', 'PATCH'))

    def test_interrupted_upload_never_reaches_publish_and_keeps_draft(self):
        def fail_upload(*args, **kwargs):
            self.commands.append(args)
            raise Error('Simulated network interruption.')
        with patch.object(publisher.release, 'optional_api', return_value=None), \
                patch.object(publisher.release, 'find_release', return_value=self.document), \
                patch.object(publisher.release, 'command', side_effect=fail_upload):
            with self.assertRaisesRegex(Error, 'interruption'):
                publisher.publish_bundle(self.folder, TAG, build(), artifacts(), SHAS)
        self.assertTrue(self.document['draft'])
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.commands[0][:3], ('gh', 'release', 'upload'))

    def test_draft_identity_binds_run_attempt_and_artifact_digest(self):
        modified = artifacts()
        modified['mac-arm64']['digest'] = 'sha256:' + '0' * 64
        for changed_notes in (publisher.notes_for(TAG, {**build(), 'run_attempt': 2}, artifacts(), SHAS),
                              publisher.notes_for(TAG, build(), modified, SHAS)):
            with self.assertRaises(Error):
                publisher.check_draft(self.document, TAG, SHELL_SHA, changed_notes)

    def test_workflow_manual_main_only_and_inputs_never_interpolated_into_shell(self):
        workflow = (publisher.ROOT / '.github/workflows/desktop-release.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('\n  push:', workflow)
        self.assertNotIn('workflow_run:', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertEqual(workflow.count('contents: write'), 1)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('--run-id "$DESKTOP_RUN_ID" --tag "$DESKTOP_TAG"', workflow)
        self.assertNotIn('--tag "${{', workflow)


if __name__ == '__main__':
    unittest.main()
