-- =============================================================================
-- DrisPRO · 20261104000500 · ATK registers each till number once
-- ATK's /ca/verify answers 404 for a NUI + store + till that already took its certificate. A till that moves
-- to another device (or loses its storage) therefore needs a till number ATK has not seen yet. ATK knows the
-- business by its NUI, so two DrisPRO companies with one NUI (a shop and its test copy) share the numbers.
-- =============================================================================
create table if not exists app.atk_pos_used (
  nui         text not null,
  env         text not null check (env in ('test', 'production')),
  branch_id   int not null,
  pos_id      int not null,
  company_id  uuid references public.companies(id),
  register_id uuid,
  used_at     timestamptz not null default now(),
  primary key (nui, env, branch_id, pos_id)
);
revoke all on app.atk_pos_used from public, anon, authenticated;

-- what was registered before this table existed
insert into app.atk_pos_used (nui, env, branch_id, pos_id, company_id, register_id, used_at)
select distinct on (j.request ->> 'business_id', j.env, (j.request ->> 'branch_id')::int, (j.request ->> 'pos_id')::int)
       j.request ->> 'business_id', j.env, (j.request ->> 'branch_id')::int, (j.request ->> 'pos_id')::int, j.company_id, j.register_id, j.done_at
  from app.atk_jobs j where j.kind = 'signcsr' and j.status = 'done'
 order by j.request ->> 'business_id', j.env, (j.request ->> 'branch_id')::int, (j.request ->> 'pos_id')::int, j.done_at
on conflict do nothing;

/** a till number ATK has not seen in this store and environment */
create or replace function app.atk_used(p_company uuid, p_env text, p_branch int, p_pos int) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.atk_pos_used u join public.companies c on c.tax_number = u.nui
                  where c.id = p_company and u.env = p_env and u.branch_id = p_branch and u.pos_id = p_pos)
$$;
create or replace function app.atk_next_pos(p_company uuid, p_env text, p_branch int) returns int language sql stable security definer set search_path = '' as $$
  select min(n) from generate_series(1, 99) n
   where not app.atk_used(p_company, p_env, p_branch, n)
     and not exists (select 1 from public.pos_registers r join public.warehouses w on w.id = r.warehouse_id
                      where r.company_id = p_company and r.deleted_at is null and w.atk_branch_id = p_branch and r.atk_pos_id = n)
$$;

-- registering: refused before ATK is asked, with a free number to use
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.atk_onboard_verify(uuid)'::regprocedure);
  if position('atk_pos_used' in d) > 0 then return; end if;
  if position('  select * into w from public.warehouses where id = r.warehouse_id;' in d) = 0 then raise exception 'atk_onboard_verify: anchor not found'; end if;
  d := replace(d, '  select * into w from public.warehouses where id = r.warehouse_id;', '  select * into w from public.warehouses where id = r.warehouse_id;
  if app.atk_used(r.company_id, s.fiscal_environment, w.atk_branch_id, r.atk_pos_id) then
    raise exception ''ATK registers each till number once, and number % of this store is taken: give this till number %'',
      r.atk_pos_id, coalesce(app.atk_next_pos(r.company_id, s.fiscal_environment, w.atk_branch_id)::text, ''–'') using errcode = ''23505'';
  end if;');
  execute d;
end $patch$ language plpgsql;

-- remembering each number ATK has certified
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.atk_done(text,uuid,integer,jsonb,text,integer,jsonb)'::regprocedure);
  if position('atk_pos_used' in d) > 0 then return; end if;
  if position('       where id = j.register_id;' in d) = 0 then raise exception 'atk_done: anchor not found'; end if;
  d := replace(d, '       where id = j.register_id;', '       where id = j.register_id;
      insert into app.atk_pos_used (nui, env, branch_id, pos_id, company_id, register_id)
      values (j.request ->> ''business_id'', j.env, (j.request ->> ''branch_id'')::int, (j.request ->> ''pos_id'')::int, j.company_id, j.register_id) on conflict do nothing;');
  execute d;
end $patch$ language plpgsql;

-- the setup page: is this till's number taken at ATK, and which one is free
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.atk_setup(uuid)'::regprocedure);
  if position('atk_pos_used' in d) > 0 then return; end if;
  if position($a$'missing', app.atk_missing(r.id))$a$ in d) = 0 then raise exception 'atk_setup: anchor not found'; end if;
  d := replace(d, $a$'missing', app.atk_missing(r.id))$a$, $a$'missing', app.atk_missing(r.id),
      'taken', not (r.atk_certificate is not null and r.atk_cert_env = s.fiscal_environment)
               and coalesce((select app.atk_used(r.company_id, s.fiscal_environment, w2.atk_branch_id, r.atk_pos_id) from public.warehouses w2 where w2.id = r.warehouse_id), false),
      'next_free', (select app.atk_next_pos(r.company_id, s.fiscal_environment, w3.atk_branch_id) from public.warehouses w3 where w3.id = r.warehouse_id and w3.atk_branch_id is not null))$a$);
  execute d;
end $patch$ language plpgsql;
