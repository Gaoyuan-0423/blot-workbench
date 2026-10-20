#!/usr/bin/env python3
"""Publish exact successful desktop CI artifacts; never rebuild or replace assets."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deployment/wisplab'))
import release

# Reuse the web publisher's credential-safe transport and ZIP validation, with
# separate desktop limits. Do not change the web publisher's module constants.
spec = importlib.util.spec_from_file_location(
    'desktop_release_transport', ROOT / 'deployment/wisplab/artifact_download.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
transport.MAX_BYTES = 2 * 1024**3
transport.MAX_FILE_BYTES = 1024**3

REPOSITORY = 'Gaoyuan-0423/blot-workbench'
WORKFLOW = '.github/workflows/desktop.yml'
PLATFORMS = ('mac-arm64', 'mac-x64', 'win-x64')
TAG_RE = re.compile(r'wisplab-desktop-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-experimental\.(?:0|[1-9][0-9]*))\Z')
SHA_RE = re.compile(r'[0-9a-f]{40}\Z')
DIGEST_RE = re.compile(r'sha256:[0-9a-f]{64}\Z')


def require(condition, message):
    if not condition:
        raise release.ReleaseError(message)


def full_sha(value):
    if not SHA_RE.fullmatch(value):
        raise argparse.ArgumentTypeError('Expected a full 40-character lowercase commit SHA.')
    return value


def desktop_tag(value):
    if not TAG_RE.fullmatch(value) or len(value) > 100:
        raise argparse.ArgumentTypeError('Expected wisplab-desktop-X.Y.Z-experimental.N.')
    return value


def run_id(value):
    if not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise argparse.ArgumentTypeError('Expected a positive desktop workflow run ID.')
    return int(value)


def get_build(identifier):
    run = release.api(f'repos/{REPOSITORY}/actions/runs/{identifier}')
    require(run.get('id') == identifier
            and run.get('repository', {}).get('full_name', '').lower() == REPOSITORY.lower()
            and run.get('head_repository', {}).get('full_name', '').lower() == REPOSITORY.lower()
            and run.get('path') == WORKFLOW and run.get('head_branch') == 'main'
            and run.get('event') == 'workflow_dispatch'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and SHA_RE.fullmatch(run.get('head_sha', ''))
            and type(run.get('run_attempt')) is int and run['run_attempt'] > 0,
            'Source must be a completed successful main desktop.yml dispatch in this repository.')
    workflow = release.api(f'repos/{REPOSITORY}/actions/workflows/{run["workflow_id"]}')
    require(workflow.get('path') == WORKFLOW, 'Source workflow ID does not identify desktop.yml.')
    page = release.api(f'repos/{REPOSITORY}/actions/runs/{identifier}/artifacts?per_page=100')
    rows = page.get('artifacts', [])
    require(page.get('total_count') == len(rows) and len(rows) <= 100,
            'Incomplete artifact listing; refusing to guess which build to publish.')
    artifacts = {}
    for platform in PLATFORMS:
        name = f'WispLab-{platform}-unsigned'
        matches = [item for item in rows if item.get('name') == name]
        require(len(matches) == 1, f'Expected exactly one {name} artifact.')
        item = matches[0]
        provenance = item.get('workflow_run', {})
        require(item.get('expired') is False and type(item.get('id')) is int and item['id'] > 0
                and type(item.get('size_in_bytes')) is int
                and 0 < item['size_in_bytes'] <= transport.MAX_BYTES
                and DIGEST_RE.fullmatch(item.get('digest') or '')
                and provenance.get('id') == identifier
                and provenance.get('head_sha') == run['head_sha']
                and provenance.get('head_branch') == 'main',
                f'{name} is expired or has invalid build provenance, size or digest.')
        artifacts[platform] = item
    require(len({item['id'] for item in artifacts.values()}) == 3, 'Artifact IDs are not unique.')
    return run, artifacts


def download(item, destination):
    archive = destination.with_suffix('.zip')
    release.log(f'Downloading {item["name"]}: artifact {item["id"]}, {item["size_in_bytes"]:,} bytes')
    transport.download_ranges(transport.signed_url(REPOSITORY, item['id']),
                              item['size_in_bytes'], item['digest'], archive, progress=release.log)
    transport.safe_extract_zip(archive, destination)
    archive.unlink()


def installer_names(version, platform):
    prefix = f'WispLab-{version}-{platform}'
    if platform == 'win-x64':
        return {f'{prefix}-setup-unsigned.exe', f'{prefix}-portable-unsigned.exe'}
    return {f'{prefix}-unsigned.dmg', f'{prefix}-unsigned.zip'}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate manifest key: {key}')
        result[key] = value
    return result


def validate_manifest(raw, run, expected, version):
    require(0 < len(raw) <= 4 * 1024**2, 'Source manifest is empty or too large.')
    manifest = json.loads(raw, object_pairs_hook=unique_object)
    require(manifest.get('schemaVersion') == 1 and manifest.get('product') == 'WispLab Desktop'
            and manifest.get('version') == version and manifest.get('mode') == 'ci'
            and manifest.get('experimental') is True and manifest.get('signed') is False
            and manifest.get('desktopTreeDirty') is False
            and manifest.get('desktopGitSha') == run['head_sha'],
            'Manifest must describe a clean, unsigned CI build at the source desktop run SHA.')
    sources = manifest.get('sources', {})
    require(set(sources) == {'wb', 'pathology', 'pcr', 'portal'}, 'Unexpected manifest source set.')
    for tool, repository in release.REPOS.items():
        source = sources[tool]
        ci = source.get('ci', {})
        require(source.get('repository') == repository and source.get('gitSha') == expected[tool]
                and source.get('dirty') is False and source.get('buildOrigin') == 'successful-ci-artifact'
                and ci.get('headSha') == expected[tool] and ci.get('conclusion') == 'success'
                and type(ci.get('runId')) is int and ci['runId'] > 0
                and type(ci.get('artifactId')) is int and ci['artifactId'] > 0
                and ci.get('artifactName') == 'web-dist'
                and DIGEST_RE.fullmatch(ci.get('artifactDigest') or ''),
                f'{tool} manifest does not match the requested clean successful CI source.')
    portal = sources['portal']
    require(portal.get('repository') == REPOSITORY and portal.get('gitSha') == expected['wb']
            and portal.get('dirty') is False and portal.get('buildOrigin') == 'pinned-source',
            'Portal must come from the same pinned WB source.')
    return manifest


def validate_artifact(folder, platform, version):
    output = folder / 'out'
    checksum = output / 'SHASUMS256.txt'
    require(checksum.is_file() and checksum.stat().st_size <= 65536, 'Missing or oversized SHASUMS256.txt.')
    expected = installer_names(version, platform)
    allowed = expected | {name + '.blockmap' for name in expected}
    hashes = {}
    for line in checksum.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9._-]+)', line)
        require(match is not None, 'Malformed installer checksum line.')
        digest, name = match.groups()
        require(name in allowed and name not in hashes, 'Unexpected or duplicate checksummed file.')
        file = output / name
        require(file.is_file() and not file.is_symlink() and file.stat().st_size > 0
                and release.sha256(file) == digest, f'Installer checksum mismatch: {name}')
        hashes[name] = digest
    actual = {path.name for path in output.iterdir() if path.name != 'SHASUMS256.txt'}
    require(expected <= hashes.keys() and actual == hashes.keys(),
            'Installer output contains missing or unchecksummed files.')
    return {name: output / name for name in sorted(expected)}


def notes_for(tag, run, artifacts, expected):
    # This deterministic marker binds an interrupted draft to the exact build,
    # artifact IDs/digests and requested sources, not just a mutable tag/title.
    identity = {'tag': tag, 'runId': run['id'], 'runAttempt': run['run_attempt'],
                'desktopGitSha': run['head_sha'], 'sources': expected,
                'artifacts': {key: {'id': value['id'], 'digest': value['digest']}
                              for key, value in sorted(artifacts.items())}}
    marker = '<!-- wisplab-desktop-publisher-v1 ' + json.dumps(identity, sort_keys=True, separators=(',', ':')) + ' -->'
    return (f'WispLab Desktop {TAG_RE.fullmatch(tag)[1]}\n\n'
            '实验性未签名版本 / Experimental unsigned build. macOS 未公证；Windows 未签名。'
            ' No macOS notarization or Windows code signing.\n\n'
            '核心分析可离线使用；账号登录可选；实验项目保存在本机，不提供云端同步。'
            ' Core analysis works offline; login is optional; experimental projects stay local, without cloud sync.\n\n'
            'macOS: 选择 arm64（Apple Silicon）或 x64（Intel）的 DMG/ZIP。'
            ' Windows x64: setup 安装版或 portable 便携版。\n'
            'Choose the matching architecture. Update manually; keep local project exports as backups.\n'
            '手动安装更新，更新前导出本地项目留作备份。\n\n'
            f'Build: https://github.com/{REPOSITORY}/actions/runs/{run["id"]}\n'
            f'Desktop shell: `{run["head_sha"]}`\n'
            + ''.join(f'- {tool}: `{sha}`\n' for tool, sha in sorted(expected.items()))
            + '\nSHASUMS256.txt covers exactly the six installers / 校验清单只覆盖六个安装包。\n\n'
            + marker + '\n')


def prepare_bundle(root, run, artifacts, expected, tag):
    version = TAG_RE.fullmatch(tag)[1]
    output = root / 'publish'
    output.mkdir()
    common_manifest = None
    for platform, item in artifacts.items():
        folder = root / platform
        download(item, folder)
        raw = (folder / 'resources/release.json').read_bytes()
        validate_manifest(raw, run, expected, version)
        require(common_manifest is None or raw == common_manifest,
                'Platform release.json files differ; refusing a mixed-source release.')
        common_manifest = raw
        for name, file in validate_artifact(folder, platform, version).items():
            shutil.copyfile(file, output / name)
        # Reports, screenshots, test ZIPs, profiles and blockmaps are never copied.
        shutil.rmtree(folder)
    installers = sorted(output.iterdir())
    require(len(installers) == 6, 'Expected exactly six installers.')
    (output / 'SHASUMS256.txt').write_text(
        ''.join(f'{release.sha256(file)}  {file.name}\n' for file in installers), encoding='utf-8')
    (output / 'release.json').write_bytes(common_manifest)
    (output / 'RELEASE-NOTES.md').write_text(notes_for(tag, run, artifacts, expected), encoding='utf-8')
    return output


def check_tag(tag, sha, *, required=False):
    existing = release.optional_api(f'repos/{REPOSITORY}/git/ref/tags/{tag}')
    require(existing is not None or not required, 'Published release tag is missing; publication is not verified.')
    if existing:
        require(release.api(f'repos/{REPOSITORY}/commits/{tag}').get('sha') == sha,
                'Existing tag points to another commit; it will not be moved.')


def check_draft(document, tag, sha, notes):
    require(document.get('tag_name') == tag and document.get('target_commitish') == sha
            and document.get('draft') is True and document.get('prerelease') is True
            and document.get('body') == notes,
            'Existing release is public or is not the exact matching publisher draft; refusing to modify it.')
    require(type(document.get('id')) is int and document['id'] > 0, 'Invalid release ID.')


def check_assets(document, files, *, complete=False):
    rows = document.get('assets', [])
    assets = {item.get('name'): item for item in rows}
    require(len(assets) == len(rows) and assets.keys() <= files.keys(), 'Release contains duplicate or unexpected assets.')
    require(not complete or assets.keys() == files.keys(), 'Release is missing expected assets.')
    for name, asset in assets.items():
        require(asset.get('state') == 'uploaded', f'Release asset is incomplete: {name}')
        release.require_asset_digest(asset, files[name])
    return assets


def publish_bundle(folder, tag, run, artifacts, expected):
    notes = notes_for(tag, run, artifacts, expected)
    sha = run['head_sha']
    files = {file.name: file for file in folder.iterdir()}
    check_tag(tag, sha)
    document = release.find_release(tag)
    if document is None:
        release.command('gh', 'release', 'create', tag, '--repo', REPOSITORY,
                        '--target', sha, '--title', f'WispLab Desktop {TAG_RE.fullmatch(tag)[1]}',
                        '--notes-file', str(folder / 'RELEASE-NOTES.md'),
                        '--draft', '--prerelease', '--latest=false')
        document = release.find_release(tag)
        require(document is not None, 'Draft creation outcome unknown; rerun with the same inputs.')
    check_draft(document, tag, sha, notes)
    identifier = document['id']
    for name, file in sorted(files.items()):
        check_draft(document, tag, sha, notes)
        assets = check_assets(document, files)
        if name not in assets:
            # No --clobber: a failed upload is never silently replaced.
            release.command('gh', 'release', 'upload', tag, str(file), '--repo', REPOSITORY, timeout=1800)
        document = release.find_release(tag, identifier)
    check_draft(document, tag, sha, notes)
    check_assets(document, files, complete=True)
    check_tag(tag, sha)
    release.command('gh', 'api', '--method', 'PATCH', f'repos/{REPOSITORY}/releases/{identifier}',
                    '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false')
    document = release.find_release(tag, identifier)
    require(document.get('draft') is False and document.get('prerelease') is True
            and document.get('target_commitish') == sha and document.get('body') == notes,
            'Publication not confirmed; inspect the existing release before retrying.')
    check_assets(document, files, complete=True)
    check_tag(tag, sha, required=True)
    print(f'Published verified experimental release: {document["html_url"]}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True, type=run_id)
    parser.add_argument('--tag', required=True, type=desktop_tag)
    for tool in release.REPOS:
        parser.add_argument(f'--{tool}-sha', required=True, type=full_sha)
    parser.add_argument('--publish', action='store_true', help='Explicitly create/resume and publish a verified draft.')
    args = parser.parse_args()
    expected = {tool: getattr(args, tool + '_sha') for tool in release.REPOS}
    run, artifacts = get_build(args.run_id)
    notes = notes_for(args.tag, run, artifacts, expected)
    check_tag(args.tag, run['head_sha'])
    existing = release.find_release(args.tag)
    if existing:
        check_draft(existing, args.tag, run['head_sha'], notes)
    with tempfile.TemporaryDirectory(prefix='wisplab-desktop-release-') as temporary:
        folder = prepare_bundle(Path(temporary), run, artifacts, expected, args.tag)
        if args.publish:
            publish_bundle(folder, args.tag, run, artifacts, expected)
        else:
            print('Validated six installers and provenance; no tag, release or asset was changed.')


if __name__ == '__main__':
    try:
        main()
    except (release.ReleaseError, transport.ArtifactError, OSError, ValueError, KeyError, TypeError) as error:
        print(f'Desktop release stopped: {error}', file=sys.stderr)
        raise SystemExit(1)
