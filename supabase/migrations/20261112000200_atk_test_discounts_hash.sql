-- =============================================================================
-- DrisPRO · 20261112000200 · ATK's technical test of the SEF (invitation of 12 November 2026)
--
-- 1. A discount in euro on a till line, and a discount on the whole sale (in % or in euro), next to the
--    line discount in %: the till shares the sale's discount out over the lines, so every line carries its
--    own amount and VAT stays right by rate. The order keeps what was given on the whole sale.
-- 2. The printed coupon needs the shelf price and how each discount was given; ATK's coupon carries the
--    price with the discount in it. That is kept beside the coupon ("print"), for its copies.
-- 3. The SEF log as a chain: every row keeps its PayLoad, the hash of the row before it (Previous Hash)
--    and its own hash (Current Hash); a check walks the chain and says where it was touched (Integrity
--    Check). A sent coupon's row carries the payload ATK got and its signature.
-- =============================================================================

-- ----------------------------------------------------------------------------- 1. discounts in euro
do $$
declare v_def text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pos_order_lines' and column_name = 'discount_amount') then return; end if;
  -- the sales book reads the three worked-out columns: taken down and put back as it was
  select pg_get_viewdef('public.v_sales_book'::regclass, true) into v_def;
  drop view public.v_sales_book;
  alter table public.pos_order_lines drop column line_total, drop column line_subtotal, drop column tax_amount;
  alter table public.pos_order_lines add column discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0);
  alter table public.pos_order_lines
    add column line_total numeric(18,2) generated always as
      (round(quantity * unit_price * (1 - discount_pct / 100), 2) - sign(quantity) * discount_amount) stored,
    add column line_subtotal numeric(18,2) generated always as
      (round((round(quantity * unit_price * (1 - discount_pct / 100), 2) - sign(quantity) * discount_amount) / (1 + tax_rate / 100), 2)) stored,
    add column tax_amount numeric(18,2) generated always as
      ((round(quantity * unit_price * (1 - discount_pct / 100), 2) - sign(quantity) * discount_amount)
       - round((round(quantity * unit_price * (1 - discount_pct / 100), 2) - sign(quantity) * discount_amount) / (1 + tax_rate / 100), 2)) stored;
  execute 'create view public.v_sales_book with (security_invoker = true) as ' || v_def;
  revoke all on public.v_sales_book from public, anon;
  grant select on public.v_sales_book to authenticated;
end $$;
comment on column public.pos_order_lines.discount_amount is 'a discount in euro on the line (its own, plus its share of a discount on the whole sale), taken off after the discount in %';

alter table public.pos_orders add column if not exists sale_discount numeric(18,2) not null default 0 check (sale_discount >= 0);
alter table public.pos_orders add column if not exists sale_discount_pct numeric(5,2) check (sale_discount_pct between 0 and 100);
comment on column public.pos_orders.sale_discount is 'the discount given on the whole sale, in euro (it is inside the lines already); sale_discount_pct when it was given as a percentage';

-- the till's sale takes the amounts; a discount past the cashier's limit needs a manager, in euro as in %
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.pos_submit_order(jsonb)'::regprocedure) into d;
  if position('discount_amount' in d) > 0 then return; end if;
  n := replace(d, $a$    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$a$,
$a$    if not v_refund and coalesce(nullif(l->>'discount_amount', '')::numeric, 0) > 0 then
      if (l->>'discount_amount')::numeric > round((l->>'quantity')::numeric * (l->>'unit_price')::numeric * (1 - coalesce((l->>'discount_pct')::numeric, 0) / 100), 2) then
        raise exception 'Line %: the discount is more than the line itself', n using errcode = '23514';
      end if;
      if round((l->>'quantity')::numeric * (l->>'unit_price')::numeric, 2) > 0
         and 100 - 100 * (round((l->>'quantity')::numeric * (l->>'unit_price')::numeric * (1 - coalesce((l->>'discount_pct')::numeric, 0) / 100), 2) - (l->>'discount_amount')::numeric)
                       / round((l->>'quantity')::numeric * (l->>'unit_price')::numeric, 2) > greatest(v_max_disc, coalesce(v_allowed, 0)) + 0.01
         and not app.has_permission(s.company_id, 'pos.approve') then
        raise exception 'Discounts above % %% need a manager', v_max_disc using errcode = '42501';
      end if;
    end if;
    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$a$);
  if n = d then raise exception 'pos_submit_order: the discount check was not found'; end if;
  d := n;
  n := replace(d, $a$unit_price, discount_pct, tax_code_id, promotion_id)$a$, $a$unit_price, discount_pct, tax_code_id, promotion_id, discount_amount)$a$);
  if n = d then raise exception 'pos_submit_order: the line columns were not found'; end if;
  d := n;
  n := replace(d, $a$           nullif(l->>'promotion_id', '')::uuid
      from public.product_variants v$a$, $a$           nullif(l->>'promotion_id', '')::uuid,
           case when v_refund then 0 else greatest(round(coalesce(nullif(l->>'discount_amount', '')::numeric, 0), 2), 0) end
      from public.product_variants v$a$);
  if n = d then raise exception 'pos_submit_order: the line values were not found'; end if;
  d := n;
  n := replace(d, $a$  -- payments
  select total into v_total from public.pos_orders where id = v_id;$a$, $a$  -- what was given on the whole sale (it is in the lines already), kept for the receipt and the reports
  if not v_refund and coalesce(nullif(p->>'sale_discount', '')::numeric, 0) > 0 then
    update public.pos_orders set sale_discount = least(round((p->>'sale_discount')::numeric, 2), coalesce((select sum(ol.discount_amount) from public.pos_order_lines ol where ol.pos_order_id = v_id), 0)),
           sale_discount_pct = case when (p->>'sale_discount_pct') ~ '^[0-9]+(\.[0-9]+)?$' and (p->>'sale_discount_pct')::numeric between 0 and 100 then round((p->>'sale_discount_pct')::numeric, 2) end
     where id = v_id;
  end if;
  -- payments
  select total into v_total from public.pos_orders where id = v_id;$a$);
  if n = d then raise exception 'pos_submit_order: the place of the payments was not found'; end if;
  execute n;
end $$;

-- the watch over cashiers' discounts counts the euro ones too; a promotion's result as well
do $$
declare d text; n text;
begin
  select pg_get_functiondef('app.loss_watch_data'::regproc) into d;
  if position('l.discount_amount' in d) = 0 then
    n := replace(d, $a$coalesce(sum(round(l.quantity * l.unit_price * l.discount_pct / 100, 2)), 0) as amount$a$,
                    $a$coalesce(sum(round(l.quantity * l.unit_price * l.discount_pct / 100, 2) + l.discount_amount), 0) as amount$a$);
    n := replace(n, $a$l.promotion_id is null and l.discount_pct > 0$a$, $a$l.promotion_id is null and (l.discount_pct > 0 or l.discount_amount > 0)$a$);
    if n <> d then execute n; end if;
  end if;
  select pg_get_functiondef('public.promotion_results'::regproc) into d;
  if position('ol.line_total' in d) = 0 then
    n := replace(d, $a$sum(round(ol.quantity * ol.unit_price * (1 - ol.discount_pct / 100), 2)) sales$a$, $a$sum(ol.line_total) sales$a$);
    if n <> d then execute n; end if;
  end if;
end $$;

-- ----------------------------------------------------------------------------- 2. what the printed coupon needs
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
    'block_no', left(nullif(btrim(f ->> 'block_no'), ''), 30))
    -- the shelf prices and how the discounts were given, for the paper and its copies (ATK's coupon has the prices with the discount in them)
    || case when jsonb_typeof(f -> 'print') = 'object' and length((f -> 'print')::text) <= 40000 then jsonb_build_object('print', f -> 'print') else '{}'::jsonb end;
end $$;

-- ----------------------------------------------------------------------------- 3. the log as a chain
alter table public.atk_events add column if not exists payload text;
alter table public.atk_events add column if not exists prev_hash text;
alter table public.atk_events add column if not exists hash text;

-- the row as text, the same whoever reads it and in whatever time zone
create or replace function app.atk_event_payload(e public.atk_events) returns text language sql immutable set search_path = '' as $$
  select jsonb_build_object('company', e.company_id, 'till', e.register_id, 'kind', e.kind,
    'at', to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recorded_at', to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'user', e.user_id, 'coupon_no', e.coupon_no, 'amount', e.amount, 'details', e.details)::text
$$;
create or replace function app.atk_event_hash(p_prev text, p_payload text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_prev, '') || p_payload, 'UTF8')), 'hex')
$$;

create or replace function app.tg_atk_event_chain() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- one writer at a time for a company's chain
  perform pg_advisory_xact_lock(hashtextextended('atk_events:' || new.company_id::text, 0));
  new.recorded_at := coalesce(new.recorded_at, now());
  select e.hash into new.prev_hash from public.atk_events e where e.company_id = new.company_id order by e.id desc limit 1;
  new.payload := app.atk_event_payload(new);
  new.hash := app.atk_event_hash(new.prev_hash, new.payload);
  return new;
end $$;
drop trigger if exists trg_05_atk_event_chain on public.atk_events;
create trigger trg_05_atk_event_chain before insert on public.atk_events for each row execute function app.tg_atk_event_chain();

-- the rows kept before the chain existed join it, oldest first
do $$
declare r public.atk_events; v_prev text; v_co uuid;
begin
  if not exists (select 1 from public.atk_events where hash is null) then return; end if;
  perform set_config('app.allow_hard_delete', 'on', true);
  for r in select * from public.atk_events order by company_id, id loop
    if v_co is distinct from r.company_id then v_co := r.company_id; v_prev := null; end if;
    update public.atk_events set prev_hash = v_prev, payload = app.atk_event_payload(r), hash = app.atk_event_hash(v_prev, app.atk_event_payload(r)) where id = r.id;
    v_prev := app.atk_event_hash(v_prev, app.atk_event_payload(r));
  end loop;
  perform set_config('app.allow_hard_delete', 'off', true);
end $$;

-- a sent (or failed) coupon's row carries what ATK was sent and its signature
create or replace function app.tg_atk_event_send() returns trigger language plpgsql security definer set search_path = '' as $$
declare a jsonb := new.request_payload -> 'atk';
begin
  insert into public.atk_events (company_id, register_id, kind, at, user_id, coupon_no, amount, details)
  values (new.company_id, (select o.register_id from public.pos_orders o where o.id = new.source_doc_id),
          case when new.status = 'fiscalized' then 'sent' else 'failed' end, coalesce(new.last_attempt_at, now()), null,
          nullif(a ->> 'coupon_id', '')::bigint, round(nullif(a ->> 'total', '')::numeric / 100, 2),
          jsonb_strip_nulls(jsonb_build_object('env', a ->> 'env', 'attempt', new.attempt_count, 'transaction', new.fic,
                                               'error_code', new.error_code, 'error', new.error_message,
                                               'coupon_payload', a ->> 'details', 'signature', a ->> 'signature')));
  return new;
end $$;

-- Integrity Check: walks the chain; a row whose content, own hash or link to the row before it does not hold is named
create or replace function public.atk_log_verify(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.atk_events; v_prev text; v_n int := 0; v_bad bigint[] := '{}'; v_first timestamptz; v_last text;
begin
  if not app.atk_can(p_company, 'read') then raise exception 'You cannot see the SEF log' using errcode = '42501'; end if;
  for r in select * from public.atk_events where company_id = p_company order by id loop
    v_n := v_n + 1;
    if r.payload is distinct from app.atk_event_payload(r) or r.prev_hash is distinct from v_prev or r.hash is distinct from app.atk_event_hash(r.prev_hash, r.payload) then
      if cardinality(v_bad) < 500 then v_bad := v_bad || r.id; end if;
      v_first := coalesce(v_first, r.at);
    end if;
    v_prev := r.hash; v_last := r.hash;
  end loop;
  return jsonb_build_object('ok', cardinality(v_bad) = 0, 'rows', v_n, 'broken', to_jsonb(v_bad), 'first_broken_at', v_first, 'last_hash', v_last, 'checked_at', now());
end $$;
revoke execute on function public.atk_log_verify(uuid) from public, anon;
grant execute on function public.atk_log_verify(uuid) to authenticated;
