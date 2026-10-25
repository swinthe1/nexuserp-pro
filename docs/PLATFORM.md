# Clients and licences (platform administrator)

DrisPRO is run by one platform administrator (you, the provider). Clients cannot create companies or open accounts on their own.

## Who can do what

| Person | Can |
|---|---|
| Platform administrator (`profiles.is_super_admin`) | Create client companies with their admin and licence, change or pause licences, set a new password for anyone, open any client's company for support, switch open sign-up on or off |
| Client admin (role *Company admin*) | Everything inside their own company, including inviting staff up to the licence's user limit |
| Invited staff | Sign up with the invited email (or get an account from the platform administrator) and work with the roles they were given |
| Anyone else | Nothing: sign-up is refused unless the email holds an invitation |

## First time on a server

```bash
cd /root/drispro
bash deploy/coolify/setup-database.sh supabase-db-xxxx         # applies the new migration
bash deploy/coolify/make-platform-admin.sh you@example.com 'StrongPassword1' 'Your Name' supabase-db-xxxx
```

Sign in with that email. You land on **Clients and licences** (`/platform`).

## Adding a client

1. **New client**: trading name, legal name, country (Kosovo by default: euro, VAT 18%), NUI/NIPT.
2. Administrator of the client: name, email and a password (one is generated).
3. Licence: plan (Basic, Standard, Pro), maximum users, valid from and until (+1 month, +6 months, +1 year), internal notes only you see.
4. **Create client** shows the sign-in details to send to the client. The password is shown only once.

The company gets its main warehouse, VAT codes, units and financial year straight away.

## Licences

- One licence per company. People count towards the limit when active or invited; the platform administrator does not.
- Before *valid from*, after *valid until*, or while **paused**, the client's people see "access stopped" with the reason. Nothing is deleted; renewing gives access back at once.
- From 14 days before the end, the client's admins see a banner with the end date.
- Existing companies received a one-year Standard licence when the migration ran.

## Sign-up

- Sign-up through the app is accepted only for emails that hold an invitation (checked in the database, `app.tg_signup_gate`).
- **Open sign-up** on the platform page lets anyone register and create a company with a 30-day trial (10 users). Keep it off for the provider model.
- There is no email service on the server, so set `ENABLE_EMAIL_AUTOCONFIRM=true` in the Supabase service for invited staff to sign up, or create their accounts for them.

## Database pieces

`supabase/migrations/20261026002100_platform_licensing.sql`: `licenses`, `platform_settings`, `platform_create_client`, `platform_save_license`, `platform_set_password`, `platform_set_self_service`, `platform_clients`; access follows the licence in `app.my_company_ids`, `app.company_ids_with` and `app.has_role`. Tests: `supabase/tests/13_platform_licensing.sql`.
