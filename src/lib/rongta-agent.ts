/**
 * The automatic link with a Rongta scale, the way Rongta allows it: RLS1000 keeps the scale up to date from
 * its PLU file by itself ("Set auto upload & download time" → Update PLU, every N seconds). This installer
 * puts a small service on that computer which, every minute, asks DrisPRO what the scale must hold
 * (public.scale_feed, with a key that reads only that scale) and writes it into that file: the prices of the
 * PLUs already in it, the new PLUs at the end. The hotkeys, labels and other fields stay as they were; the
 * file is written only when something changed, through a temporary file, in the file's own code page.
 *
 * One .bat file: the first lines run PowerShell on the rest of the same file (no execution-policy trouble,
 * nothing else to download). It installs into %LOCALAPPDATA%\DrisPRO\Peshorja and registers a task of the
 * signed-in user that runs every minute, hidden.
 */

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`

function agentScript(o: { api: string; anon: string; key: string; file: string }) {
  return `# DrisPRO - the prices for the scale, every minute. Made by DrisPRO; do not edit (download it again instead).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Api = ${ps(o.api)}
$Anon = ${ps(o.anon)}
$Key = ${ps(o.key)}
$File = ${ps(o.file)}
$H = @{ apikey = $Anon; Authorization = "Bearer $Anon"; 'x-scale-key' = $Key }
function Report($msg) {
  try { Invoke-RestMethod -Method Post -Uri "$Api/rest/v1/rpc/scale_feed_error" -Headers $H -ContentType 'application/json' -Body (@{ p_error = [string]$msg } | ConvertTo-Json) | Out-Null } catch {}
}
try {
  $r = Invoke-RestMethod -Method Post -Uri "$Api/rest/v1/rpc/scale_feed" -Headers $H -ContentType 'application/json' -Body (@{ p_agent = $env:COMPUTERNAME } | ConvertTo-Json)
} catch { exit 1 }
if (-not $r.active) { exit 0 }
try {
  $enc = [Text.Encoding]::GetEncoding(28591)
  if (-not (Test-Path -LiteralPath $File)) { throw "The PLU file of RLS1000 is not at $File" }
  $old = [IO.File]::ReadAllText($File, $enc)
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($l in ($old -split "\`r?\`n")) { if ($l.Trim() -ne '') { $lines.Add($l) } }
  $at = @{}
  $tpl = $null
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $f = $lines[$i] -split "\`t"
    if ($f.Count -ge 8 -and $f[1].Trim() -ne '') {
      $lf = $f[2].Trim() -replace '^0+', ''
      if ($lf -ne '') { $at[$lf] = $i; if ($null -eq $tpl) { $tpl = $f } }
    }
  }
  if ($null -eq $tpl) { $tpl = @('0','','0','0','7','0','4','25',' 0.000','0','0',' 0.000','5','0','0','0','0','0','0','','0','0','0','0.0','0.00') }
  foreach ($it in $r.items) {
    $plu = [string]$it.plu
    $cents = [string][int][math]::Round([decimal]$it.price * 100)
    if ($at.ContainsKey($plu)) {
      $f = $lines[$at[$plu]] -split "\`t"
      $f[5] = $cents
      $lines[$at[$plu]] = $f -join "\`t"
    } else {
      $f = [string[]]$tpl.Clone()
      $f[0] = '0'; $f[1] = [string]$it.name; $f[2] = $plu; $f[3] = $plu; $f[5] = $cents
      if ($it.by_piece) { $f[6] = '9' } else { $f[6] = '4' }
      $lines.Add($f -join "\`t")
      $at[$plu] = $lines.Count - 1
    }
  }
  $new = ($lines -join "\`r\`n") + "\`r\`n"
  if ($new -ne $old) {
    $tmp = "$File.drispro"
    [IO.File]::WriteAllText($tmp, $new, $enc)
    Move-Item -LiteralPath $tmp -Destination $File -Force
  }
} catch { Report $_.Exception.Message; exit 1 }
`
}

export function scaleInstaller(o: { api: string; anon: string; key: string; file: string; scaleId: string; scaleName: string }) {
  const id = o.scaleId.slice(0, 8)
  const name = o.scaleName.replace(/[^\x20-\x7e]/g, '').replace(/["%&|<>^]/g, '')
  const agent = agentScript(o)
  if (/^'@/m.test(agent)) throw new Error('agent script cannot be embedded')
  const lines = [
    '@echo off',
    `rem DrisPRO - lidhja automatike me peshoren "${name}". Lesheni nje here ne kompjuterin ku punon RLS1000.`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0'); iex ($s.Substring($s.IndexOf('#'+'PS-START#')+10))"`,
    'pause',
    'exit /b',
    '#PS-START#',
    "$ErrorActionPreference = 'Stop'",
    "$Dir = Join-Path $env:LOCALAPPDATA 'DrisPRO\\Peshorja'",
    'New-Item -ItemType Directory -Force -Path $Dir | Out-Null',
    `$Ps = Join-Path $Dir 'peshorja-${id}.ps1'`,
    `$Vbs = Join-Path $Dir 'peshorja-${id}.vbs'`,
    "Set-Content -LiteralPath $Ps -Encoding ASCII -Value @'",
    agent.trimEnd(),
    "'@",
    `Set-Content -LiteralPath $Vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $Ps + '""", 0, False')`,
    `$act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Vbs + '"')`,
    '$trg = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)',
    '$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)',
    `Register-ScheduledTask -TaskName 'DrisPRO peshorja ${id}' -Action $act -Trigger $trg -Settings $set -Force | Out-Null`,
    '& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Ps',
    `if ($LASTEXITCODE -eq 0) { Write-Host 'DrisPRO: peshorja "${name}" u lidh. Cmimet dhe artikujt e rinj shkojne vete ne skedarin e RLS1000 cdo minute.' -ForegroundColor Green }`,
    "else { Write-Host 'DrisPRO: lidhja u instalua, por skedari nuk u shkrua. Shikoni gabimin te faqja Cmimet te peshorja ne DrisPRO.' -ForegroundColor Yellow }",
  ]
  return lines.join('\r\n').replace(/\r?\n/g, '\r\n') + '\r\n'
}
