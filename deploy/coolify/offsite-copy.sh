#!/usr/bin/env bash
# DrisPRO · the night's database copy, also outside this server (encrypted)
#
#   bash deploy/coolify/offsite-copy.sh <dump-file>      (backup-database.sh calls it after each copy)
#
# A copy on the same server is lost with the server. This sends each night's copy, encrypted, to a
# storage of your choice through rclone (Cloudflare R2, Backblaze B2, Google Drive, an SFTP server…).
#
# Once, on the server, as root:
#   1. apt-get install -y rclone && rclone config        (you type the storage's keys yourself; name it e.g. "kopjet")
#   2. printf 'REMOTE=kopjet:drispro-backups\nKEEP_DAYS=60\n' > /root/.drispro-offsite && chmod 600 /root/.drispro-offsite
#   3. bash deploy/coolify/offsite-copy.sh --test          (makes the encryption key and sends a small test file)
# The encryption key is /root/.drispro-backup-key: keep a copy of it away from the server (e.g. a USB stick
# in the office). Without it the copies outside cannot be read back.
set -euo pipefail
conf=/root/.drispro-offsite
keyfile=/root/.drispro-backup-key
[ -f "$conf" ] || { echo "==> no copy outside the server: $conf is not set up (see the top of this file)"; exit 0; }
# shellcheck disable=SC1090
. "$conf"
: "${REMOTE:?REMOTE is missing in $conf}"
KEEP_DAYS="${KEEP_DAYS:-60}"
command -v rclone >/dev/null || { echo "!! rclone is not installed (apt-get install -y rclone)" >&2; exit 1; }

if [ ! -s "$keyfile" ]; then
  umask 077
  openssl rand -hex 32 > "$keyfile"
  echo "==> made the encryption key $keyfile: keep a copy of it away from this server"
fi

send() { # file name
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  # the key through the environment, never on the command line
  DRISPRO_KEY="$(cat "$keyfile")" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:DRISPRO_KEY -in "$1" -out "$tmp/$2.enc"
  rclone copyto --retries 5 --low-level-retries 10 "$tmp/$2.enc" "$REMOTE/$2.enc"
  echo "==> sent $2.enc to $REMOTE ($(numfmt --to=iec "$(stat -c %s "$tmp/$2.enc")"))"
}

if [ "${1:-}" = "--test" ]; then
  t="$(mktemp)"; date > "$t"; send "$t" "test-$(date +%Y%m%d%H%M)"; rm -f "$t"
  echo "==> the storage works; the next night's copy goes there too"
  exit 0
fi

dump="${1:?usage: offsite-copy.sh <dump-file> | --test}"
send "$dump" "$(basename "$dump")"
rclone delete --min-age "${KEEP_DAYS}d" --include 'drispro-*.dump.enc' "$REMOTE" || true
echo "==> copies outside older than $KEEP_DAYS days removed"

# to read one back:  rclone copyto "$REMOTE/<name>.enc" ./x.enc
#   DRISPRO_KEY="$(cat /root/.drispro-backup-key)" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:DRISPRO_KEY -in x.enc -out x.dump
