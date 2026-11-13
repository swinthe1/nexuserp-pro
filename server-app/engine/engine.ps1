<#
  DrisPRO Server: the engine under the installer and the tray program (Windows PowerShell 5.1).

  Every step checks first, puts right what it can, and checks again; nothing is done twice. What it
  does is said as one JSON line per event on stdout ({"t":"..."}), for the program to show. A full
  log is kept in C:\ProgramData\DrisPRO Server\logs. Secrets (PIN, Windows password) come on stdin,
  are never written to disk or to the log.

    engine.ps1 -Action preflight                 what this computer has and lacks, nothing changed
    engine.ps1 -Action prepare  [stdin: {bios}]  virtualization and WSL; may ask for a restart
    engine.ps1 -Action licence  [stdin: {licence}]   checks the licence code with DrisPRO
    engine.ps1 -Action install -Bundle <dir> [stdin: answers]   Ubuntu, DrisPRO, network, autostart, last check
    engine.ps1 -Action status | repair | backup | update | uninstall [-KeepData]
#>
param(
  [ValidateSet('preflight', 'prepare', 'licence', 'install', 'status', 'repair', 'backup', 'update', 'uninstall', 'restart')]
  [string]$Action = 'status',
  [string]$Bundle = '',
  [switch]$KeepData
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$env:WSL_UTF8 = '1'

$Distro = 'Ubuntu-24.04'
$TaskName = 'DrisPRO Server'
$LicenceApi = 'https://api.erp.dris-ks.com'
$AnonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0'
$Root = Join-Path $env:ProgramData 'DrisPRO Server'
$StateFile = Join-Path $Root 'state.json'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("{0}-{1}.log" -f $Action, (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Secrets = New-Object System.Collections.Generic.List[string]

# ------------------------------------------------------------------ talking to the program, and the log
function Write-Log([string]$Text) {
  foreach ($s in $Secrets) { if ($s) { $Text = $Text.Replace($s, '******') } }
  Add-Content -Path $LogFile -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) -Encoding UTF8
}
function Send([string]$Type, [hashtable]$Data = @{}) {
  $Data['t'] = $Type
  $line = $Data | ConvertTo-Json -Compress -Depth 8
  foreach ($s in $Secrets) { if ($s) { $line = $line.Replace($s, '******') } }
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
  Write-Log $line
}
function Say([string]$Text) { Send 'line' @{ text = $Text } }
function Step([string]$Key, [string]$State, [string]$Text = '') { Send 'step' @{ key = $Key; state = $State; text = $Text } }
function Check([string]$Key, [string]$State, [string]$Text, [string]$Fix = '') { Send 'check' @{ key = $Key; state = $State; text = $Text; fix = $Fix } }
# a stop the program knows how to explain (a key and a text), apart from an unexpected error
function Stop-Here([string]$Key, [string]$Text) { $e = New-Object System.Exception $Text; $e.Data['drisKey'] = $Key; throw $e }

# ------------------------------------------------------------------ remembered between runs (no secrets)
function Get-State {
  if (Test-Path $StateFile) { try { return Get-Content $StateFile -Raw | ConvertFrom-Json } catch { } }
  return [pscustomobject]@{}
}
function Set-StateValue([string]$Name, $Value) {
  $s = Get-State
  $s | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
  $s | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8
}
function Read-Answers {
  $text = [Console]::In.ReadToEnd()
  if (-not $text.Trim()) { return [pscustomobject]@{} }
  $a = $text | ConvertFrom-Json
  foreach ($k in 'adminPin', 'windowsPassword', 'biosPassword') { if ($a.$k) { $Secrets.Add([string]$a.$k) } }
  return $a
}

# ------------------------------------------------------------------ running programs, and Linux
# A program's output line by line; text for its stdin is sent as UTF-8 with Linux line ends (nothing
# goes through a command line, so nothing is lost on the way: wsl.exe drops backslashes from it).
function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$StdIn = $null, [scriptblock]$OnLine = $null, [int]$TimeoutSec = 3600) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = ($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  if ($null -ne $StdIn) {
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($StdIn -replace "`r`n", "`n"))
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  }
  $p.StandardInput.Close()
  $all = New-Object System.Collections.Generic.List[string]
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $timedOut = $false
  while ($true) {
    $t = $p.StandardOutput.ReadLineAsync()
    while (-not $t.Wait(500)) { if ((Get-Date) -gt $deadline) { $timedOut = $true; break } }
    if ($timedOut) { try { $p.Kill() } catch { }; Write-Log "  (stopped after $TimeoutSec s)"; break }
    $line = $t.Result
    if ($null -eq $line) { break }
    $line = $line -replace "`0", ''
    $all.Add($line); Write-Log "  | $line"
    if ($OnLine) { & $OnLine $line }
  }
  $p.WaitForExit(30000) | Out-Null
  $err = ''
  if ($errTask.Wait(5000)) { $err = ($errTask.Result -replace "`0", '').Trim() }
  if ($err) { foreach ($l in ($err -split "`r?`n")) { $all.Add($l); Write-Log "  ! $l" } }
  $code = $(if ($timedOut) { -1 } elseif ($p.HasExited) { $p.ExitCode } else { -1 })
  return [pscustomobject]@{ Code = $code; Lines = $all; Text = ($all -join "`n") }
}
function Invoke-Wsl([string]$Script, [scriptblock]$OnLine = $null, [int]$TimeoutSec = 3600) {
  Write-Log "wsl> $($Script.Split("`n")[0])"
  # everything the script says comes on one stream, in order
  return Invoke-Native 'wsl.exe' @('-d', $Distro, '-u', 'root', '--', 'bash', '-s') ("exec 2>&1`n" + $Script) $OnLine $TimeoutSec
}
function ConvertTo-LinuxPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  return '/mnt/' + $full.Substring(0, 1).ToLower() + ($full.Substring(2) -replace '\\', '/')
}
function ConvertTo-ShellValue([string]$Value) { return "'" + ($Value -replace "'", "'\''") + "'" }

# ------------------------------------------------------------------ what this computer is
function Get-Machine {
  $cs = Get-CimInstance Win32_ComputerSystem
  $os = Get-CimInstance Win32_OperatingSystem
  $cpu = @(Get-CimInstance Win32_Processor)
  $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
  return [pscustomobject]@{
    Maker = [string]$cs.Manufacturer; Model = [string]$cs.Model
    Virtual = ([string]$cs.Model -match 'Virtual|VMware|KVM|QEMU|Xen|Proxmox|HVM') -or ([string]$cs.Manufacturer -match 'VMware|QEMU|Xen|innotek')
    RamGb = [math]::Round($cs.TotalPhysicalMemory / 1GB)
    FreeGb = [math]::Round($drive.FreeSpace / 1GB)
    Build = [int]$os.BuildNumber; Caption = [string]$os.Caption
    Server = ($os.ProductType -ne 1)
    Hypervisor = [bool]$cs.HypervisorPresent
    Firmware = [bool]($cpu | Where-Object { $_.VirtualizationFirmwareEnabled } | Select-Object -First 1)
    VmxSupport = [bool]($cpu | Where-Object { $_.VMMonitorModeExtensions } | Select-Object -First 1)
  }
}
function Get-LanAddress {
  # the shop's own network (192.168.x, 10.x, 172.16-31.x), not a VPN such as Radmin (26.x) or Hamachi (25.x)
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Where-Object { (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).InterfaceDescription -notmatch 'Radmin|Hamachi|ZeroTier|Tailscale|WireGuard|OpenVPN|TAP-Windows|Hyper-V|vEthernet|WSL' } |
    Sort-Object InterfaceMetric
  $ip = ($ips | Where-Object { $_.IPAddress -match '^(192\.168|10)\.|^172\.(1[6-9]|2\d|3[01])\.' } | Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = ($ips | Select-Object -First 1).IPAddress }
  return $ip
}
function Test-PortFree([int]$Port) { return -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }
function Get-Feature([string]$Name) { try { return (Get-WindowsOptionalFeature -Online -FeatureName $Name).State } catch { return 'Unknown' } }
function Get-Distros {
  $r = Invoke-Native 'wsl.exe' @('-l', '-q') $null $null 60
  if ($r.Code -ne 0) { return @() }
  return @($r.Lines | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
function Test-Internet([string]$Url) {
  try { Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 15 | Out-Null; return $true }
  catch { if ($_.Exception.Response) { return $true }; return $false }
}

# ------------------------------------------------------------------ virtualization, by the maker's own BIOS tools
function Enable-BiosVirtualization($Machine, [string]$BiosPassword) {
  $maker = $Machine.Maker
  if ($maker -match 'HP|Hewlett') {
    $settings = Get-CimInstance -Namespace root/HP/InstrumentedBIOS -ClassName HP_BIOSEnumeration -ErrorAction Stop |
      Where-Object { $_.Name -match 'Virtualization' -and $_.PossibleValues -contains 'Enable' }
    if (-not $settings) { return 'manual' }
    $iface = Get-CimInstance -Namespace root/HP/InstrumentedBIOS -ClassName HP_BIOSSettingInterface
    $pw = if ($BiosPassword) { "<utf-16/>$BiosPassword" } else { '' }
    foreach ($s in $settings) {
      if ($s.CurrentValue -eq 'Enable') { continue }
      $r = Invoke-CimMethod -InputObject $iface -MethodName SetBIOSSetting -Arguments @{ Name = $s.Name; Value = 'Enable'; Password = $pw }
      Say "HP BIOS: $($s.Name) → Enable (përgjigja $($r.Return))"
      if ($r.Return -eq 6) { return 'password' }
      if ($r.Return -ne 0) { return 'manual' }
    }
    return 'done'
  }
  if ($maker -match 'Lenovo') {
    $all = Get-CimInstance -Namespace root/wmi -ClassName Lenovo_BiosSetting -ErrorAction Stop | Where-Object { $_.CurrentSetting -match '^(VirtualizationTechnology|Intel ?Virtualization ?Technology|VTdFeature|AMD ?V|SVM)' }
    if (-not $all) { return 'manual' }
    $set = Get-CimInstance -Namespace root/wmi -ClassName Lenovo_SetBiosSetting
    $save = Get-CimInstance -Namespace root/wmi -ClassName Lenovo_SaveBiosSettings
    $suffix = if ($BiosPassword) { ",$BiosPassword,ascii,us" } else { '' }
    foreach ($s in $all) {
      $name = $s.CurrentSetting.Split(',')[0]
      $r = Invoke-CimMethod -InputObject $set -MethodName SetBiosSetting -Arguments @{ parameter = "$name,Enable$suffix" }
      if ($r.return -ne 'Success') { $r = Invoke-CimMethod -InputObject $set -MethodName SetBiosSetting -Arguments @{ parameter = "$name,Enabled$suffix" } }
      Say "Lenovo BIOS: $name → Enabled ($($r.return))"
      if ($r.return -match 'Access') { return 'password' }
    }
    $r = Invoke-CimMethod -InputObject $save -MethodName SaveBiosSettings -Arguments @{ parameter = $(if ($BiosPassword) { "$BiosPassword,ascii,us" } else { '' }) }
    if ($r.return -match 'Access') { return 'password' }
    if ($r.return -ne 'Success') { return 'manual' }
    return 'done'
  }
  if ($maker -match 'Dell') {
    $attr = Get-CimInstance -Namespace root/dcim/sysman/biosattributes -ClassName EnumerationAttribute -ErrorAction Stop | Where-Object { $_.AttributeName -eq 'Virtualization' }
    if (-not $attr) { return 'manual' }
    $iface = Get-CimInstance -Namespace root/dcim/sysman/biosattributes -ClassName BIOSAttributeInterface
    $args1 = @{ SecType = [uint32]0; SecHndCount = [uint32]0; SecHandle = [byte[]]@(); AttributeName = 'Virtualization'; AttributeValue = 'Enabled' }
    if ($BiosPassword) {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($BiosPassword)
      $args1 = @{ SecType = [uint32]1; SecHndCount = [uint32]$bytes.Length; SecHandle = $bytes; AttributeName = 'Virtualization'; AttributeValue = 'Enabled' }
    }
    $r = Invoke-CimMethod -InputObject $iface -MethodName SetAttribute -Arguments $args1
    Say "Dell BIOS: Virtualization → Enabled (përgjigja $($r.Status))"
    if ($r.Status -eq 2) { return 'password' }
    if ($r.Status -ne 0) { return 'manual' }
    return 'done'
  }
  return 'manual'
}
function Get-BiosKey([string]$Maker) {
  switch -Regex ($Maker) {
    'HP|Hewlett' { return 'F10 (Advanced → System Options → Virtualization Technology)' }
    'Dell' { return 'F2 (Virtualization Support → Virtualization)' }
    'Lenovo' { return 'F1 ose F2 (Security/Advanced → Virtualization → Intel VT-x)' }
    'ASUS' { return 'Del ose F2 (Advanced → CPU Configuration → Intel Virtualization Technology / SVM Mode)' }
    'MSI|Micro-Star' { return 'Del (OC → CPU Features → Intel Virtualization Tech / SVM Mode)' }
    'Gigabyte' { return 'Del (BIOS Features → Intel Virtualization Technology / SVM Mode)' }
    'Acer' { return 'F2 (Advanced → Intel Virtualization Technology)' }
    'Fujitsu' { return 'F2 (Advanced → CPU Configuration → Intel Virtualization Technology)' }
    'Supermicro' { return 'Del (Advanced → CPU Configuration → Intel Virtualization Technology)' }
    default { return 'F2, F10 ose Del gjatë ndezjes (CPU / Advanced → Virtualization Technology)' }
  }
}

# ------------------------------------------------------------------ preflight: a list, nothing changed
function Invoke-Preflight {
  $m = Get-Machine
  Send 'machine' @{ maker = $m.Maker; model = $m.Model; ram = $m.RamGb; free = $m.FreeGb; build = $m.Build; os = $m.Caption }
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) { Check 'admin' 'ok' 'I nisur si administrator' } else { Check 'admin' 'fail' 'Programi duhet nisur si administrator' 'Klik i djathtë → Run as administrator' }
  if ($m.Build -ge 19041) { Check 'windows' 'ok' "$($m.Caption) (build $($m.Build))" }
  else { Check 'windows' 'fail' "$($m.Caption) (build $($m.Build)) është shumë i vjetër" 'Duhet Windows 10 version 2004 ose më i ri, ose Windows Server 2022/2025' }
  if ($m.RamGb -ge 8) { Check 'ram' 'ok' "$($m.RamGb) GB RAM" }
  elseif ($m.RamGb -ge 6) { Check 'ram' 'warn' "$($m.RamGb) GB RAM: mjafton, por me pak hapësirë për programet e tjera" }
  else { Check 'ram' 'fail' "$($m.RamGb) GB RAM: duhen së paku 6 GB, mirë 8 GB" }
  if ($m.FreeGb -ge 30) { Check 'disk' 'ok' "$($m.FreeGb) GB të lira në $($env:SystemDrive)" }
  elseif ($m.FreeGb -ge 15) { Check 'disk' 'warn' "$($m.FreeGb) GB të lira në $($env:SystemDrive): mjafton për fillim, mirë 30 GB" }
  else { Check 'disk' 'fail' "Vetëm $($m.FreeGb) GB të lira në $($env:SystemDrive)" 'Lironi hapësirë: duhen së paku 15 GB' }
  if ($m.Hypervisor -or $m.Firmware) { Check 'virtualization' 'ok' 'Virtualizimi i procesorit është i ndezur' }
  elseif ($m.Virtual) { Check 'virtualization' 'fail' "Ky kompjuter është makinë virtuale ($($m.Model)) pa virtualizim të brendshëm" "Te hosti ndizni 'nested virtualization' për këtë makinë" }
  elseif ($m.Maker -match 'HP|Hewlett|Lenovo|Dell') { Check 'virtualization' 'fix' 'Virtualizimi është i fikur në BIOS' "Programi e ndez vetë ($($m.Maker)), pastaj kompjuteri riniset" }
  else { Check 'virtualization' 'fail' 'Virtualizimi është i fikur në BIOS' ("Ndizeni në BIOS me tastin " + (Get-BiosKey $m.Maker)) }
  $wsl = Get-Feature 'Microsoft-Windows-Subsystem-Linux'; $vmp = Get-Feature 'VirtualMachinePlatform'
  if ($wsl -eq 'Enabled' -and $vmp -eq 'Enabled') { Check 'wsl' 'ok' 'WSL (Linux brenda Windows) është gati' }
  else { Check 'wsl' 'fix' 'WSL (Linux brenda Windows) nuk është ndezur ende' 'Programi e ndez vetë; mund të duhet një rinisje' }
  $d = Get-Distros
  if ($d -contains $Distro) { Check 'ubuntu' 'ok' "$Distro është instaluar" } else { Check 'ubuntu' 'fix' "$Distro do të instalohet (rreth 500 MB)" }
  $ip = Get-LanAddress
  if ($ip) { Check 'network' 'ok' "Adresa në rrjetin e lokalit: $ip" } else { Check 'network' 'fail' 'Nuk u gjet rrjet lokal' 'Lidheni kompjuterin me rrjetin e lokalit (kabllo)' }
  $port = 80; while (-not (Test-PortFree $port)) { $port = $(if ($port -eq 80) { 8080 } else { $port + 1 }) }
  if ($port -eq 80) { Check 'port' 'ok' 'Porti 80 është i lirë' } else { Check 'port' 'ok' "Porti 80 është i zënë nga një program tjetër: DrisPRO do të përdorë $port" }
  $net = @{ 'DrisPRO' = "$LicenceApi/rest/v1/"; 'Docker' = 'https://download.docker.com/'; 'GitHub (pjesët e serverit)' = 'https://ghcr.io/v2/'; 'Ubuntu' = 'https://archive.ubuntu.com/' }
  $bad = @($net.Keys | Where-Object { -not (Test-Internet $net[$_]) })
  if (-not $bad) { Check 'internet' 'ok' 'Interneti arrin te DrisPRO, Docker, GitHub dhe Ubuntu' }
  else { Check 'internet' 'fail' ("Nuk arrihen: " + ($bad -join ', ')) 'Kontrolloni internetin, firewall-in ose proxy-n e rrjetit' }
  $sql = @(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^MSSQL' -and $_.Status -eq 'Running' })
  if ($sql) { Check 'others' 'ok' ("Programet e tjera mbeten siç janë (SQL Server: " + ($sql.Name -join ', ') + ")") }
  Set-StateValue 'ip' $ip; Set-StateValue 'port' $port
  Set-StateValue 'account' "$env:USERDOMAIN\$env:USERNAME"
  Send 'preflight-done' @{ ip = $ip; port = $port }
}

# ------------------------------------------------------------------ prepare: virtualization and WSL (may restart)
function Invoke-Prepare {
  $a = Read-Answers
  $m = Get-Machine
  $restart = $false
  Step 'virtualization' 'run'
  if (-not ($m.Hypervisor -or $m.Firmware)) {
    if ($m.Virtual) { Stop-Here 'virtualization' "Makinë virtuale pa 'nested virtualization': ndizeni te hosti" }
    $r = 'manual'
    try { $r = Enable-BiosVirtualization $m ([string]$a.biosPassword) } catch { Write-Log "BIOS: $($_.Exception.Message)"; $r = 'manual' }
    if ($r -eq 'password') { Send 'need' @{ what = 'biosPassword' }; Stop-Here 'bios-password' 'BIOS-i ka fjalëkalim' }
    if ($r -eq 'manual') { Stop-Here 'virtualization-manual' ("Virtualizimi duhet ndezur me dorë në BIOS: " + (Get-BiosKey $m.Maker)) }
    Step 'virtualization' 'ok' 'U ndez në BIOS: vlen pas rinisjes'
    $restart = $true
  } else { Step 'virtualization' 'ok' }

  Step 'wsl' 'run'
  foreach ($f in 'Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform') {
    if ((Get-Feature $f) -ne 'Enabled') {
      Say "Po ndizet $f"
      $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart -WarningAction SilentlyContinue
      if ($r.RestartNeeded) { $restart = $true }
    }
  }
  if ($restart) { Set-StateValue 'prepared' $false; Send 'restart' @{ reason = 'Virtualizimi dhe WSL vlejnë pas rinisjes së kompjuterit' }; return }
  # the WSL program itself, new enough for systemd and for the network settings
  $s = Invoke-Native 'wsl.exe' @('--status') $null $null 120
  if ($s.Code -ne 0 -or $s.Text -match 'update|përditëso|kernel') {
    Say 'Po përditësohet WSL'
    $u = Invoke-Native 'wsl.exe' @('--update', '--web-download') $null $null 900
    if ($u.Code -ne 0) { $u = Invoke-Native 'wsl.exe' @('--update') $null $null 900 }
  }
  Invoke-Native 'wsl.exe' @('--set-default-version', '2') $null $null 60 | Out-Null
  Step 'wsl' 'ok'
  Set-StateValue 'prepared' $true
  Send 'prepared' @{}
}

# ------------------------------------------------------------------ the licence, before anything is downloaded
function Invoke-LicenceCheck([string]$Code) {
  $s = Get-State
  $server = [string]$s.serverId
  if (-not $server) { $server = [guid]::NewGuid().ToString(); Set-StateValue 'serverId' $server }
  $body = @{ p_code = $Code.Trim().ToUpper(); p_server = $server; p_url = $null; p_version = 'installer' } | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$LicenceApi/rest/v1/rpc/licence_check" -Headers @{ apikey = $AnonKey; Authorization = "Bearer $AnonKey" } -ContentType 'application/json' -Body $body -TimeoutSec 30
    Send 'licence' @{ ok = $true; company = [string]$r.company.name; plan = [string]$r.plan; until = [string]$r.valid_until }
    return $true
  } catch {
    $msg = ''
    try { $msg = ((New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() | ConvertFrom-Json).message } catch { $msg = $_.Exception.Message }
    $text = switch -Regex ($msg) {
      'not known' { 'Ky kod licence nuk njihet. Kontrolloni shkronjat.' }
      'cloud only' { 'Kjo licencë është vetëm për cloud, jo për server lokal.' }
      'another server' { 'Kjo licencë përdoret nga një server tjetër. DrisPRO duhet ta lirojë (Platforma → licenca → "Lëvize te një server tjetër").' }
      default { "Licenca nuk u kontrollua: $msg" }
    }
    Send 'licence' @{ ok = $false; text = $text }
    return $false
  }
}

# ------------------------------------------------------------------ install: Ubuntu, DrisPRO, network, autostart, last check
function Invoke-Install([string]$BundleDir) {
  $a = Read-Answers
  $s = Get-State
  $m = Get-Machine
  if (-not (Test-Path (Join-Path $BundleDir 'install.sh'))) { Stop-Here 'bundle' "Paketa e serverit nuk u gjet në $BundleDir" }
  $ip = [string]$s.ip; if (-not $ip) { $ip = Get-LanAddress }
  $port = [int]$s.port; if (-not $port) { $port = 80; while (-not (Test-PortFree $port)) { $port = $(if ($port -eq 80) { 8080 } else { $port + 1 }) } }
  $url = $(if ($port -eq 80) { "http://$ip" } else { "http://${ip}:$port" })
  Set-StateValue 'url' $url

  # the Windows password first: a wrong one is said now, not after twenty minutes
  Step 'account' 'run'
  $user = "$env:USERDOMAIN\$env:USERNAME"
  # the start task is registered now, still empty: Windows itself checks the password, the same way it will at every start
  if (-not (Test-Path (Join-Path $Root 'start.ps1'))) { Set-Content -Path (Join-Path $Root 'start.ps1') -Value '# made by DrisPRO Server' -Encoding UTF8 }
  try { Register-Autostart $user ([string]$a.windowsPassword) $false }
  catch {
    Write-Log "task: $($_.Exception.Message)"
    Send 'need' @{ what = 'windowsPassword'; text = 'Windows nuk e pranoi fjalëkalimin e kësaj llogarie' }
    Stop-Here 'windows-password' 'Windows nuk e pranoi fjalëkalimin e kësaj llogarie'
  }
  Step 'account' 'ok' $user

  Step 'ubuntu' 'run'
  for ($try = 1; $try -le 3; $try++) {
    if ((Get-Distros) -notcontains $Distro) {
      Say "Po instalohet $Distro (prova $try)"
      $r = Invoke-Native 'wsl.exe' @('--install', '-d', $Distro, '--no-launch', '--web-download') $null $null 1800
      if ((Get-Distros) -notcontains $Distro -and $r.Code -ne 0) { $r = Invoke-Native 'wsl.exe' @('--install', '-d', $Distro, '--no-launch') $null $null 1800 }
      if ((Get-Distros) -notcontains $Distro) {
        # an older WSL installs the Store app first: its launcher makes the distribution, with root and no questions
        $exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WindowsApps" -Filter 'ubuntu*.exe' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
        if ($exe) { Invoke-Native $exe.FullName @('install', '--root') $null $null 1800 | Out-Null }
      }
      if ($r.Text -match 'HCS_E_HYPERV_NOT_INSTALLED|virtualization') { Stop-Here 'virtualization' 'Virtualizimi nuk është i ndezur: rinisni kompjuterin ose ndizeni në BIOS' }
    }
    $t = Invoke-Wsl 'true' $null 300
    if ($t.Code -eq 0) { break }
    if ($t.Text -match 'HCS_E_HYPERV_NOT_INSTALLED|virtualization') { Stop-Here 'virtualization' 'Virtualizimi nuk është i ndezur: rinisni kompjuterin ose ndizeni në BIOS' }
    if ($try -eq 3) { Stop-Here 'ubuntu' "$Distro nuk niset: $($t.Text)" }
    # a half-made one is removed and made again
    Invoke-Native 'wsl.exe' @('--unregister', $Distro) $null $null 120 | Out-Null
  }
  Step 'ubuntu' 'ok'

  Step 'linux' 'run'
  $mirrored = ($m.Build -ge 22621)
  $gb = [math]::Max(4, [math]::Min(8, [math]::Floor($m.RamGb / 4)))
  $cfg = "[wsl2]`r`nvmIdleTimeout=-1`r`nmemory=${gb}GB`r`n" + $(if ($mirrored) { "networkingMode=mirrored`r`n" } else { '' })
  $wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
  $old = $(if (Test-Path $wslconfig) { Get-Content $wslconfig -Raw } else { '' })
  $r = Invoke-Wsl "test -f /etc/wsl.conf && grep -q '^systemd=true' /etc/wsl.conf && echo systemd-on || true"
  $needRestart = ($old -ne $cfg) -or ($r.Text -notmatch 'systemd-on')
  if ($needRestart) {
    Set-Content -Path $wslconfig -Value $cfg -Encoding ASCII
    Invoke-Wsl "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf" | Out-Null
    Invoke-Native 'wsl.exe' @('--shutdown') $null $null 120 | Out-Null
    Start-Sleep -Seconds 4
  }
  $r = Invoke-Wsl "for i in `$(seq 1 30); do s=`$(systemctl is-system-running 2>/dev/null); case `$s in running|degraded) echo ok; exit 0;; esac; sleep 2; done; echo `$s" $null 120
  if ($r.Text -notmatch 'ok') { Say "systemd: $($r.Text)" }
  Step 'linux' 'ok' "memorie ${gb} GB$(if ($mirrored) { ', rrjet i përbashkët' })"

  Step 'files' 'run'
  $src = ConvertTo-LinuxPath $BundleDir
  $r = Invoke-Wsl "set -e; mkdir -p /opt/drispro; cp -r '$src/.' /opt/drispro/; chmod +x /opt/drispro/*.sh /opt/drispro/deploy/coolify/*.sh; echo copied"
  if ($r.Text -notmatch 'copied') { Stop-Here 'files' "Skedarët e serverit nuk u kopjuan: $($r.Text)" }
  Step 'files' 'ok'

  # the answers for install.sh, readable only by root, removed at its end
  $setup = @(
    "LICENCE=$(ConvertTo-ShellValue ([string]$a.licence).Trim().ToUpper())"
    "SERVER_ID=$(ConvertTo-ShellValue ([string]$s.serverId))"
    "ADMIN_USER=$(ConvertTo-ShellValue ([string]$a.adminUser))"
    "ADMIN_PIN=$(ConvertTo-ShellValue ([string]$a.adminPin))"
    "ADMIN_NAME=$(ConvertTo-ShellValue ([string]$a.adminName))"
    "HTTP_PORT=$port"
    "PUBLIC_URL=$(ConvertTo-ShellValue $url)"
  ) -join "`n"
  $b64 = [Convert]::ToBase64String((New-Object System.Text.UTF8Encoding($false)).GetBytes($setup + "`n"))
  Invoke-Wsl "umask 077; echo $b64 | base64 -d > /opt/drispro/.setup" | Out-Null

  Step 'drispro' 'run'
  $script:lastError = ''
  $script:remoteUrl = ''
  $onLine = {
    param($l)
    if ($l -match '^@@step (\S+)') { Send 'progress' @{ key = 'drispro'; part = $Matches[1] } }
    elseif ($l -match '^@@error (\S+) ?(.*)$') { $script:lastError = "$($Matches[1]) $($Matches[2])"; Send 'problem' @{ key = $Matches[1]; text = $Matches[2] } }
    elseif ($l -match '^@@warn (\S+)') { Send 'warn' @{ key = $Matches[1] } }
    elseif ($l -match '^@@remote (\S+)') { $script:remoteUrl = $Matches[1]; Set-StateValue 'remoteUrl' $Matches[1] }
    elseif ($l -match '^@@done') { }
    elseif ($l.Trim()) { Say $l }
  }
  $r = Invoke-Wsl 'cd /opt/drispro && bash install.sh </dev/null' $onLine 5400
  if ($r.Code -eq 3) { Send 'need' @{ what = 'admin'; text = $script:lastError }; Stop-Here 'admin' 'Emri i përdoruesit ose PIN-i nuk pranohen' }
  if ($r.Code -eq 4) { Send 'need' @{ what = 'licence'; text = $script:lastError }; Stop-Here 'licence' 'Licenca nuk u pranua' }
  if ($r.Code -ne 0) {
    # once more: most problems on a first start (a slow download, a service late) pass the second time
    Say 'Provohet edhe një herë'
    $r = Invoke-Wsl 'cd /opt/drispro && bash install.sh </dev/null' $onLine 5400
    if ($r.Code -ne 0) { Stop-Here 'drispro' "Instalimi i DrisPRO nuk përfundoi ($script:lastError)" }
  }
  Invoke-Wsl 'rm -f /opt/drispro/.setup' | Out-Null
  Step 'drispro' 'ok'

  Step 'network' 'run'
  Set-Network $port $mirrored
  Step 'network' 'ok' $url

  Step 'autostart' 'run'
  Register-Autostart $user ([string]$a.windowsPassword) $true
  Step 'autostart' 'ok'

  Step 'final' 'run'
  $bad = Test-FromNetwork $ip $port
  if ($bad) { Stop-Here 'final' ("Nga rrjeti nuk përgjigjen: " + ($bad -join ', ')) }
  Step 'final' 'ok'
  Set-StateValue 'installedAt' (Get-Date -Format 'o')
  Send 'done' @{ url = $url; user = [string]$a.adminUser; remote = $script:remoteUrl }
}

function Set-Network([int]$Port, [bool]$Mirrored) {
  $name = "DrisPRO Server (port $Port)"
  Get-NetFirewallRule -DisplayName 'DrisPRO*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ne $name } | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
  }
  $fwd = Join-Path $Root 'start.ps1'
  # at every start: Linux up, and (without the shared network) the port forwarded to Linux's new address
  $body = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$env:WSL_UTF8 = '1'
wsl.exe -d $Distro -u root -- true
"@
  if (-not $Mirrored) {
    $body += @"

for (`$i = 0; `$i -lt 30; `$i++) { `$w = ((wsl.exe -d $Distro -u root -- hostname -I) -join ' ').Trim().Split(' ')[0]; if (`$w) { break }; Start-Sleep 2 }
netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=`$w | Out-Null
"@
  }
  $body += "`r`nwsl.exe -d $Distro -u root -- bash -c 'exec sleep infinity'`r`n"
  Set-Content -Path $fwd -Value $body -Encoding UTF8
  if (-not $Mirrored) {
    $w = ((Invoke-Wsl 'hostname -I').Lines -join ' ').Trim().Split(' ')[0]
    Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'delete', 'v4tov4', "listenport=$Port", 'listenaddress=0.0.0.0') | Out-Null
    $r = Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'add', 'v4tov4', "listenport=$Port", 'listenaddress=0.0.0.0', "connectport=$Port", "connectaddress=$w")
    if ($r.Code -ne 0) { Stop-Here 'network' "Porti nuk u përcoll: $($r.Text)" }
    # portproxy needs the IP Helper service
    Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service iphlpsvc -ErrorAction SilentlyContinue
  }
}

function Register-Autostart([string]$Account, [string]$Secret, [bool]$Start) {
  $fwd = Join-Path $Root 'start.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$fwd`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User $Account -Password $Secret -RunLevel Highest -Force -ErrorAction Stop | Out-Null
  if (-not $Start) { return }
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 5
  $t = Get-ScheduledTask -TaskName $TaskName
  if ($t.State -ne 'Running') { Say "Nisja automatike: $($t.State)" }
}

function Test-FromNetwork([string]$Ip, [int]$Port) {
  $bad = @()
  foreach ($p in @(@('faqja', '/'), @('hyrja', '/auth/v1/health'), @('skedarët', '/storage/v1/status'))) {
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
      try { $r = Invoke-WebRequest -Uri "http://${Ip}:$Port$($p[1])" -UseBasicParsing -TimeoutSec 10; $ok = ($r.StatusCode -eq 200) } catch { Start-Sleep -Seconds 3 }
    }
    if ($ok) { Say "✓ $($p[0]) përgjigjet në http://${Ip}:$Port" } else { $bad += $p[0] }
  }
  return $bad
}

# ------------------------------------------------------------------ after the install: the tray's buttons
function Invoke-Status {
  $s = Get-State
  $d = Get-Distros
  if ($d -notcontains $Distro) { Send 'status' @{ installed = $false }; return }
  $r = Invoke-Wsl 'bash /opt/drispro/status.sh 2>/dev/null || echo "{\"installed\":false}"' $null 120
  $json = ($r.Lines | Where-Object { $_.StartsWith('{') } | Select-Object -Last 1)
  $st = $null; try { $st = $json | ConvertFrom-Json } catch { }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $lan = $false
  if ($s.ip -and $s.port) { try { $lan = ((Invoke-WebRequest -Uri "http://$($s.ip):$($s.port)/auth/v1/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) } catch { } }
  Send 'status' @{ installed = $true; server = $st; url = [string]$s.url; remote = $(if ($st -and $st.remote_url) { [string]$st.remote_url } else { '' }); task = $(if ($task) { [string]$task.State } else { 'missing' }); network = $lan }
}

function Invoke-Repair {
  $s = Get-State
  $m = Get-Machine
  Step 'linux' 'run'
  $t = Invoke-Wsl 'true' $null 300
  if ($t.Code -ne 0) { Invoke-Native 'wsl.exe' @('--shutdown') | Out-Null; Start-Sleep 3; $t = Invoke-Wsl 'true' $null 300 }
  if ($t.Code -ne 0) { Stop-Here 'linux' "Ubuntu nuk niset: $($t.Text)" }
  Step 'linux' 'ok'
  Step 'drispro' 'run'
  $onLine = { param($l) if ($l -match '^@@(error|repaired|done)') { Send 'progress' @{ key = 'drispro'; part = $l } } elseif ($l.Trim()) { Say $l } }
  $r = Invoke-Wsl 'cd /opt/drispro && bash repair.sh </dev/null' $onLine 1800
  Step 'drispro' $(if ($r.Code -eq 0) { 'ok' } else { 'fail' })
  if ($s.port) {
    Step 'network' 'run'
    Set-Network ([int]$s.port) ($m.Build -ge 22621)
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Say 'Nisja automatike mungon: regjistrojeni përsëri nga programi (kërkon fjalëkalimin e Windows)'; Send 'need' @{ what = 'autostart' } }
    elseif ($t.State -ne 'Running') { Start-ScheduledTask -TaskName $TaskName; Say 'Nisja automatike u nis përsëri' }
    $bad = Test-FromNetwork ([string]$s.ip) ([int]$s.port)
    Step 'network' $(if ($bad) { 'fail' } else { 'ok' })
  }
  Send 'done' @{}
}

function Invoke-Uninstall([bool]$Keep) {
  $s = Get-State
  Step 'autostart' 'run'
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Step 'autostart' 'ok'
  Step 'network' 'run'
  Get-NetFirewallRule -DisplayName 'DrisPRO*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if ($s.port) { Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'delete', 'v4tov4', "listenport=$($s.port)", 'listenaddress=0.0.0.0') | Out-Null }
  Step 'network' 'ok'
  Step 'drispro' 'run'
  if ($Keep) {
    Invoke-Wsl 'cd /opt/drispro 2>/dev/null && docker compose down || true' $null 600 | Out-Null
    Say 'Të dhënat mbeten në Ubuntu (/opt/drispro): një instalim i ri i gjen dhe i vazhdon.'
  } else {
    Invoke-Native 'wsl.exe' @('--unregister', $Distro) $null $null 600 | Out-Null
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $env:USERPROFILE '.wslconfig')
    Remove-Item -Force -ErrorAction SilentlyContinue $StateFile
  }
  Step 'drispro' 'ok'
  Send 'done' @{}
}

# ------------------------------------------------------------------ one action per run
# (the tests load the functions without running anything)
if ($env:DRIS_ENGINE_TEST -eq '1') { return }
try {
  Write-Log "DrisPRO Server engine: $Action ($([Environment]::OSVersion.VersionString), PowerShell $($PSVersionTable.PSVersion))"
  switch ($Action) {
    'preflight' { Invoke-Preflight }
    'prepare' { Invoke-Prepare }
    'licence' { $a = Read-Answers; [void](Invoke-LicenceCheck ([string]$a.licence)) }
    'install' { Invoke-Install $Bundle }
    'status' { Invoke-Status }
    'repair' { Invoke-Repair }
    'backup' {
      $r = Invoke-Wsl '/usr/local/bin/drispro-backup drispro-db /root/backups 14 manual 2>&1 | tail -3' { param($l) Say $l } 1800
      Send 'done' @{ ok = ($r.Code -eq 0) }
    }
    'update' {
      $r = Invoke-Wsl 'cd /opt/drispro && AUTO_UPDATE=true bash auto-update.sh 2>&1' { param($l) Say $l } 3600
      Send 'done' @{ ok = ($r.Code -eq 0) }
    }
    'restart' {
      Invoke-Wsl 'cd /opt/drispro && docker compose restart' { param($l) Say $l } 900 | Out-Null
      Send 'done' @{}
    }
    'uninstall' { Invoke-Uninstall $KeepData.IsPresent }
  }
  exit 0
} catch {
  if ($_.Exception.Data['drisKey']) { Send 'stop' @{ key = [string]$_.Exception.Data['drisKey']; text = $_.Exception.Message; log = $LogFile }; exit 2 }
  Send 'stop' @{ key = 'unexpected'; text = "$($_.Exception.Message) ($($_.InvocationInfo.ScriptLineNumber))"; log = $LogFile }
  exit 1
}
