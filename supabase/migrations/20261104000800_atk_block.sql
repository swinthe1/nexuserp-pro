-- =============================================================================
-- DrisPRO · 20261104000800 · coupons from the fiscal receipt book (UA 01/2026, neni 45; Kërkesat, neni 25.16)
-- When the till is fully down, the shop writes receipts from its receipt book registered at ATK, then registers
-- each one in the SEF: the coupon carries the book's number and the time written on it.
-- =============================================================================
create or replace function app.atk_coupon_of(r public.pos_registers, f jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if f is null or jsonb_typeof(f) <> 'object' then return null; end if;
  if coalesce(f ->> 'env', '') not in ('test', 'production') or coalesce(f ->> 'coupon_id', '') !~ '^[0-9]{1,18}$'
     or coalesce(f ->> 'seq', '') !~ '^[0-9]{1,10}$' or coalesce(f ->> 'details', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'details') not between 8 and 60000
     or coalesce(f ->> 'signature', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'signature') not between 40 and 200 or coalesce(f ->> 'qr', '') !~ '^[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$' then
    raise exception 'The fiscal coupon of this sale is not complete' using errcode = '23514';
  end if;
  if (f ->> 'type') = '2' and length(btrim(coalesce(f ->> 'reason', ''))) < 3 then
    raise exception 'A cancellation coupon needs its reason' using errcode = '23514';
  end if;
  return jsonb_build_object('env', f ->> 'env', 'coupon_id', (f ->> 'coupon_id')::bigint, 'seq', (f ->> 'seq')::bigint, 'pos_id', (f ->> 'pos_id')::int,
    'branch_id', (f ->> 'branch_id')::int, 'verification_no', left(f ->> 'verification_no', 16), 'details', f ->> 'details', 'signature', f ->> 'signature',
    'qr', f ->> 'qr', 'type', (f ->> 'type')::int, 'reference_no', nullif(f ->> 'reference_no', '')::bigint,
    'total', (f ->> 'total')::bigint, 'tax', (f ->> 'tax')::bigint,
    'daily_no', nullif(f ->> 'daily_no', '')::int, 'reason', left(nullif(btrim(f ->> 'reason'), ''), 200), 'operator_no', left(f ->> 'operator_no', 30),
    -- a coupon written by hand from the fiscal receipt book while the till was down, registered afterwards
    'block_no', left(nullif(btrim(f ->> 'block_no'), ''), 30));
end $$;
