-- =============================================================================
-- DrisPRO · the file exported last, sent by email
--   From the top bar the person sends one of her own exports (Excel, CSV or PDF) as an attachment from
--   the company mailbox. Only her own exports; the message is kept in the outbox like every other one.
-- =============================================================================

create or replace function public.export_email(p_export uuid, p_to text, p_subject text, p_message text, p_data text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.my_exports; v_id uuid;
begin
  select * into e from public.my_exports where id = p_export and user_id = auth.uid();
  if e.id is null or not (e.company_id = any (app.my_company_ids())) then raise exception 'Export not found' using errcode = 'P0002'; end if;
  if coalesce(btrim(p_to), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Write a valid email address' using errcode = '22023'; end if;
  if not exists (select 1 from app.mail_accounts where company_id = e.company_id and is_active) then
    raise exception 'Set up the company mailbox first (Automations › Email)' using errcode = '55000';
  end if;
  if p_data is null or length(p_data) > 8000000 then raise exception 'The file is missing or too large to send by email' using errcode = '22023'; end if;
  v_id := app.enqueue_message(e.company_id, 'email', btrim(p_to), left(coalesce(nullif(btrim(p_subject), ''), e.file_name), 300),
            coalesce(p_message, ''), null, 'document', null, null, 'my_export', e.id);
  update app.message_outbox set attachments = jsonb_build_array(jsonb_build_object('name', e.file_name,
           'mime', case e.kind when 'pdf' then 'application/pdf' when 'csv' then 'text/csv'
                               else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' end, 'data', p_data))
   where id = v_id;
  return v_id;
end $$;
revoke execute on function public.export_email(uuid, text, text, text, text) from public, anon;
grant execute on function public.export_email(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
