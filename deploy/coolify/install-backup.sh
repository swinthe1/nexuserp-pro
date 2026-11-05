#!/usr/bin/env bash
# DrisPRO · run backup-database.sh every night at 02:30 (server time), keep 14 days.
#
#   bash deploy/coolify/install-backup.sh <db-container>
#
# Log: /var/log/drispro-backup.log · copies: /root/backups
# To stop it: rm /etc/cron.d/drispro-backup
set -euo pipefail
container="${1:?usage: install-backup.sh <db-container>}"
here="$(cd "$(dirname "$0")" && pwd)"
install -m 700 "$here/backup-database.sh" /usr/local/bin/drispro-backup
install -m 700 "$here/restore-database.sh" /usr/local/bin/drispro-restore
install -m 700 "$here/offsite-copy.sh" /usr/local/bin/drispro-offsite
cat > /etc/cron.d/drispro-backup <<EOF
# DrisPRO nightly database copy
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root /usr/local/bin/drispro-backup $container /root/backups 14 >> /var/log/drispro-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/drispro-backup
echo "==> installed: every night at 02:30 into /root/backups (14 days kept)"
if [ -z "${NO_FIRST:-}" ]; then
  echo "==> making the first copy now"
  /usr/local/bin/drispro-backup "$container" /root/backups 14 manual
fi
