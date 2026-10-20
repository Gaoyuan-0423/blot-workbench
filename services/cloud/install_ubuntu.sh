#!/usr/bin/env bash
# Run only after deployment approval. Installs artifacts; does NOT start the
# service, create PocketBase accounts, edit the main Caddyfile, or reload Caddy.
set -euo pipefail
umask 077
if [[ "${1:-}" != "--apply" || "$(uname -s)" != "Linux" || "$(id -u)" != "0" ]]; then
  echo "Usage (after review, on Ubuntu): sudo bash services/cloud/install_ubuntu.sh --apply" >&2
  exit 2
fi
if systemctl is-active --quiet wisplab-cloud.service; then
  echo "Stop and back up wisplab-cloud before installing an update." >&2
  exit 1
fi
cloud_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cloud_release="/opt/wisplab-cloud/releases/$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e "$cloud_release" ]]; then echo "Release directory already exists" >&2; exit 1; fi
install -d -m 0755 /opt/wisplab-cloud/releases "$cloud_release"
python3 "$cloud_source/download.py" --output "$cloud_release/bin"
# The installer uses umask 077; binaries contain no secrets and the service
# account must be able to traverse this otherwise root-owned directory.
chmod 0755 "$cloud_release/bin"
chmod 0644 "$cloud_release/bin/installed.json"
install -d -m 0755 "$cloud_release/pb_hooks" "$cloud_release/pb_migrations"
install -m 0644 "$cloud_source"/pb_hooks/*.js "$cloud_release/pb_hooks/"
install -m 0644 "$cloud_source"/pb_migrations/*.js "$cloud_release/pb_migrations/"
install -m 0644 "$cloud_source/pocketbase.lock.json" "$cloud_release/"
if ! id wisplab-cloud >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/wisplab-cloud --shell /usr/sbin/nologin wisplab-cloud
fi
install -d -m 0700 -o wisplab-cloud -g wisplab-cloud /var/lib/wisplab-cloud
install -d -m 0755 /etc/wisplab-cloud
if [[ ! -f /etc/wisplab-cloud/environment ]]; then
  install -m 0600 "$cloud_source/ubuntu/environment.example" /etc/wisplab-cloud/environment
fi
install -m 0644 "$cloud_source/ubuntu/wisplab-cloud.service" /etc/systemd/system/wisplab-cloud.service
# Default candidate is accounts-only; the future storage candidate is inactive.
# Activate exactly one reviewed snippet, never both.
install -m 0644 "$cloud_source/ubuntu/cloud.caddy" /etc/wisplab-cloud/cloud.caddy.candidate
install -m 0644 "$cloud_source/ubuntu/cloud-storage.caddy" /etc/wisplab-cloud/cloud-storage.caddy.candidate
ln -s "$cloud_release" /opt/wisplab-cloud/current.next
mv -Tf /opt/wisplab-cloud/current.next /opt/wisplab-cloud/current
echo "Installed: $cloud_release"
echo "No service or Caddy restart performed. Follow services/cloud/README.md to validate and activate."
