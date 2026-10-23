"""Backup regression tests using synthetic files and fake system services only."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent / 'ubuntu'
spec = importlib.util.spec_from_file_location('cleanup', ROOT / 'wisplab-backup-cleanup.py')
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)
NOW = dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc)


class Retention(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def archive(self, age):
        name = 'backup-' + (NOW - dt.timedelta(days=age)).strftime('%Y%m%dT%H%M%SZ') + '.tar.gz'
        path = self.root / name
        path.write_text('synthetic')
        path.with_name(name + '.sha256').write_text('synthetic')
        return path

    def test_count_and_checksum_pairs(self):
        newest, second, old = [self.archive(x) for x in [0, 1, 2]]
        cleaner.cleanup(self.root, NOW)
        self.assertTrue(newest.exists() and second.exists())
        self.assertFalse(old.exists() or old.with_name(old.name + '.sha256').exists())

    def test_age_without_new_backup_and_mtime_ignored(self):
        fresh, expired = self.archive(12), self.archive(13)
        os.utime(expired, None)  # Copy/touch must not renew retention.
        cleaner.cleanup(self.root, NOW)
        self.assertTrue(fresh.exists())
        self.assertFalse(expired.exists())

    def test_manual_invalid_nested_and_symlinks_untouched(self):
        names = ['20261022T151039Z-pre-delete-api.tar.gz', 'backup-20261399T000000Z.tar.gz', '.incomplete-data']
        for name in names:
            (self.root / name).write_text('synthetic')
        (self.root / 'manual').mkdir()
        nested = self.root / 'manual/backup-20200101T000000Z.tar.gz'
        nested.write_text('synthetic')
        link = self.root / 'backup-20200101T000000Z.tar.gz'
        link.symlink_to(nested)
        cleaner.cleanup(self.root, NOW)
        self.assertTrue(all((self.root / name).exists() for name in names))
        self.assertTrue(link.is_symlink() and nested.exists())

    def test_future_clock_aborts_before_any_deletion(self):
        old, future = self.archive(20), self.archive(-1)
        with self.assertRaises(ValueError):
            cleaner.cleanup(self.root, NOW)
        self.assertTrue(old.exists() and future.exists())

    def test_deletion_failure_is_not_silenced(self):
        self.archive(20)
        with patch.object(Path, 'unlink', side_effect=PermissionError('synthetic refusal')):
            with self.assertRaises(PermissionError):
                cleaner.cleanup(self.root, NOW)

    def test_killed_backup_partial_copies_expire(self):
        partial = self.root / '.incomplete-20261001T000000Z-AbC123'
        partial.mkdir()
        (partial / 'backup-20261001T000000Z.tar.gz').write_text('synthetic partial account copy')
        fresh = self.root / '.incomplete-20261023T000000Z-AbC123'
        fresh.mkdir()
        cleaner.cleanup(self.root, NOW)
        self.assertFalse(partial.exists())
        self.assertTrue(fresh.exists())

    def test_unexpected_partial_contents_fail_closed(self):
        archive = self.archive(20)
        partial = self.root / '.incomplete-20261001T000000Z-AbC123'
        partial.mkdir()
        (partial / 'unrelated').write_text('must keep')
        with self.assertRaises(ValueError):
            cleaner.cleanup(self.root, NOW)
        self.assertTrue(archive.exists() and (partial / 'unrelated').exists())


class BackupFailures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.source = self.root / 'source'
        for name in ['var/lib/wisplab-cloud/pb_data', 'opt/wisplab-cloud/releases/test/bin', 'etc/wisplab-cloud', 'etc/caddy/wisplab-cloud']:
            (self.source / name).mkdir(parents=True)
        for name in ['var/lib/wisplab-cloud/pb_data/data.db', 'opt/wisplab-cloud/releases/test/bin/pocketbase', 'etc/wisplab-cloud/environment', 'etc/caddy/wisplab-cloud/cloud.caddy']:
            (self.source / name).write_text('synthetic only')
        (self.source / 'opt/wisplab-cloud/current').symlink_to('releases/test')
        self.state = self.root / 'state'
        self.state.write_text('active')
        self.log = self.root / 'calls'
        self.output = self.root / 'backups'
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'], 'TEST_STATE': str(self.state), 'TEST_LOG': str(self.log), 'WISPLAB_BACKUP_DIR': str(self.output), 'WISPLAB_BACKUP_SOURCE_ROOT': str(self.source), 'WISPLAB_BACKUP_LOCK': str(self.root / 'lock'), 'WISPLAB_BACKUP_CLEANUP': str(ROOT / 'wisplab-backup-cleanup.py')}
        self.mock('systemctl', '''echo "$1" >> "$TEST_LOG"
case "$1" in
is-active) test "$(cat "$TEST_STATE")" = active ;;
stop) echo stopped > "$TEST_STATE" ;;
start) if test "${FAIL_START:-0}" = 1; then exit 1; fi; echo active > "$TEST_STATE" ;;
esac''')
        self.mock('curl', 'test "${FAIL_HEALTH:-0}" != 1')
        self.mock('sleep', 'exit 0')
        # macOS lacks GNU flock/sha256sum; only these platform commands are mocked.
        # The real inherited fd and Python cleanup still run, while lock contention
        # and systemd scheduling remain Linux deployment checks.
        self.mock('flock', 'exit 0')
        self.mock('sha256sum', 'exec shasum -a 256 "$@"')
        self.mock('readlink', 'exec python3 -c \'import os,sys; print(os.path.realpath(sys.argv[-1]))\' "$@"')

    def mock(self, name, body):
        file = self.bin / name
        file.write_text('#!/bin/sh\n' + body + '\n')
        file.chmod(0o700)

    def run_backup(self, **extra):
        return subprocess.run(['bash', str(ROOT / 'wisplab-backup.sh')], env={**self.env, **extra}, text=True, capture_output=True)

    def test_success_has_real_release_and_valid_checksum(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        archive, = self.output.glob('backup-*.tar.gz')
        with tarfile.open(archive) as tar:
            self.assertIn('opt/wisplab-cloud/releases/test/bin/pocketbase', tar.getnames())
            self.assertTrue(tar.getmember('opt/wisplab-cloud/current').issym())
        result = subprocess.run(['shasum', '-a', '256', '-c', archive.name + '.sha256'], cwd=self.output, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text().strip(), 'active')
        self.assertEqual(list(self.output.glob('.incomplete-*')), [])

    def test_archive_failure_recovers_and_publishes_nothing(self):
        self.mock('tar', 'exit 42')
        result = self.run_backup()
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(self.state.read_text().strip(), 'active')
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertIn('start', self.log.read_text())

    def test_inactive_service_is_not_started(self):
        self.state.write_text('stopped')
        self.assertNotEqual(self.run_backup().returncode, 0)
        self.assertNotIn('start', self.log.read_text())

    def test_restart_failure_is_visible(self):
        result = self.run_backup(FAIL_START='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.log.read_text().count('start\n'), 2)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_health_failure_never_publishes_archive(self):
        result = self.run_backup(FAIL_HEALTH='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('health check failed', result.stderr)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_checksum_failure_keeps_service_up(self):
        self.mock('sha256sum', 'exit 9')
        self.assertNotEqual(self.run_backup().returncode, 0)
        self.assertEqual(self.state.read_text().strip(), 'active')
        self.assertEqual(list(self.output.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
