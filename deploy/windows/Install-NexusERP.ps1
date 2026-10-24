<#
  Unzips NexusERP Pro next to this script and runs the local setup.
  Put this file in the same folder as nexuserp-pro-phase9.zip and run:
    powershell -ExecutionPolicy Bypass -File Install-NexusERP.ps1
  Any options are passed on to setup-local.ps1 (for example -NoDemo or -Dev).
#>
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$zip = Join-Path $here 'nexuserp-pro-phase9.zip'
$target = Join-Path $here 'nexuserp-pro'

if (-not (Test-Path $target)) {
  if (-not (Test-Path $zip)) { Write-Host "nexuserp-pro-phase9.zip was not found in $here" -ForegroundColor Red; exit 1 }
  Write-Host "Unzipping into $target"
  Expand-Archive -Path $zip -DestinationPath $here -Force
} else {
  Write-Host "Using the existing folder $target (delete it to unzip a fresh copy)"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'deploy\windows\setup-local.ps1') @args
