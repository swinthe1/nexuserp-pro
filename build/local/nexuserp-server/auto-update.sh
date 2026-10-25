#!/usr/bin/env bash
# Every night (after the copy and the licence check): when DrisPRO has published a newer version,
# it is downloaded, checked (sha256) and installed with update.sh. The database is copied first.
# Turn it off with AUTO_UPDATE=false in .env.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
set -a; . ./.env; set +a
[ "${AUTO_UPDATE:-true}" = "true" ] || { echo "$(date '+%F %T') automatic updates are off"; exit 0; }
src="${UPDATE_SERVER:-https://erp.dris-ks.com}/updates"
latest="$(curl -fsS --max-time 30 "$src/latest.json")" || { echo "$(date '+%F %T') no connection to $src: no update"; exit 0; }
ver="$(printf '%s' "$latest" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
file="$(printf '%s' "$latest" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')"
sum="$(printf '%s' "$latest" | sed -n 's/.*"sha256":"\([^"]*\)".*/\1/p')"
have="$(cat VERSION 2>/dev/null || echo 0)"
[ -n "$ver" ] && [ -n "$file" ] || { echo "$(date '+%F %T') latest.json not readable"; exit 1; }
# versions are dates (2026.10.25.1910): a plain comparison is enough
if [ "$(printf '%s\n%s\n' "$have" "$ver" | sort -V | tail -1)" = "$have" ]; then echo "$(date '+%F %T') up to date ($have)"; exit 0; fi
echo "$(date '+%F %T') new version $ver (this server has $have)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsS --max-time 600 -o "$tmp/$file" "$src/$file"
echo "$sum  $tmp/$file" | sha256sum -c --quiet - || { echo "$(date '+%F %T') the download is damaged; not installed"; exit 1; }
tar xzf "$tmp/$file" -C "$tmp"
bash "$tmp/nexuserp-server/update.sh" "$here"
echo "$(date '+%F %T') updated to $ver"
