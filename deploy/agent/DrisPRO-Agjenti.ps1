<#
  DrisPRO · Agjenti i leximit (hapi 1: struktura e databazës)

  Lexon strukturën e databazës së programit të vjetër (p.sh. Logmicro në SQL Server):
  tabelat, kolonat, lidhjet dhe numrin e rreshtave, plus (nëse lejoni) disa rreshta shembull.
  VETËM LEXON: nuk shkruan, nuk fshin dhe nuk ndryshon asgjë në databazë.
  Nuk dërgon asgjë në internet: rezultati ruhet si skedar në këtë dosje.

  Si ekzekutohet: klikoni dy herë "Nis-Agjentin.bat" (si administrator i serverit),
  ose në PowerShell:
    powershell -ExecutionPolicy Bypass -File DrisPRO-Agjenti.ps1
  Opsione:
    -Server "localhost\INSTANCA"   serveri SQL (përndryshe e gjen vetë)
    -Database "EmriDatabazes"      databaza (përndryshe pyet)
    -User sa -Password ...         hyrje me përdorues SQL në vend të hyrjes së Windows-it
    -Samples 3                     sa rreshta shembull për tabelë (0 = asnjë)
#>
param(
  [string]$Server,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [int]$Samples = -1
)

$ErrorActionPreference = 'Stop'
$Version = '1.1'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$OutDir = Join-Path $here 'rezultati'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Write-Host ''; Read-Host 'Shtypni Enter për të mbyllur' | Out-Null; exit 1 }

function Choose([string]$title, [string[]]$options) {
  Say ''
  Say $title 'Cyan'
  for ($i = 0; $i -lt $options.Count; $i++) { Say ("  {0}. {1}" -f ($i + 1), $options[$i]) }
  while ($true) {
    $a = Read-Host 'Shkruani numrin'
    $n = 0
    if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) { return $options[$n - 1] }
    Say 'Numër i pavlefshëm, provoni përsëri.' 'Yellow'
  }
}

Add-Type -AssemblyName System.Data

function New-Connection([string]$db) {
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = $Server
  $b['Initial Catalog'] = $db
  $b['Application Name'] = 'DrisPRO-Agjenti (vetem lexim)'
  $b['Connect Timeout'] = 15
  try { $b['ApplicationIntent'] = 'ReadOnly' } catch { }
  if ($User) { $b['User ID'] = $User; $b['Password'] = $Password } else { $b['Integrated Security'] = $true }
  $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
  $c.Open()
  # lexim pa bllokuar punën e përditshme të programit
  $cmd = $c.CreateCommand(); $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 5000;'; [void]$cmd.ExecuteNonQuery()
  return $c
}

function Query($conn, [string]$sql) {
  if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw 'Agjenti ekzekuton vetëm SELECT.' }
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $cmd.CommandTimeout = 120
  $t = New-Object System.Data.DataTable
  $a = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
  [void]$a.Fill($t)
  return ,$t
}

function Rows($table) {
  $list = New-Object System.Collections.ArrayList
  foreach ($r in $table.Rows) {
    $o = [ordered]@{}
    foreach ($col in $table.Columns) {
      $v = $r[$col.ColumnName]
      if ($v -is [DBNull]) { $v = $null } elseif ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-dd HH:mm:ss') }
      $o[$col.ColumnName] = $v
    }
    [void]$list.Add([pscustomobject]$o)
  }
  return ,$list
}

Say ''
Say '==============================================================' 'Green'
Say " DrisPRO · Agjenti i leximit $Version" 'Green'
Say ' Vetëm lexon strukturën e databazës. Nuk ndryshon asgjë.' 'Green'
Say '==============================================================' 'Green'

# ---------------------------------------------------------------- 1. serveri SQL
if (-not $Server) {
  $found = @()
  foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL') {
    try {
      $p = Get-ItemProperty $key -ErrorAction Stop
      foreach ($prop in $p.PSObject.Properties) {
        if ($prop.Name -like 'PS*') { continue }
        $name = if ($prop.Name -eq 'MSSQLSERVER') { 'localhost' } else { "localhost\$($prop.Name)" }
        if ($found -notcontains $name) { $found += $name }
      }
    } catch { }
  }
  if ($found.Count -eq 0) {
    Say 'Nuk u gjet asnjë SQL Server në këtë kompjuter.' 'Yellow'
    $Server = Read-Host 'Shkruani adresën e serverit SQL (p.sh. localhost\SQLEXPRESS ose 192.168.1.10)'
  } elseif ($found.Count -eq 1) {
    $Server = $found[0]
  } else {
    $Server = Choose 'U gjetën disa instanca të SQL Server. Cilën përdor programi i vjetër?' $found
  }
}
Say ''
Say "Serveri SQL: $Server" 'Cyan'

# ---------------------------------------------------------------- 2. lidhja
try {
  $master = New-Connection 'master'
} catch {
  Say "Hyrja me llogarinë e Windows-it nuk funksionoi: $($_.Exception.Message)" 'Yellow'
  if (-not $User) {
    Say 'Provoni me një përdorues SQL (p.sh. sa). Fjalëkalimi nuk ruhet askund.'
    $User = Read-Host 'Përdoruesi SQL'
    $sec = Read-Host 'Fjalëkalimi' -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    try { $master = New-Connection 'master' } catch { Fail "Lidhja me serverin SQL dështoi: $($_.Exception.Message)" }
  } else { Fail "Lidhja me serverin SQL dështoi: $($_.Exception.Message)" }
}
$sqlVersion = (Query $master 'SELECT CAST(SERVERPROPERTY(''ProductVersion'') AS nvarchar(50)) AS v, CAST(SERVERPROPERTY(''Edition'') AS nvarchar(100)) AS e').Rows[0]
Say ("U lidh: SQL Server {0} ({1})" -f $sqlVersion.v, $sqlVersion.e) 'Green'

# ---------------------------------------------------------------- 3. databaza
$dbs = Rows (Query $master @'
SELECT d.name, d.create_date,
       CAST(SUM(CAST(f.size AS bigint)) * 8 / 1024 AS int) AS size_mb
  FROM sys.databases d JOIN sys.master_files f ON f.database_id = d.database_id
 WHERE d.database_id > 4 AND d.state_desc = 'ONLINE'
 GROUP BY d.name, d.create_date
 ORDER BY d.name
'@)
$master.Close()
if ($dbs.Count -eq 0) { Fail 'Në këtë server nuk ka databaza përveç atyre të sistemit.' }
if (-not $Database) {
  $labels = @($dbs | ForEach-Object { '{0}   ({1} MB, krijuar {2:dd.MM.yyyy})' -f $_.name, $_.size_mb, $_.create_date })
  $pick = Choose 'Cila është databaza e programit të vjetër? (zakonisht ka emrin e kompanisë ose të programit)' $labels
  $Database = $pick.Split(' ')[0]
}
Say ''
Say "Databaza: $Database" 'Cyan'

if ($Samples -lt 0) {
  Say ''
  Say 'Rreshtat shembull e ndihmojnë shumë kuptimin e kolonave (cila është çmimi, cila kosto, data...).'
  Say 'Ato mund të përmbajnë emra klientësh ose numra telefoni. Fjalëkalimet dhe tabelat e përdoruesve nuk lexohen kurrë.'
  Say 'Skedari mbetet në këtë dosje derisa ta dërgoni ju.'
  $a = Read-Host 'Të përfshihen 3 rreshta shembull për çdo tabelë? (P = po, J = jo) [P]'
  $Samples = if ($a -match '^[jJnN]') { 0 } else { 3 }
}

$db = New-Connection $Database
$started = Get-Date

# ---------------------------------------------------------------- 4. struktura
Say ''
Say 'Po lexoj tabelat...' 'Cyan'
$tables = Rows (Query $db @'
SELECT s.name AS [schema], t.name AS [table], SUM(p.rows) AS row_count, t.create_date, t.modify_date
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
 WHERE t.is_ms_shipped = 0
 GROUP BY s.name, t.name, t.create_date, t.modify_date
 ORDER BY SUM(p.rows) DESC
'@)
Say ("  {0} tabela" -f $tables.Count)

$columns = Rows (Query $db @'
SELECT c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS [table], c.COLUMN_NAME AS [column], c.ORDINAL_POSITION AS position,
       c.DATA_TYPE AS data_type, c.CHARACTER_MAXIMUM_LENGTH AS max_length, c.NUMERIC_PRECISION AS [precision], c.NUMERIC_SCALE AS scale,
       c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS [default]
  FROM INFORMATION_SCHEMA.COLUMNS c
  JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
 ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
'@)
Say ("  {0} kolona" -f $columns.Count)
# kolonat sipas tabelës, për t'i gjetur shpejt
$colsByTable = @{}
foreach ($c in $columns) {
  $k = "$($c.schema).$($c.table)"
  if (-not $colsByTable.ContainsKey($k)) { $colsByTable[$k] = New-Object System.Collections.ArrayList }
  [void]$colsByTable[$k].Add($c)
}

$keys = Rows (Query $db @'
SELECT s.name AS [schema], t.name AS [table], c.name AS [column], ic.key_ordinal AS position
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  JOIN sys.tables t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE i.is_primary_key = 1
 ORDER BY s.name, t.name, ic.key_ordinal
'@)

$foreign = Rows (Query $db @'
SELECT fk.name AS name, ps.name AS [schema], pt.name AS [table], pc.name AS [column],
       rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
  JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
  JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
'@)
Say ("  {0} lidhje midis tabelave" -f $foreign.Count)

$views = Rows (Query $db @'
SELECT s.name AS [schema], v.name AS [view]
  FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
 WHERE v.is_ms_shipped = 0
 ORDER BY s.name, v.name
'@)
Say ("  {0} pamje (views)" -f $views.Count)

# ---------------------------------------------------------------- 5. shembujt
$sampleData = [ordered]@{}
$skipTypes = @('image', 'varbinary', 'binary', 'timestamp', 'rowversion', 'geography', 'geometry', 'hierarchyid', 'xml', 'sql_variant')
# fjalëkalime, çelësa dhe të ngjashme nuk lexohen kurrë, as si shembull
$secretColumn = '(?i)(pass|pwd|_pw$|pw$|secret|token|api_?key|hash|salt|pin$|private|certificate|cert$|licen[cs]e_?key)'
# tabelat e përdoruesve dhe të lidhjeve lexohen vetëm si strukturë
$noSampleTables = '(?i)^(AD_USER|AD_CLIENT|AD_CONN|AD_SESSION|AD_PINSTANCE|CONSOLE_PARAMETERS|C_MOBILE_POS)'
if ($Samples -gt 0) {
  Say ''
  Say "Po lexoj $Samples rreshta shembull për tabelat që kanë të dhëna..." 'Cyan'
  $withRows = @($tables | Where-Object { $_.row_count -gt 0 } | Select-Object -First 500)
  $n = 0
  foreach ($t in $withRows) {
    $n++
    Write-Progress -Activity 'Rreshta shembull' -Status "$($t.schema).$($t.table)" -PercentComplete ([int](100 * $n / [math]::Max($withRows.Count, 1)))
    if ($t.table -match $noSampleTables) { continue }
    $cols = @($colsByTable["$($t.schema).$($t.table)"] | Where-Object { $_ -and $skipTypes -notcontains $_.data_type -and $_.column -notmatch $secretColumn })
    if ($cols.Count -eq 0) { continue }
    $list = ($cols | ForEach-Object { '[' + $_.column.Replace(']', ']]') + ']' }) -join ', '
    $sql = "SELECT TOP ($Samples) $list FROM [$($t.schema.Replace(']', ']]'))].[$($t.table.Replace(']', ']]'))] WITH (NOLOCK)"
    try {
      $rows = Rows (Query $db $sql)
      $clean = New-Object System.Collections.ArrayList
      foreach ($r in $rows) {
        $o = [ordered]@{}
        foreach ($p in $r.PSObject.Properties) {
          $v = $p.Value
          if ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-dd HH:mm:ss') }
          elseif ($v -is [decimal] -or $v -is [double] -or $v -is [single]) { $v = $v.ToString([Globalization.CultureInfo]::InvariantCulture) }
          elseif ($v -ne $null) { $v = [string]$v; if ($v.Length -gt 80) { $v = $v.Substring(0, 80) + '…' } }
          $o[$p.Name] = $v
        }
        [void]$clean.Add([pscustomobject]$o)
      }
      $sampleData["$($t.schema).$($t.table)"] = $clean
    } catch {
      $sampleData["$($t.schema).$($t.table)"] = "nuk u lexua: $($_.Exception.Message)"
    }
  }
  Write-Progress -Activity 'Rreshta shembull' -Completed
}
$db.Close()

# ---------------------------------------------------------------- 6. rezultati
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$safeDb = ($Database -replace '[^\w\-]', '_')
$jsonPath = Join-Path $OutDir "struktura-$safeDb-$stamp.json"
$txtPath = Join-Path $OutDir "permbledhja-$safeDb-$stamp.txt"

$report = [ordered]@{
  agent = "DrisPRO-Agjenti $Version"
  created_at = (Get-Date).ToString('s')
  computer = $env:COMPUTERNAME
  sql_server = [ordered]@{ instance = $Server; version = $sqlVersion.v; edition = $sqlVersion.e }
  database = $Database
  samples_per_table = $Samples
  tables = $tables
  columns = $columns
  primary_keys = $keys
  foreign_keys = $foreign
  views = $views
  samples = $sampleData
}
$json = $report | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding $false))

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("DrisPRO · struktura e databazës $Database ($Server)")
[void]$sb.AppendLine("Lexuar më $((Get-Date).ToString('dd.MM.yyyy HH:mm')) në $env:COMPUTERNAME")
[void]$sb.AppendLine("$($tables.Count) tabela · $($columns.Count) kolona · $($foreign.Count) lidhje · $($views.Count) pamje")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Tabelat me më shumë rreshta:')
foreach ($t in ($tables | Select-Object -First 60)) {
  $cn = @($colsByTable["$($t.schema).$($t.table)"] | Where-Object { $_ } | ForEach-Object { $_.column })
  $shown = ($cn | Select-Object -First 14) -join ', '
  if ($cn.Count -gt 14) { $shown += ", … (+$($cn.Count - 14))" }
  [void]$sb.AppendLine(('  {0,-40} {1,10} rreshta   {2}' -f "$($t.schema).$($t.table)", $t.row_count, $shown))
}
[IO.File]::WriteAllText($txtPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding $true))

$secs = [int]((Get-Date) - $started).TotalSeconds
Say ''
Say '==============================================================' 'Green'
Say " Gati për $secs sekonda. Nuk u ndryshua asgjë në databazë." 'Green'
Say '==============================================================' 'Green'
Say ''
Say 'U krijuan dy skedarë në dosjen "rezultati":'
Say "  $jsonPath" 'White'
Say "  $txtPath" 'White'
Say ''
Say 'Dërgojani skedarin .json zhvilluesit (DrisPRO). Ai tregon vetëm strukturën'
Say ($(if ($Samples -gt 0) { "dhe $Samples rreshta shembull për tabelë." } else { 'pa asnjë rresht të dhënash.' }))
Say ''
try { Start-Process explorer.exe $OutDir } catch { }
Read-Host 'Shtypni Enter për të mbyllur' | Out-Null
