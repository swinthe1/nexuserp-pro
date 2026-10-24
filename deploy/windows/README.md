# NexusERP Pro on your Windows computer

Everything runs on this computer: the database, sign-in, the API and live updates run in Docker (the local Supabase stack), and the app is served by Node.js. Nothing is sent to the internet except downloading the tools the first time.

## What you need (once)

| | Why | Get it |
|---|---|---|
| **Docker Desktop** with the WSL 2 backend | runs the database and Supabase services | https://www.docker.com/products/docker-desktop/ — install, restart if asked, open it and wait for "Engine running" |
| **Node.js 20 LTS or newer** | builds and serves the app; also runs the Supabase command line | https://nodejs.org |
| About 8 GB of free RAM and 6 GB of disk | Docker images (2–3 GB) and the build | |
| Free ports | 54321–54324 (Supabase), 4173 (the app) | |

## Start it

1. Unzip `nexuserp-pro-phase9.zip` (or run `Install-NexusERP.ps1` next to it, which unzips and starts everything).
2. Open **PowerShell** in the `nexuserp-pro` folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\setup-local.ps1
   ```

3. When it says **NexusERP Pro: http://localhost:4173**, open that address and sign in as `arta@ylli.al` with password `demo1234`.

The first run takes 10–20 minutes, mostly downloading Docker images. Later runs take about a minute.

| Option | What it does |
|---|---|
| `-KeepData` | starts again with the data you already have (no reset) |
| `-NoDemo` | an empty database: sign up and create your own company |
| `-Dev` | development server on http://localhost:5173 with instant reload |
| `-NoServe` | prepares everything without starting the app |

## Every day after that

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-local.ps1 -KeepData
```

Stop with `deploy\windows\stop-local.ps1`. The data stays in Docker and comes back next time; `stop-local.ps1 -DeleteData` removes it.

## Useful addresses while it runs

- App: http://localhost:4173
- Supabase Studio (tables, SQL editor, users): http://127.0.0.1:54323
- Emails sent by sign-up and password reset (Mailpit): http://127.0.0.1:54324

## Using it from phones and tills on the same network

Find the computer's address with `ipconfig` (for example `192.168.1.20`), then:

1. In `.env.local`, change `VITE_SUPABASE_URL` to `http://192.168.1.20:54321`.
2. Add `http://192.168.1.20:4173` to `additional_redirect_urls` in `supabase\config.toml`, then run `npx supabase@2 stop` and the setup with `-KeepData`.
3. Run `npm run build`, then `npm run preview -- --host --port 4173`, and open `http://192.168.1.20:4173` on the phone. Allow Node.js through the Windows firewall when asked.

Installing the app on a phone's home screen and offline mode need HTTPS, which a plain local address does not have; for that, use a hosted deployment.

## If something goes wrong

| Message | What to do |
|---|---|
| Docker Desktop is not running | Open Docker Desktop and wait for "Engine running". |
| port is already allocated | Another program uses one of the ports. Stop other Supabase projects with `npx supabase@2 stop --all`, or close the program using the port. |
| The migrations did not apply | Send the first error shown above the message to the developer. |
| The page opens but sign-in fails | Check that `.env.local` exists and points to `http://127.0.0.1:54321`, then rebuild with the setup and `-KeepData`. |
| Scripts are blocked | Use the exact command above (`-ExecutionPolicy Bypass`); it allows only this script to run. |
