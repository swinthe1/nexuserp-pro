-- =============================================================================
-- DrisPRO · categories and sub-categories: the rules kept by the database (11.11.2026)
--   · two levels: a main category and its sub-categories; a main category has as many sub-categories as it needs
--   · a sub-category sits under a main category (never under another sub-category, never under itself)
--   · a main category that has sub-categories cannot itself become a sub-category
--   · no two with the same name in the same place (two main categories, or two sub-categories of one main category)
--   · a main category deleted: its sub-categories become main categories (as the page already says)
-- =============================================================================

-- what is there already is put right first: a parent that was deleted, and a third level brought up to the second
update public.product_categories c set parent_id = null
 where c.parent_id is not null
   and not exists (select 1 from public.product_categories p where p.id = c.parent_id and p.deleted_at is null);
update public.product_categories c set parent_id = p.parent_id
  from public.product_categories p
 where p.id = c.parent_id and p.parent_id is not null and p.parent_id <> c.id;

create or replace function app.tg_category_levels()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.deleted_at is not null then return new; end if;
  new.name := btrim(new.name);
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if new.parent_id = new.id then
      raise exception 'A category cannot be its own sub-category' using errcode = '23514';
    end if;
    if exists (select 1 from public.product_categories p where p.id = new.parent_id and (p.parent_id is not null or p.deleted_at is not null)) then
      raise exception 'A sub-category goes under a main category, not under another sub-category' using errcode = '23514';
    end if;
    if exists (select 1 from public.product_categories k where k.parent_id = new.id and k.deleted_at is null) then
      raise exception 'This category has sub-categories of its own: move them first' using errcode = '23514';
    end if;
  end if;
  -- set free by its main category being deleted: it stays even if a main category has its name
  if coalesce(current_setting('app.category_release', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name or new.parent_id is distinct from old.parent_id or old.deleted_at is not null then
    if exists (select 1 from public.product_categories o
                where o.company_id = new.company_id and o.id <> new.id and o.deleted_at is null
                  and o.parent_id is not distinct from new.parent_id and lower(btrim(o.name)) = lower(new.name)) then
      if new.parent_id is null then
        raise exception 'There is already a category with this name' using errcode = '23505';
      end if;
      raise exception 'This category already has a sub-category with this name' using errcode = '23505';
    end if;
  end if;
  return new;
end
$function$;
revoke all on function app.tg_category_levels() from public, anon, authenticated;
drop trigger if exists trg_10_category_levels on public.product_categories;
create trigger trg_10_category_levels before insert or update of name, parent_id, deleted_at on public.product_categories
  for each row execute function app.tg_category_levels();

-- a main category deleted: its sub-categories stay, as main categories
create or replace function app.tg_category_release()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' or (new.deleted_at is not null and old.deleted_at is null) then
    perform set_config('app.category_release', 'on', true);
    update public.product_categories k set parent_id = null where k.parent_id = old.id;
    perform set_config('app.category_release', '', true);
  end if;
  return null;
end
$function$;
revoke all on function app.tg_category_release() from public, anon, authenticated;
drop trigger if exists trg_90_category_release on public.product_categories;
create trigger trg_90_category_release after update of deleted_at on public.product_categories
  for each row execute function app.tg_category_release();
