-- =============================================================================
-- DrisPRO · "Eksportet e mia": every Excel, CSV and PDF a person exports from a list, kept for them
-- The browser saves the file in its own downloads folder (a web page cannot know or open that folder),
-- so DrisPRO keeps a copy of each export for the person who made it: the file, the page it came from,
-- how many rows, when. "Download again" gives the same file back on any computer; they keep 90 days.
-- =============================================================================

create table if not exists public.my_exports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  file_name   text not null check (length(file_name) between 1 and 200),
  kind        text not null check (kind in ('xlsx', 'csv', 'pdf')),
  page        text check (length(page) <= 300),
  page_title  text check (length(page_title) <= 200),
  row_count   integer,
  size_bytes  integer,
  path        text not null check (length(path) <= 400),
  created_at  timestamptz not null default now()
);
create index if not exists my_exports_user_idx on public.my_exports (company_id, user_id, created_at desc);
alter table public.my_exports enable row level security;
revoke all on public.my_exports from anon;
grant select, insert, delete on public.my_exports to authenticated;
drop policy if exists my_exports_own on public.my_exports;
create policy my_exports_own on public.my_exports for all to authenticated
  using (user_id = auth.uid() and company_id = any ((select app.my_company_ids())::uuid[]))
  with check (user_id = auth.uid() and company_id = any ((select app.my_company_ids())::uuid[])
              and path like company_id::text || '/' || auth.uid()::text || '/%');

-- the list keeps 90 days and at most 200 per person
create or replace function app.tg_my_exports_trim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.my_exports where user_id = new.user_id and company_id = new.company_id
     and (created_at < now() - interval '90 days'
          or id in (select id from public.my_exports where user_id = new.user_id and company_id = new.company_id order by created_at desc offset 200));
  return null;
end $$;
drop trigger if exists trg_my_exports_trim on public.my_exports;
create trigger trg_my_exports_trim after insert on public.my_exports for each row execute function app.tg_my_exports_trim();

-- the files: a private folder per company and person
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('my-exports', 'my-exports', false) on conflict (id) do nothing;
  execute 'drop policy if exists "my exports: read" on storage.objects';
  execute 'drop policy if exists "my exports: upload" on storage.objects';
  execute 'drop policy if exists "my exports: remove" on storage.objects';
  execute $p$create policy "my exports: read" on storage.objects for select to authenticated
    using (bucket_id = 'my-exports' and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[]) and (storage.foldername(name))[2] = auth.uid()::text)$p$;
  execute $p$create policy "my exports: upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'my-exports' and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[]) and (storage.foldername(name))[2] = auth.uid()::text)$p$;
  execute $p$create policy "my exports: remove" on storage.objects for delete to authenticated
    using (bucket_id = 'my-exports' and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[]) and (storage.foldername(name))[2] = auth.uid()::text)$p$;
end $$;
