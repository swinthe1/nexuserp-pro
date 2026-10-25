<#
  DrisPRO - run it on this Windows computer.

  What it does, in order:
    1. checks Node.js and Docker Desktop
    2. starts the local Supabase stack (database, sign-in, API, live updates, Studio) in Docker
    3. creates the database from the migrations (fresh, unless -KeepData)
    4. loads the Albanian demo company (unless -NoDemo or -KeepData)
    5. writes .env.local with the local addresses and key
    6. installs the app, builds it and serves it on http://localhost:4173 (or the dev server with -Dev)

  Run from the project folder:
    powershell -ExecutionPolicy Bypass -File deploy\windows\setup-local.ps1
  Options:
    -KeepData   keep the existing database (no reset, no demo load)
    -NoDemo     empty database: sign up and create your own company
    -Dev        start the development server (http://localhost:5173) instead of the production build
    -NoServe    prepare everything but do not start the app
#>
param([switch]$KeepData, [switch]$NoDemo, [switch]$Dev, [switch]$NoServe)

# native tools (npx, docker, npm) report through exit codes, which are checked after each step
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
$container = 'supabase_db_nexuserp'
# Supabase CLI, major version 2 (npx downloads it on first use)
$cli = 'supabase@2'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

Step 'Checking Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org and open a new PowerShell window.' }
$nodeVersion = (node -v)
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 18) { Fail "Node.js $nodeVersion is too old. Install Node.js 20 LTS or newer from https://nodejs.org." }
Write-Host "Node.js $nodeVersion"

Step 'Checking Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ (WSL 2 backend), start it, then run this script again.' }
docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop is not running. Start it, wait until it says "Engine running", then run this script again.' }
Write-Host 'Docker is running'

Step 'Starting Supabase (the first start downloads about 2-3 GB of images; this can take a while)'
npx --yes $cli start
if ($LASTEXITCODE -ne 0) { Fail 'Supabase did not start. If another Supabase project is running, stop it with "npx supabase stop --all" and try again.' }

if (-not $KeepData) {
  Step 'Creating a fresh database from the migrations'
  npx --yes $cli db reset --local
  if ($LASTEXITCODE -ne 0) { Fail 'The migrations did not apply. Scroll up for the first error and send it to the developer.' }

  if (-not $NoDemo) {
    Step 'Loading the demo company (Ylli Retail sh.p.k. and Ylli Kosova L.L.C.)'
    # copied into the container and run there, so Albanian letters arrive unchanged
    docker cp 'supabase\seed\demo.sql' "${container}:/tmp/demo.sql"
    if ($LASTEXITCODE -ne 0) { Fail "Could not copy the demo data into the database container ($container)." }
    # the database's own admin user if it accepts a local connection, otherwise postgres (allowed to load data on Supabase)
    docker exec $container psql -U supabase_admin -d postgres -tAc 'select 1' | Out-Null
    if ($LASTEXITCODE -eq 0) {
      docker exec $container psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null -f /tmp/demo.sql
    } else {
      docker exec -e PGPASSWORD=postgres $container psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null -f /tmp/demo.sql
    }
    if ($LASTEXITCODE -ne 0) { Fail 'The demo data did not load. Scroll up for the first error.' }
    Write-Host 'Demo loaded. Every demo login uses the password demo1234.'
  }
}

Step 'Writing .env.local'
$status = npx --yes $cli status -o env
$vars = @{}
foreach ($line in $status) { if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $vars[$Matches[1]] = $Matches[2] } }
if (-not $vars['API_URL'] -or -not $vars['ANON_KEY']) { Fail 'Could not read the local Supabase address and key from "supabase status".' }
@(
  "VITE_SUPABASE_URL=$($vars['API_URL'])",
  "VITE_SUPABASE_ANON_KEY=$($vars['ANON_KEY'])"
) | Set-Content -Encoding ascii '.env.local'
Write-Host ".env.local points to $($vars['API_URL'])"

Step 'Installing the app'
if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Fail 'npm could not install the packages. Check the internet connection and try again.' }

if (-not $Dev) {
  Step 'Building the app'
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'The build failed. Scroll up for the first error.' }
}

$app = if ($Dev) { 'http://localhost:5173' } else { 'http://localhost:4173' }
Write-Host ''
Write-Host '------------------------------------------------------------' -ForegroundColor Green
Write-Host " DrisPRO:      $app" -ForegroundColor Green
Write-Host " Supabase Studio:   http://127.0.0.1:54323   (tables, SQL, users)"
Write-Host " Emails (Mailpit):  http://127.0.0.1:54324"
if (-not $NoDemo -and -not $KeepData) {
  Write-Host ' Sign in as:        arta@ylli.al / demo1234   (owner; see docs\DEMO_DATA.md for the others)'
}
Write-Host ' Stop everything:   deploy\windows\stop-local.ps1'
Write-Host '------------------------------------------------------------' -ForegroundColor Green

if ($NoServe) { exit 0 }
if ($Dev) { npm run dev -- --port 5173 --strictPort } else { npm run preview -- --port 4173 --strictPort }
