-- =============================================================================
-- DrisPRO · No age check at the till
--   The owner's choice: the till does not ask, keep or show the customer's age (no birth date)
--   for alcohol and tobacco. Everything the market controls added for it comes off again:
--   the "adults only" mark on products and categories, the company's choice and minimum age,
--   the age steps in the till's log and in the shift's controls.
--   Safe on a server that already ran 20261103000500 and on a fresh one.
-- =============================================================================

-- the company's choices: the two age settings are no longer read or saved
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'automation_settings_save';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, $x$, 'pos_close_witness', 'pos_age_check', 'pos_min_age'] then$x$, $x$, 'pos_close_witness'] then$x$);
  v_new := replace(v_new, $x$
    pos_age_check = coalesce((p_patch ->> 'pos_age_check')::boolean, pos_age_check),
    pos_min_age = coalesce((p_patch ->> 'pos_min_age')::smallint, pos_min_age),$x$, '');
  if position('pos_age_check' in v_new) > 0 or position('pos_min_age' in v_new) > 0 then
    raise exception 'automation_settings_save still mentions the age settings';
  end if;
  if v_new <> v_def then execute v_new; end if;
end $$;

-- what the till knows: no ages, no adults-only list
create or replace function public.pos_till_options(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid; cs record;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  if not app.has_permission(v_co, 'pos.read') then raise exception 'Permission denied: pos.read required' using errcode = '42501'; end if;
  select coalesce(s.pos_count_notes, true) as count_notes, coalesce(s.pos_void_approval, true) as void_approval,
         coalesce(s.pos_close_witness, 'difference') as close_witness, coalesce(s.pos_cash_tolerance, 0) as tolerance
    into cs from (select 1) one left join public.company_settings s on s.company_id = v_co;
  return jsonb_build_object('count_notes', cs.count_notes, 'void_approval', cs.void_approval, 'close_witness', cs.close_witness,
    'tolerance', cs.tolerance, 'managers', app.pos_managers(v_co));
end $$;

-- the till's log keeps voids only; an age step a till still sends is skipped
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pos_log';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, $x$('void_line', 'void_qty', 'void_sale', 'age_ok', 'age_refused')$x$, $x$('void_line', 'void_qty', 'void_sale')$x$);
  if position('age_' in v_new) > 0 then raise exception 'pos_log still takes age steps'; end if;
  if v_new <> v_def then execute v_new; end if;
end $$;

alter table public.pos_till_log disable trigger trg_02_immutable;
delete from public.pos_till_log where kind in ('age_ok', 'age_refused');
alter table public.pos_till_log enable trigger trg_02_immutable;
alter table public.pos_till_log drop constraint if exists pos_till_log_kind_check;
alter table public.pos_till_log add constraint pos_till_log_kind_check check (kind in ('void_line', 'void_qty', 'void_sale'));

-- the shift's controls and the Z report: the count and the voids
create or replace function public.pos_session_controls(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions; c public.pos_cash_counts;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  select * into c from public.pos_cash_counts where session_id = s.id;
  return jsonb_build_object(
    'count', case when c.id is not null then jsonb_build_object('notes_coins', c.notes_coins, 'counted', c.counted, 'difference', c.difference,
               'counted_by', app.person_name(c.counted_by), 'witnessed_by', app.person_name(c.witnessed_by)) end,
    'voids', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0),
                'unconfirmed', count(*) filter (where approved_by is null),
                'lines', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'description', description, 'quantity', quantity, 'amount', amount, 'at', at,
                           'cashier', app.person_name(cashier_id), 'approved_by', app.person_name(approved_by), 'offline', offline) order by at), '[]'::jsonb))
                from public.pos_till_log where session_id = s.id and kind like 'void%'));
end $$;

-- the marks and the settings themselves
drop function if exists app.adults_only_variants(uuid);
alter table public.products drop column if exists adults_only;
alter table public.product_categories drop column if exists adults_only;
alter table public.company_settings drop column if exists pos_age_check, drop column if exists pos_min_age;
