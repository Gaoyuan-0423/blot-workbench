#!/usr/bin/env bash
# Install the weekly account-service backup timer on the Ubuntu server.
# Run after deployment approval: scp this directory, then
#   sudo bash /tmp/wisplab-cloud-deploy/ubuntu/install-backup-timer.sh
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -m 750 "$source_dir/wisplab-backup.sh" /usr/local/sbin/wisplab-backup.sh
install -m 644 "$source_dir/wisplab-backup.service" "$source_dir/wisplab-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wisplab-backup.timer
systemctl list-timers wisplab-backup.timer --no-pager
