-- =============================================================================
-- Training: each person marks the lessons they finished; the owner sees who is trained
-- (the lessons themselves live in the program, by role)
-- =============================================================================

create table if not exists public.training_progress (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson     text not null check (length(lesson) between 1 and 80),
  done_at    timestamptz not null default now(),
  primary key (company_id, user_id, lesson)
);
alter table public.training_progress enable row level security;
drop policy if exists training_own on public.training_progress;
create policy training_own on public.training_progress for select to authenticated
  using (user_id = auth.uid() or company_id = any (app.company_ids_with('admin.read')));
revoke all on public.training_progress from anon;
grant select on public.training_progress to authenticated;

-- mark a lesson done (or not done)
create or replace function public.training_mark(p_company uuid, p_lesson text, p_done boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null)
     and not app.is_super_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  if p_done then
    insert into public.training_progress (company_id, user_id, lesson) values (p_company, auth.uid(), left(btrim(p_lesson), 80))
    on conflict (company_id, user_id, lesson) do update set done_at = now();
  else
    delete from public.training_progress where company_id = p_company and user_id = auth.uid() and lesson = p_lesson;
  end if;
end $$;

-- for the owner: the lessons each person finished
create or replace function public.training_overview(p_company uuid)
returns table (user_id uuid, lessons text[], last_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return query
  select tp.user_id, array_agg(tp.lesson order by tp.done_at), max(tp.done_at)
    from public.training_progress tp where tp.company_id = p_company group by tp.user_id;
end $$;

revoke execute on function public.training_mark(uuid, text, boolean), public.training_overview(uuid) from public, anon;
grant execute on function public.training_mark(uuid, text, boolean), public.training_overview(uuid) to authenticated;
