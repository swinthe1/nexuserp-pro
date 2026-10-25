#!/usr/bin/env bash
# DrisPRO · run backup-database.sh every night at 02:30 (server time), keep 14 days.
#
#   bash deploy/coolify/install-backup.sh <db-container>
#
# Log: /var/log/nexuserp-backup.log · copies: /root/backups
# To stop it: rm /etc/cron.d/nexuserp-backup
set -euo pipefail
container="${1:?usage: install-backup.sh <db-container>}"
here="$(cd "$(dirname "$0")" && pwd)"
install -m 700 "$here/backup-database.sh" /usr/local/bin/nexuserp-backup
install -m 700 "$here/restore-database.sh" /usr/local/bin/nexuserp-restore
cat > /etc/cron.d/nexuserp-backup <<EOF
# DrisPRO nightly database copy
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root /usr/local/bin/nexuserp-backup $container /root/backups 14 >> /var/log/nexuserp-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/nexuserp-backup
echo "==> installed: every night at 02:30 into /root/backups (14 days kept)"
if [ -z "${NO_FIRST:-}" ]; then
  echo "==> making the first copy now"
  /usr/local/bin/nexuserp-backup "$container" /root/backups 14 manual
fi
