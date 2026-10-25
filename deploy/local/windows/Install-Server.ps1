<#
  NexusERP server on a Windows computer (Windows 10/11 or Windows Server 2022/2025).

  The server runs inside Linux (WSL 2, Ubuntu) on this computer, the same way as on a Linux server:
  database, sign-in, API and the app. Other computers in the shop open it with this computer's address.

  Run as administrator, from the unpacked nexuserp-server folder:
    powershell -ExecutionPolicy Bypass -File windows\Install-Server.ps1
  The first time Windows may need a restart to turn on WSL; then run it again.
#>
param([string]$Distro = 'Ubuntu-24.04')
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`n$t" -ForegroundColor Red; Read-Host 'Shtypni Enter'; exit 1 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'Nisni PowerShell si administrator (klik i djathtë → Run as administrator) dhe provoni përsëri.' }
$bundle = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not (Test-Path (Join-Path $bundle 'install.sh'))) { Fail "Nuk u gjet install.sh në $bundle" }

Step '1/6 WSL 2 (Linux brenda Windows)'
wsl.exe --status *> $null
if ($LASTEXITCODE -ne 0) {
  wsl.exe --install --no-distribution
  Write-Host "`nWSL u instalua. RINISNI kompjuterin dhe nisni këtë skript përsëri." -ForegroundColor Yellow
  Read-Host 'Shtypni Enter'; exit 0
}
$have = (wsl.exe -l -q) -replace "`0", '' | Where-Object { $_.Trim() -eq $Distro }
if (-not $have) {
  Step "2/6 Ubuntu ($Distro) - shkarkohet një herë"
  wsl.exe --install -d $Distro --no-launch
  $exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WindowsApps" -Filter 'ubuntu*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { & $exe.FullName install --root | Out-Null } else { wsl.exe -d $Distro -u root -- true }
} else { Step "2/6 Ubuntu ($Distro) është gati" }

Step '3/6 Systemd dhe rrjeti'
wsl.exe -d $Distro -u root -- bash -c "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
# Windows 11 22H2+ / Server 2025: the server's ports are this computer's ports (mirrored); older: a port forward
$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$mirrored = $build -ge 22621
if ($mirrored) { Set-Content -Path $wslconfig -Value "[wsl2]`nnetworkingMode=mirrored`nvmIdleTimeout=-1`n" -Encoding ASCII }
else { Set-Content -Path $wslconfig -Value "[wsl2]`nvmIdleTimeout=-1`n" -Encoding ASCII }
wsl.exe --shutdown
Start-Sleep 3

Step '4/6 NexusERP në Ubuntu'
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = 'localhost' }
$src = (wsl.exe -d $Distro -u root -- wslpath -a "$bundle") -replace "`0", ''
wsl.exe -d $Distro -u root -- bash -c "mkdir -p /opt/nexuserp && cp -r '$($src.Trim())/.' /opt/nexuserp/ && chmod +x /opt/nexuserp/*.sh /opt/nexuserp/deploy/coolify/*.sh"
wsl.exe -d $Distro -u root -- bash -c "cd /opt/nexuserp && PUBLIC_URL=http://$ip bash install.sh"
if ($LASTEXITCODE -ne 0) { Fail 'Instalimi në Ubuntu nuk përfundoi. Bëni screenshot të kësaj dritareje.' }

Step '5/6 Hyrja nga kompjuterët e tjerë'
New-NetFirewallRule -DisplayName 'NexusERP (port 80)' -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -ErrorAction SilentlyContinue | Out-Null
$keep = "wsl.exe -d $Distro -u root -- bash -c 'sleep infinity'"
if (-not $mirrored) {
  # the Linux side gets a new address after each start: the forward is renewed at start
  $fwd = "`$w=(wsl.exe -d $Distro -u root -- hostname -I).Trim().Split(' ')[0]; netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0 | Out-Null; netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=80 connectaddress=`$w"
  Set-Content -Path (Join-Path $bundle 'windows\forward-port.ps1') -Value $fwd -Encoding UTF8
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bundle 'windows\forward-port.ps1')
}

Step '6/6 Niset vetë me Windows'
Write-Host 'Windows kërkon fjalëkalimin e kësaj llogarie, që serveri të niset edhe kur askush nuk është i kyçur.'
$cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'Fjalëkalimi i llogarisë së Windows'
$actions = @(New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command $keep")
if (-not $mirrored) { $actions += New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $bundle 'windows\forward-port.ps1')`"" }
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'NexusERP Server' -Action $actions -Trigger $trigger -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'NexusERP Server'

Write-Host "`nNexusERP SERVER PUNON: http://$ip" -ForegroundColor Green
Write-Host 'Në kompjuterët e tjerë: hapni programin NexusERP, zgjidhni "Server lokal" dhe shkruani këtë adresë.'
Read-Host 'Shtypni Enter'
