-- Serbian (Latin script) as a language of the profile: the till, the fiscal coupon and the ATK pages speak it
-- (Kosovo's fiscal software must work in both official languages). The rest of the app shows English for it.
alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('sq', 'en', 'sr'));
