<#
  DrisPRO server on a Windows computer (Windows 10/11 or Windows Server 2022/2025).

  The server runs inside Linux (WSL 2, Ubuntu) on this computer, the same way as on a Linux server:
  database, sign-in, API and the app. Other computers in the shop open it with this computer's address.

  Run as administrator, from the unpacked drispro-server folder:
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
# without virtualization WSL 2 cannot start: say so plainly, before anything else fails
$have = (wsl.exe -l -q) -replace "`0", '' | Where-Object { $_.Trim() -eq $Distro }
if (-not $have) {
  $vm = (Get-CimInstance Win32_ComputerSystem).Model
  $why = if ($vm -match 'Virtual|VMware|KVM|QEMU|Xen|Proxmox') { "Ky kompjuter është makinë virtuale ($vm): te hosti duhet ndezur 'nested virtualization' për këtë makinë." }
         else { "Virtualizimi i procesorit është i fikur: ndizeni në BIOS/UEFI (Intel VT-x / Intel Virtualization Technology ose AMD SVM), ruajeni dhe rinisni." }
  Fail "Ubuntu nuk mund të niset: virtualizimi nuk është i ndezur në këtë kompjuter.`n$why`nPastaj nisni këtë skript përsëri."
}

Step '3/6 Systemd dhe rrjeti'
wsl.exe -d $Distro -u root -- bash -c "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
# Windows 11 22H2+ / Server 2025: the server's ports are this computer's ports (mirrored); older: a port forward
$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$mirrored = $build -ge 22621
# a fixed share of memory (a quarter, 4-8 GB), so programs already on this computer (SQL Server…) keep theirs
$gb = [math]::Max(4, [math]::Min(8, [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 4GB)))
$mem = "memory=${gb}GB`n"
if ($mirrored) { Set-Content -Path $wslconfig -Value "[wsl2]`nnetworkingMode=mirrored`nvmIdleTimeout=-1`n$mem" -Encoding ASCII }
else { Set-Content -Path $wslconfig -Value "[wsl2]`nvmIdleTimeout=-1`n$mem" -Encoding ASCII }
wsl.exe --shutdown
Start-Sleep 3

Step '4/6 DrisPRO në Ubuntu'
# the shop's own network first (192.168.x, 10.x, 172.16-31.x), not a VPN such as Radmin (26.x) or Hamachi (25.x)
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric
$ip = ($ips | Where-Object { $_.IPAddress -match '^(192\.168|10)\.|^172\.(1[6-9]|2\d|3[01])\.' } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = ($ips | Select-Object -First 1).IPAddress }
if (-not $ip) { $ip = 'localhost' }
# port 80 is often taken on a shop server (IIS, another program's web page): then 8080, 8081...
$port = 80
while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $port = if ($port -eq 80) { 8080 } else { $port + 1 } }
if ($port -ne 80) { Write-Host "Porti 80 është i zënë nga një program tjetër: DrisPRO do të punojë në portin $port." -ForegroundColor Yellow }
$url = if ($port -eq 80) { "http://$ip" } else { "http://${ip}:$port" }
$src = (wsl.exe -d $Distro -u root -- wslpath -a "$bundle") -replace "`0", ''
wsl.exe -d $Distro -u root -- bash -c "mkdir -p /opt/drispro && cp -r '$($src.Trim())/.' /opt/drispro/ && chmod +x /opt/drispro/*.sh /opt/drispro/deploy/coolify/*.sh"
wsl.exe -d $Distro -u root -- bash -c "cd /opt/drispro && HTTP_PORT=$port PUBLIC_URL=$url bash install.sh"
if ($LASTEXITCODE -ne 0) { Fail 'Instalimi në Ubuntu nuk përfundoi. Bëni screenshot të kësaj dritareje.' }

Step '5/6 Hyrja nga kompjuterët e tjerë'
New-NetFirewallRule -DisplayName "DrisPRO (port $port)" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -ErrorAction SilentlyContinue | Out-Null
$keep = "wsl.exe -d $Distro -u root -- bash -c 'sleep infinity'"
if (-not $mirrored) {
  # the Linux side gets a new address after each start: the forward is renewed at start
  $fwd = "`$w=(wsl.exe -d $Distro -u root -- hostname -I).Trim().Split(' ')[0]; netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 | Out-Null; netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=`$w"
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
Register-ScheduledTask -TaskName 'DrisPRO Server' -Action $actions -Trigger $trigger -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'DrisPRO Server'

Write-Host "`nDrisPRO SERVER PUNON: $url" -ForegroundColor Green
Write-Host 'Në kompjuterët e tjerë: hapni programin DrisPRO, zgjidhni "Server lokal" dhe shkruani këtë adresë.'
Read-Host 'Shtypni Enter'
