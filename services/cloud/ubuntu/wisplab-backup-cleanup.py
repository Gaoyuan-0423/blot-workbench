#!/usr/bin/env python3
"""Rotate named automatic archives using original UTC time, never mtime."""
import argparse
import datetime as dt
import fcntl
import os
from pathlib import Path
import re

PATTERN = re.compile(r"backup-(\d{8}T\d{6}Z)\.tar\.gz")
INCOMPLETE = re.compile(r"\.incomplete-(\d{8}T\d{6}Z)-[A-Za-z0-9]{6}")
MAX_AGE = dt.timedelta(days=13)  # Daily cleanup leaves margin within ~14 days.


def cleanup(directory, now):
    archives = []
    incomplete = []
    for path in directory.iterdir():
        match = PATTERN.fullmatch(path.name)
        partial = INCOMPLETE.fullmatch(path.name)
        if path.is_symlink() or not ((match and path.is_file()) or (partial and path.is_dir())):
            continue
        try:
            stamp = (match or partial)[1]
            created = dt.datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if created > now:
            raise ValueError("Future-dated automatic backup; check system clock: " + path.name)
        if partial:
            allowed = {"backup-" + stamp + ".tar.gz", "backup-" + stamp + ".tar.gz.sha256"}
            children = list(path.iterdir())
            if any(child.name not in allowed or child.is_symlink() or not child.is_file() for child in children):
                raise ValueError("Unexpected incomplete backup contents: " + path.name)
            incomplete.append((created, path, children))
        else:
            archives.append((created, path))
    # Validate fully before deleting. No recursion or manual archive names.
    for index, (created, path) in enumerate(sorted(archives, reverse=True)):
        if index >= 2 or now - created >= MAX_AGE:
            path.unlink()
            checksum = path.with_name(path.name + ".sha256")
            if checksum.exists() or checksum.is_symlink():
                checksum.unlink()
            print("expired automatic backup: " + path.name, flush=True)
    # SIGKILL/power loss bypasses shell traps. Age these partial copies as well.
    for created, path, children in incomplete:
        if now - created >= MAX_AGE:
            for child in children:
                child.unlink()
            path.rmdir()
            print("expired incomplete backup: " + path.name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("/var/backups/wisplab-platform"))
    parser.add_argument("--lock", default="/run/lock/wisplab-backup.lock")
    parser.add_argument("--lock-held", action="store_true", help="backup.sh holds inherited fd 9")
    args = parser.parse_args()
    if args.lock_held:
        os.fstat(9)
        cleanup(args.directory, dt.datetime.now(dt.timezone.utc))
    else:
        with open(args.lock, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            cleanup(args.directory, dt.datetime.now(dt.timezone.utc))


if __name__ == "__main__":
    main()
