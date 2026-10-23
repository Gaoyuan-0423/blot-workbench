#!/usr/bin/env bash
# Weekly consistent backup. Manual archives are never rotated by this script.
set -euo pipefail
umask 077
backup_dir=${WISPLAB_BACKUP_DIR:-/var/backups/wisplab-platform}
source_root=${WISPLAB_BACKUP_SOURCE_ROOT:-/}
lock_file=${WISPLAB_BACKUP_LOCK:-/run/lock/wisplab-backup.lock}
cleanup=${WISPLAB_BACKUP_CLEANUP:-/usr/local/sbin/wisplab-backup-cleanup.py}
mkdir -p -- "$backup_dir"
exec 9>"$lock_file"
flock -x 9
restart_needed=0
temporary=
health_check() {
  systemctl is-active --quiet wisplab-cloud || return 1
  for _ in {1..10}; do
    if curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'wisplab-backup: health check failed after restart' >&2
  return 1
}
finish() {
  local result=$?
  trap - EXIT
  if [[ "$restart_needed" == 1 ]]; then
    # Recover an originally running service, including after an archive failure.
    if ! systemctl start wisplab-cloud || ! health_check; then result=1; fi
  fi
  if [[ -n "$temporary" ]]; then rm -rf -- "$temporary" || result=1; fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Do not start a service which the operator deliberately stopped.
systemctl is-active --quiet wisplab-cloud
source_root=$(readlink -f -- "$source_root")
release=$(readlink -f -- "${source_root%/}/opt/wisplab-cloud/current")
case "$release" in
  "${source_root%/}"/opt/wisplab-cloud/releases/*) ;;
  *) echo 'wisplab-backup: current release is outside releases directory' >&2; exit 1 ;;
esac
[[ -d "$release" ]] || exit 1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
name="backup-${STAMP}.tar.gz"
[[ ! -e "$backup_dir/$name" && ! -e "$backup_dir/$name.sha256" ]] || exit 1
temporary=$(mktemp -d "$backup_dir/.incomplete-${STAMP}-XXXXXX")
restart_needed=1
systemctl stop wisplab-cloud
# Save the actual release as well as the symlink, without dereferencing data links.
tar -czf "$temporary/$name" -C "$source_root" \
  var/lib/wisplab-cloud/pb_data opt/wisplab-cloud/current \
  "${release#${source_root%/}/}" etc/wisplab-cloud/environment \
  etc/caddy/wisplab-cloud/cloud.caddy
systemctl start wisplab-cloud
health_check
restart_needed=0
(cd "$temporary" && sha256sum "$name" > "$name.sha256")
# Only complete archives participate in rotation.
mv -- "$temporary/$name.sha256" "$backup_dir/$name.sha256"
mv -- "$temporary/$name" "$backup_dir/$name"
python3 "$cleanup" --directory "$backup_dir" --lock-held
echo "$(date -u +%FT%TZ) backup ok: $backup_dir/$name"
