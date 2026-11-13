# The engine's own logic, on a Windows build machine (no WSL there: what needs Linux is tested on a real server).
BeforeAll {
  $env:DRIS_ENGINE_TEST = '1'
  . (Join-Path $PSScriptRoot '..\engine\engine.ps1') -Action status
}

Describe 'paths and values for Linux' {
  It 'turns a Windows folder into its /mnt path, spaces kept' {
    ConvertTo-LinuxPath 'C:\Program Files\DrisPRO Server\resources\bundle\drispro-server' | Should -Be '/mnt/c/Program Files/DrisPRO Server/resources/bundle/drispro-server'
  }
  It 'quotes a value for the shell, quotes inside too' {
    ConvertTo-ShellValue "Arbën O'Neill" | Should -Be "'Arbën O'\''Neill'"
  }
}

Describe 'running programs' {
  It 'reads every line and the exit code' {
    $r = Invoke-Native 'cmd.exe' @('/c', 'echo one& echo two& exit 3')
    $r.Code | Should -Be 3
    $r.Lines | Should -Contain 'one'
    $r.Lines | Should -Contain 'two'
  }
  It 'gives stdin as UTF-8 with Linux line ends' {
    $r = Invoke-Native 'powershell.exe' @('-NoProfile', '-Command', '$i = [Console]::In.ReadToEnd(); [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output ($i.Contains("`r")); Write-Output $i.Trim()') "Ç'kemi`r`nmirë"
    $r.Lines[0] | Should -Be 'False'
  }
  It 'stops a program that takes too long' {
    $r = Invoke-Native 'powershell.exe' @('-NoProfile', '-Command', 'Start-Sleep 30') $null $null 2
    $r.Code | Should -Be -1
  }
  It 'sends each line to a listener as it comes' {
    $script:seen = @()
    $null = Invoke-Native 'cmd.exe' @('/c', 'echo a& echo b') $null { param($l) $script:seen += $l }
    $script:seen | Should -Be @('a', 'b')
  }
}

Describe 'events' {
  It 'writes one JSON line per event, secrets hidden' {
    $Secrets.Add('482913')
    $null = Send 'line' @{ text = 'PIN 482913 u dha' }
    $log = Get-Content $LogFile -Raw
    $log | Should -Not -Match '482913'
  }
  It 'a stop carries its key' {
    try { Stop-Here 'bios-password' 'BIOS-i ka fjalëkalim' } catch { $_.Exception.Data['drisKey'] | Should -Be 'bios-password' }
  }
}

Describe 'this computer' {
  It 'reads the machine' {
    $m = Get-Machine
    $m.RamGb | Should -BeGreaterThan 0
    $m.Build | Should -BeGreaterThan 10000
  }
  It 'finds a free port from 80' {
    Test-PortFree 80 | Should -BeOfType [bool]
  }
  It 'tells the BIOS key for each maker' {
    Get-BiosKey 'HP' | Should -Match 'F10'
    Get-BiosKey 'Dell Inc.' | Should -Match 'F2'
    Get-BiosKey 'Unknown' | Should -Match 'F2'
  }
}

Describe 'the whole preflight' {
  It 'runs and ends with its summary' {
    $env:DRIS_ENGINE_TEST = ''
    $null = New-Item "$env:TEMP\empty.txt" -Force
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot '..\engine\engine.ps1'), '-Action', 'preflight') `
      -RedirectStandardOutput "$env:TEMP\pf.txt" -RedirectStandardInput "$env:TEMP\empty.txt" -NoNewWindow -Wait
    $env:DRIS_ENGINE_TEST = '1'
    $lines = Get-Content "$env:TEMP\pf.txt" | ForEach-Object { $_ | ConvertFrom-Json }
    ($lines | Where-Object t -eq 'check').Count | Should -BeGreaterThan 6
    ($lines | Where-Object t -eq 'preflight-done') | Should -Not -BeNullOrEmpty
  }
}
