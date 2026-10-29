#!/usr/bin/env bash
# DrisPRO · the VPS reports its CPU, memory, disks, containers and log errors to the
# platform console every minute.
#
#   bash deploy/coolify/install-monitor.sh <db-container>
#
# Log: /var/log/drispro-monitor.log · to stop it: rm /etc/cron.d/drispro-monitor
set -euo pipefail
container="${1:?usage: install-monitor.sh <db-container>}"
here="$(cd "$(dirname "$0")" && pwd)"
command -v python3 >/dev/null || { echo "!! python3 is missing: apt-get install -y python3" >&2; exit 1; }
install -m 700 "$here/server-monitor.py" /usr/local/bin/drispro-monitor
cat > /etc/cron.d/drispro-monitor <<EOF
# DrisPRO: the server reports to the platform console every minute
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root timeout 55 /usr/bin/python3 /usr/local/bin/drispro-monitor $container >> /var/log/drispro-monitor.log 2>&1
EOF
chmod 644 /etc/cron.d/drispro-monitor
# the log of the monitor itself stays small
cat > /etc/logrotate.d/drispro-monitor <<'EOF'
/var/log/drispro-monitor.log { weekly rotate 2 compress missingok notifempty }
EOF
/usr/bin/python3 /usr/local/bin/drispro-monitor "$container" && echo "    server monitor: reporting every minute"
