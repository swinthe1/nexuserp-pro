-- =============================================================================
-- DrisPRO · a refund finds the sale from what is printed on the fiscal coupon (9.11.2026)
--   ATK's coupon number, the NUIKF, or the QR code read by a scanner; without these indexes a market with
--   years of coupons would read them all for each refund.
-- =============================================================================
create index if not exists pos_orders_atk_coupon_idx on public.pos_orders (company_id, ((atk ->> 'coupon_id'))) where atk is not null;
create index if not exists pos_orders_atk_nuikf_idx on public.pos_orders (company_id, ((atk ->> 'verification_no'))) where atk is not null;
create index if not exists pos_orders_atk_qr_idx on public.pos_orders using hash ((atk ->> 'qr')) where atk is not null;
