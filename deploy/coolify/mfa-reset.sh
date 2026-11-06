#!/usr/bin/env bash
# Removes someone's two-step verification (a phone lost). After it, their password alone signs in again,
# and the app asks them to set it up anew (administrators at once). The platform owner can also do it from
# the platform console while signed in with their own code; this is for when that is not possible (the
# platform owner's own phone lost).
#
# Run on the VPS as root, from the project folder:
#   bash deploy/coolify/mfa-reset.sh someone@example.com [supabase-db-container]
set -euo pipefail
email="${1:-}"; container="${2:-}"
[ -n "$email" ] || { echo "Usage: bash $0 EMAIL [supabase-db-container]" >&2; exit 1; }
if [ -z "$container" ]; then
  mapfile -t found < <(docker ps --format '{{.Names}}' | grep -E '^supabase-db' || true)
  if [ "${#found[@]}" -ne 1 ]; then
    echo "Name the database container as the 2nd argument (docker ps | grep supabase-db):" >&2; printf '  %s\n' "${found[@]}" >&2; exit 1
  fi
  container="${found[0]}"
fi
pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"
# the sign-in service's own tables belong to its administrator role
n=$(docker exec -i -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -t -A -v email="$email" <<'SQL'
with u as (select id from auth.users where lower(email) = lower(:'email')),
     d as (delete from auth.mfa_factors where user_id in (select id from u) returning 1)
select (select count(*) from u) || ' ' || (select count(*) from d);
SQL
)
read -r users factors <<<"$n"
[ "$users" = "1" ] || { echo "!! no user $email" >&2; exit 1; }
echo "==> $email: $factors second factor(s) removed. The password alone signs in now; set it up again from the app."
