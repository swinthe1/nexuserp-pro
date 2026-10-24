<#
  Stops the local Supabase stack. The data is kept in Docker volumes and comes back on the next start
  (run setup-local.ps1 -KeepData, or just "npx supabase start" and "npm run preview").
  Add -DeleteData to remove the local database completely.
#>
param([switch]$DeleteData)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
if ($DeleteData) { npx --yes supabase@2 stop --no-backup } else { npx --yes supabase@2 stop }
