-- =============================================================================
-- DrisPRO · a corrective VAT declaration for a month already filed (audit, wave 1)
--   An invoice that comes late for a month already declared had nowhere to go. Now:
--     1. "Corrective declaration" on the filed one opens a correction draft for that month;
--     2. while it is open, documents dated in that month can be posted again;
--     3. the correction is recalculated from the books and shows the difference with what was filed;
--     4. submitting it books only the difference (output and input VAT into the settlement account),
--        and closes the month again. The original stays as it was filed.
-- =============================================================================
alter table public.vat_declarations add column if not exists corrects_id uuid references public.vat_declarations(id) deferrable initially immediate;
comment on column public.vat_declarations.corrects_id is 'A corrective declaration: the declaration of the same month it corrects';

-- one declaration per month, plus its corrections (only one open at a time)
alter table public.vat_declarations drop constraint if exists vat_declarations_no_overlap;
alter table public.vat_declarations add constraint vat_declarations_no_overlap
  exclude using gist (company_id with =, daterange(period_start, period_end, '[]') with &&)
  where (deleted_at is null and status <> 'rejected' and corrects_id is null);
create unique index if not exists vat_declarations_one_open_correction on public.vat_declarations (company_id, period_start)
  where corrects_id is not null and status = 'draft' and deleted_at is null;

-- what was filed last for a month: the original or its latest correction
create or replace function app.vat_last_filed(p_original uuid, p_except uuid default null)
returns public.vat_declarations language sql stable security definer set search_path = '' as $$
  select d.* from public.vat_declarations d
   where (d.id = p_original or d.corrects_id = p_original) and d.id is distinct from p_except
     and d.deleted_at is null and d.status in ('submitted', 'accepted')
   order by d.submitted_at desc nulls last limit 1
$$;

create or replace function public.create_vat_correction(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations; v_orig uuid; v_new uuid;
begin
  select * into d from public.vat_declarations where id = p_id and deleted_at is null;
  if d.id is null then raise exception 'Declaration not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'tax.write');
  if d.status not in ('submitted', 'accepted') then raise exception 'Only a declaration that was filed can be corrected' using errcode = '55000'; end if;
  v_orig := coalesce(d.corrects_id, d.id);
  select id into v_new from public.vat_declarations
   where corrects_id = v_orig and status = 'draft' and deleted_at is null;
  if v_new is not null then return v_new; end if;   -- the open correction
  insert into public.vat_declarations (company_id, country_code, period_start, period_end, status, credit_brought_forward, corrects_id)
  values (d.company_id, d.country_code, d.period_start, d.period_end, 'draft', d.credit_brought_forward, v_orig)
  returning id into v_new;
  perform app.vat_apply_preview(v_new);
  return v_new;
end $$;
revoke all on function public.create_vat_correction(uuid) from public, anon;
grant execute on function public.create_vat_correction(uuid) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- while a correction is open, the month takes documents again
select app._patch_function('app.tg_vat_period_lock',
  $x$     and v_date between d.period_start and d.period_end;$x$,
  $x$     and v_date between d.period_start and d.period_end
     and not exists (select 1 from public.vat_declarations c where c.company_id = d.company_id and c.corrects_id is not null
                       and c.status = 'draft' and c.deleted_at is null and c.period_start = d.period_start);$x$);

-- an open correction of an earlier month does not hold up the next month
select app._patch_function('public.submit_vat_declaration',
  $x$  if exists (select 1 from public.vat_declarations where company_id = d.company_id and deleted_at is null and status = 'draft'
               and period_end < d.period_start) then$x$,
  $x$  if exists (select 1 from public.vat_declarations where company_id = d.company_id and deleted_at is null and status = 'draft'
               and period_end < d.period_start and corrects_id is null) then$x$);

-- a correction books only the difference with what was filed last
select app._patch_function('public.submit_vat_declaration',
  $x$  -- settlement: output and input VAT of the period move to the settlement account$x$,
  $x$  if d.corrects_id is not null then
    declare o public.vat_declarations; v_out numeric; v_in numeric;
    begin
      o := app.vat_last_filed(d.corrects_id, d.id);
      v_out := d.output_vat - coalesce(o.output_vat, 0);
      v_in := d.input_vat - coalesce(o.input_vat, 0);
      if v_out <> 0 or v_in <> 0 then
        v_je := app.gl_post(d.company_id, 'GEN', d.period_end, 'vat_declaration', d.id, d.number,
          'Corrective VAT declaration ' || to_char(d.period_start, 'MM/YYYY'), jsonb_build_array(
            jsonb_build_object('account_id', app.acct(d.company_id, 'vat_output'), 'amount', v_out, 'description', 'Output VAT, correction ' || to_char(d.period_start, 'MM/YYYY')),
            jsonb_build_object('account_id', app.acct(d.company_id, 'vat_input'), 'amount', -v_in, 'description', 'Input VAT, correction ' || to_char(d.period_start, 'MM/YYYY')),
            jsonb_build_object('account_id', app.acct(d.company_id, 'vat_settlement'), 'amount', -(v_out - v_in), 'description', 'VAT difference ' || to_char(d.period_start, 'MM/YYYY'))),
          'settlement');
      end if;
      update public.vat_declarations set status = 'submitted', submitted_at = now(), submission_reference = nullif(btrim(p_reference), ''), journal_entry_id = v_je
       where id = p_id;
      return jsonb_build_object('payable', d.payable, 'difference', v_out - v_in, 'output_difference', v_out, 'input_difference', v_in, 'journal_entry_id', v_je);
    end;
  end if;
  -- settlement: output and input VAT of the period move to the settlement account$x$);
drop function app._patch_function(text, text, text);
