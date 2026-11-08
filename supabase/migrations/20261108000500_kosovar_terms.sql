-- =============================================================================
-- DrisPRO · Kosovar terms: no "dyqan" in what the program writes (the owner's request)
--   The ready-made check lists say "market", for new lists and for the ones already made from them.
-- =============================================================================
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
select app._patch_function('public.store_checklists_defaults', '"name": "Hapja e dyqanit"', '"name": "Hapja e marketit"');
select app._patch_function('public.store_checklists_defaults', '"name": "Mbyllja e dyqanit"', '"name": "Mbyllja e marketit"');
drop function app._patch_function(text, text, text);

update public.store_checklists set name = 'Hapja e marketit' where name = 'Hapja e dyqanit';
update public.store_checklists set name = 'Mbyllja e marketit' where name = 'Mbyllja e dyqanit';
