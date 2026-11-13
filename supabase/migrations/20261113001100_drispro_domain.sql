-- =============================================================================
-- DrisPRO moved to its own domain: the program at app.drispro.com, the API at api.drispro.com, the website at
-- drispro.com. The local servers' outside addresses are made under drispro.com (https://<name>.drispro.com);
-- the names the website and the program use are never given to a shop.
-- =============================================================================
create or replace function app.tunnel_slug(p_name text, p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text; v_base text; i int := 1;
  v_domain text := coalesce((select value from app.server_secrets where key = 'cf_domain'), 'drispro.com');
begin
  v_base := translate(lower(coalesce(p_name, '')), 'çëéèêáàâäãöóòôüúùûïíìîšžćčđñ', 'ceeeeaaaaaoooouuuuiiiiszccdn');
  v_base := regexp_replace(v_base, '\m(sh\.?p\.?k|l\.?l\.?c|d\.?o\.?o|sh\.?a|n\.?p\.?sh)\M\.?', '', 'g');
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  v_base := left(v_base, 36);
  v_base := trim(both '-' from v_base);
  if length(v_base) < 3 or v_base in ('erp', 'api', 'www', 'app', 'mail', 'admin', 'platform', 'status', 'demo', 'test', 'cdn', 'ftp', 'smtp', 'turn', 'pin', 'shop', 'blog', 'help', 'docs', 'download', 'downloads', 'updates', 'drispro') then
    v_base := 'drispro-' || left(replace(p_company::text, '-', ''), 6);
  end if;
  v := v_base || '.' || v_domain;
  while exists (select 1 from app.local_tunnels where hostname = v and company_id <> p_company) loop
    i := i + 1; v := v_base || '-' || i || '.' || v_domain;
  end loop;
  return v;
end $$;
revoke execute on function app.tunnel_slug(text, uuid) from public, anon, authenticated;
