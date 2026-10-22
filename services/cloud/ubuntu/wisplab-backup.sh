#!/usr/bin/env bash
# Weekly consistent backup per services/cloud/README.md: stop, archive, restart.
# Installed on the server as /usr/local/sbin/wisplab-backup.sh behind
# wisplab-backup.timer (weekly). Keeps only the 2 newest automatic backups;
# the pre-deployment manual archives are never touched by the rotation.
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/var/backups/wisplab-platform/backup-${STAMP}.tar.gz
systemctl stop wisplab-cloud
tar -czf "$OUT" -C / var/lib/wisplab-cloud/pb_data opt/wisplab-cloud/current etc/wisplab-cloud/environment etc/caddy/wisplab-cloud/cloud.caddy
systemctl start wisplab-cloud
sha256sum "$OUT" > "${OUT}.sha256"
ls -1t /var/backups/wisplab-platform/backup-*.tar.gz 2>/dev/null | tail -n +3 | xargs -r rm -f
ls -1t /var/backups/wisplab-platform/backup-*.tar.gz.sha256 2>/dev/null | tail -n +3 | xargs -r rm -f
systemctl is-active --quiet wisplab-cloud
curl -fsS http://127.0.0.1:8090/api/health >/dev/null
echo "$(date -u +%FT%TZ) backup ok: $OUT"
