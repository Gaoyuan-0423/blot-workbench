#!/usr/bin/env python3
"""Stage actual offline builds; CI sources must be full pinned SHA values.

No deployment, tag creation, or source checkout occurs here. The same validated
web-dist bytes can be used by web releases and desktop packages.
"""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

DESKTOP = Path(__file__).resolve().parents[1]
ROOT = DESKTOP.parent
DEPLOY = ROOT / 'deployment' / 'wisplab'
sys.path.insert(0, str(DEPLOY))
import artifact_download
import release
spec = importlib.util.spec_from_file_location('desktop_packager_validation', DEPLOY / 'package-release.py')
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)
REPOS = {
    'wb': 'Gaoyuan-0423/blot-workbench',
    'pathology': 'Gaoyuan-0423/pathology-workbench',
    'pcr': 'Gaoyuan-0423/pcr-workbench',
}
PORTAL_FILES = ['index.html', 'styles.css', 'locale.js', 'favicon.svg',
                'platform/wisplab.js', 'platform/client.js', 'platform/wisplab.css', 'platform/manifest.json']


def full_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value or ''):
        raise argparse.ArgumentTypeError('A complete 40-character lowercase commit SHA is required; main/latest/tags are not accepted.')
    return value


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f'Cannot read Git provenance for {root.name}')
    return result.stdout.strip()


def put_files(source, target, *, portal=False, site=None):
    files = validation.collect_files(source, portal=portal)
    validation.check_index(site or 'portal', files)
    if site:
        validation.validate_ci_layout(site, files)
    for name, data in files.items():
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    return {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}


def stage_local(args, apps):
    sources = {}
    paths = {name: getattr(args, name).expanduser().resolve() for name in REPOS}
    for name, root in paths.items():
        sha = full_sha(git(root, 'rev-parse', 'HEAD'))
        dirty = bool(git(root, 'status', '--porcelain'))
        if dirty and not args.allow_dirty:
            raise RuntimeError(f'{name} has uncommitted changes; commit first or explicitly use --allow-dirty for development.')
        if args.build:
            subprocess.run(['npm.cmd' if sys.platform == 'win32' else 'npm', 'run', 'build'], cwd=root, check=True)
        files = put_files(root / 'dist', apps / name, site=name)
        sources[name] = {'repository': REPOS[name], 'gitSha': sha, 'dirty': dirty,
                         'buildOrigin': 'local-development', 'builtBeforeStaging': args.build, 'files': files}
    sources['portal'] = {'repository': REPOS['wb'], 'gitSha': sources['wb']['gitSha'],
                         'dirty': sources['wb']['dirty'], 'buildOrigin': 'local-development',
                         'files': put_files(paths['wb'] / 'deployment/wisplab/portal', apps / 'portal', portal=True)}
    return sources


def stage_ci(args, apps, staging):
    sources = {}
    for name, repository in REPOS.items():
        sha = getattr(args, name + '_sha')
        run, artifact = release.get_ci(repository, sha, args.ci_wait)
        # Entire CI must succeed, not just the job that uploaded a web-dist.
        if not release.matching_ci(run, repository, sha) or run.get('conclusion') != 'success':
            raise RuntimeError(f'{name} does not have a fully successful matching main CI run.')
        extracted = staging / (name + '-artifact')
        artifact_download.download_artifact(repository, artifact, extracted, required_file='index.html', progress=print)
        files = put_files(extracted, apps / name, site=name)
        sources[name] = {'repository': repository, 'gitSha': sha, 'dirty': False,
                         'buildOrigin': 'successful-ci-artifact', 'ci': release.record_ci(run, artifact), 'files': files}
    portal = staging / 'portal-source'
    portal.mkdir()
    for name in PORTAL_FILES:
        data = release.api(f'repos/{REPOS["wb"]}/contents/deployment/wisplab/portal/{name}?ref={args.wb_sha}')
        if data.get('type') != 'file' or data.get('encoding') != 'base64':
            raise RuntimeError('Pinned portal source is not a regular base64 GitHub file.')
        blob = base64.b64decode(data['content'])
        actual_blob = hashlib.sha1(b'blob ' + str(len(blob)).encode() + b'\0' + blob).hexdigest()
        if actual_blob != data.get('sha'):
            raise RuntimeError('Pinned portal Git blob hash does not match its content.')
        (portal / name).parent.mkdir(parents=True, exist_ok=True)
        (portal / name).write_bytes(blob)
    sources['portal'] = {'repository': REPOS['wb'], 'gitSha': args.wb_sha, 'dirty': False,
                         'buildOrigin': 'pinned-source', 'files': put_files(portal, apps / 'portal', portal=True)}
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    local = sub.add_parser('local', help='Combine local built dist directories for offline development.')
    local.add_argument('--wb', type=Path, default=ROOT)
    local.add_argument('--pathology', type=Path, required=True)
    local.add_argument('--pcr', type=Path, required=True)
    local.add_argument('--build', action='store_true', help='Build each existing checkout before staging.')
    local.add_argument('--allow-dirty', action='store_true', help='Explicitly label uncommitted builds as development only.')
    ci = sub.add_parser('ci', help='Download exact fully successful CI artifacts; no mutable latest lookup.')
    for name in REPOS:
        ci.add_argument('--' + name + '-sha', type=full_sha, required=True)
    ci.add_argument('--ci-wait', type=int, default=600)
    args = parser.parse_args()
    destination = DESKTOP / 'resources'
    with tempfile.TemporaryDirectory(prefix='wisplab-desktop-stage-') as tmp:
        # macOS exposes its temporary directory through /var -> /private/var.
        # Canonicalize only our newly created staging root; artifact contents
        # still go through the strict no-symlink validator.
        staging = Path(tmp).resolve()
        resources = staging / 'resources'
        apps = resources / 'apps'
        apps.mkdir(parents=True)
        sources = stage_local(args, apps) if args.mode == 'local' else stage_ci(args, apps, staging)
        version = json.loads((DESKTOP / 'package.json').read_text())['version']
        manifest = {'schemaVersion': 1, 'product': 'WispLab Desktop', 'version': version,
                    'experimental': True, 'signed': False, 'mode': args.mode,
                    'builtAt': datetime.now(timezone.utc).isoformat(),
                    'desktopGitSha': git(ROOT, 'rev-parse', 'HEAD'),
                    'desktopTreeDirty': bool(git(ROOT, 'status', '--porcelain')),
                    'sources': sources}
        (resources / 'release.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        if destination.exists():
            if destination.is_symlink() or not (destination / 'release.json').is_file():
                raise RuntimeError('Existing resources directory is not a generated desktop staging area; refusing to replace it.')
            shutil.rmtree(destination)
        shutil.copytree(resources, destination)
    print(json.dumps({'version': version, 'mode': args.mode, 'sources': {key: value['gitSha'] for key, value in sources.items()}, 'output': str(destination)}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError, release.ReleaseError, validation.PackageError, artifact_download.ArtifactError) as error:
        print(f'Desktop staging failed: {error}', file=sys.stderr)
        raise SystemExit(1)
