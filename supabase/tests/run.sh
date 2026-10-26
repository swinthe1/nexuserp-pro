#!/usr/bin/env bash
# Runs the schema test suite against a throwaway PLAIN Postgres 15+ database.
# (Against a Supabase project use `supabase db reset` and then run only
#  the 01–11 test files — the stub is for vanilla Postgres.)
#
#   DATABASE_URL=postgres://postgres@localhost:5432/drispro_test ./supabase/tests/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${DATABASE_URL:?set DATABASE_URL to an EMPTY test database}"
PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=1 -q"

$PSQL -f "$DIR/00_supabase_stub.sql" >/dev/null
for f in "$DIR"/../migrations/*.sql; do
  echo "applying $(basename "$f")"
  $PSQL -1 -o /dev/null -f "$f"
done
$PSQL -f "$DIR/01_rls_and_invariants.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/02_inventory_engine.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/03_sales_flow.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/04_procurement.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/05_finance.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/06_wms_pos.sql" | grep -A2 assertions_passed
$PSQL -f "$DIR/07_manufacturing.sql" | grep -A2 assertions_passed
for t in 08_tax 09_hr_payroll 10_logistics_oms 11_admin_reports 12_language_realtime 13_platform_licensing 14_migration_center 15_live_sync 16_loyalty 17_restaurant 18_history 19_automation 20_safe; do
  $PSQL -f "$DIR/$t.sql" | grep -A2 assertions_passed
done
