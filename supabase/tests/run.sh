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
for t in 08_tax 09_hr_payroll 10_logistics_oms 11_admin_reports 12_language_realtime 13_platform_licensing 14_migration_center 15_live_sync 16_loyalty 17_restaurant 18_history 19_automation 20_safe 21_review_fixes 22_agents 23_portal_api 24_purchase_invoice 25_documents 26_cards 27_packs_labels 28_year_end_tax 29_levelling_warehouses_advances 30_payroll_extras_promotions 31_fifo_reports_hotel 32_demo_market 33_mcp 34_push 35_expenses 36_bank_smarter 37_accountant 38_appointments 39_pricing_webhooks 40_negative_stock 41_margin_depreciation 42_zreport_assets 43_stamp_numbering 44_business_registry 45_partner_contacts 46_guard 47_books_check 48_review_fixes 49_easy_forms 50_platform_console 51_cash_forecast 52_instalments 53_security 54_fifo_order 55_stock_count_tools 56_customer_reminders 57_training 58_employment_contracts 59_tasks 60_tasks_auto 61_item_where 62_abc_xyz 63_scanner 64_market_controls 65_kpi_panel 66_buying_controls 67_store_checks_receiving 68_atk_sef 69_assistant_agent 70_assistant_memory 71_fuzzy_search 72_duplicate 73_debit_notes 74_reopen 75_my_exports 76_signatures 77_chat 78_staff_requests; do
  $PSQL -f "$DIR/$t.sql" | grep -A2 assertions_passed
done
