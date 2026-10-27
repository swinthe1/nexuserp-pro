-- =============================================================================
-- Features that had no button until now get one:
--   * the change history brings back a removed record (restore_record),
--   * replenishment makes work orders from "make" suggestions,
--   * a new appointment shows the free times of the day (appt_slots).
-- Only restore_record changes: clear messages, and only a removed record.
-- =============================================================================
create or replace function public.restore_record(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r app.table_registry; v_company uuid; v_deleted timestamptz;
begin
  select * into r from app.table_registry where table_name = p_table;
  if r.table_name is null or not r.soft_delete then raise exception 'This kind of record cannot be brought back' using errcode = '22023'; end if;
  execute format('select company_id, deleted_at from public.%I where id = $1', p_table) into v_company, v_deleted using p_id;
  if v_company is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, r.module || '.delete');
  if v_deleted is null then raise exception 'It is not removed; it is there already' using errcode = '55000'; end if;
  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', p_table) using p_id;
end $$;
