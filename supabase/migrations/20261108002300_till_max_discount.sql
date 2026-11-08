-- =============================================================================
-- DrisPRO · each till has its own discount limit for the cashier (audit, wave 2)
--   Above it a manager must approve (pos.approve). It was 10% for every company.
-- =============================================================================
alter table public.pos_registers add column if not exists max_discount_pct numeric(5,2) not null default 10
  check (max_discount_pct between 0 and 100);
comment on column public.pos_registers.max_discount_pct is 'the largest line discount a cashier gives without a manager';
