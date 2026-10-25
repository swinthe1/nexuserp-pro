#!/usr/bin/env bash
# Makes (or promotes) the platform administrator: the person who creates client companies and licences.
#
# Run on the VPS as root, from the project folder:
#   bash deploy/coolify/make-platform-admin.sh you@example.com 'YourPassword123' 'Your Name' [supabase-db-container]
#
# An existing account keeps its password and only gets the platform role.
set -euo pipefail
cd "$(dirname "$0")/../.."

email="${1:-}"; password="${2:-}"; name="${3:-}"; container="${4:-}"
if [ -z "$email" ] || [ -z "$password" ]; then
  echo "Usage: bash $0 EMAIL PASSWORD [\"FULL NAME\"] [supabase-db-container]" >&2; exit 1
fi
if [ ${#password} -lt 8 ]; then echo "The password needs at least 8 characters." >&2; exit 1; fi

if [ -z "$container" ]; then
  mapfile -t found < <(docker ps --format '{{.Names}}' | grep -E '^supabase-db' || true)
  if [ "${#found[@]}" -ne 1 ]; then
    echo "Name the database container as the 4th argument (docker ps | grep supabase-db):" >&2; printf '  %s\n' "${found[@]}" >&2; exit 1
  fi
  container="${found[0]}"
fi

pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"
docker exec -i -e PGPASSWORD="$pass" -e PGOPTIONS='-c client_min_messages=warning' "$container" \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A \
  -v email="$email" -v password="$password" -v name="$name" <<'SQL'
select app.create_auth_user(:'email', :'password', :'name') as uid \gset
update public.profiles set is_super_admin = true,
       full_name = coalesce(nullif(:'name', ''), full_name)
 where id = :'uid';
select 'Platform administrator: ' || email from public.profiles where id = :'uid';
SQL
echo "Sign in at your DrisPRO address; you land on Clients and licences."
