#!/usr/bin/env bash
# DrisPRO Box: the state of this server in one look (sudo drispro-status)
dir=/opt/nexuserp
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
echo "DrisPRO  $(cat $dir/VERSION 2>/dev/null)  ·  $(hostname).local  ·  $(hostname -I | awk '{print $1}')"
echo
echo "Services"
for s in nexus-db nexus-auth nexus-rest nexus-realtime nexus-storage nexus-web; do
  c="$(docker ps --format '{{.Names}} {{.Status}}' | grep -E "(^|\.)$s " | head -1)"
  if [ -n "$c" ]; then ok "$c"; else bad "$s is not running (sudo bash $dir/install.sh starts it again)"; fi
done
echo
echo "Copies"
last="$(ls -1t /root/backups/*.dump 2>/dev/null | head -1)"
if [ -n "$last" ]; then
  age=$(( ( $(date +%s) - $(stat -c %Y "$last") ) / 3600 ))
  [ "$age" -lt 30 ] && ok "on this server: $(basename "$last") ($age h ago)" || bad "on this server: the last is $age h old ($(basename "$last"))"
else bad "on this server: no copy yet"; fi
cl="$(grep 'sent .* to the cloud' /var/log/nexuserp-cloud-backup.log 2>/dev/null | tail -1)"
[ -n "$cl" ] && ok "in the cloud: ${cl%% sent*}" || bad "in the cloud: no copy sent yet (needs internet at 04:00)"
echo
echo "Licence"
ll="$(tail -1 /var/log/nexuserp-licence.log 2>/dev/null)"; [ -n "$ll" ] && echo "  $ll" || echo "  checked at the install; next check 03:45"
echo
echo "Disk"
df -h / | awk 'NR==2 {print "  used " $3 " of " $2 " (" $5 ")"}'
ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && ok "internet" || bad "no internet (DrisPRO keeps working in the shop)"
