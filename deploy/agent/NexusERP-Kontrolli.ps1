<#
  NexusERP · Kontrolli i Logmicro-s (njëherë, vetëm numëron)

  Shikon çfarë tabelash ka Logmicro me të dhëna që NexusERP ende nuk i merr:
  porositë te furnitorët, zbritjet dhe aksionet, lotet dhe skadimet, plani kontabël,
  bankat, asetet, pagat, mbylljet e arkës.
  VETËM NUMËRON rreshta dhe lexon emrat e tabelave e kolonave. Nuk lexon emra klientësh,
  çmime apo fjalëkalime dhe nuk dërgon asgjë: rezultati shkruhet në kontrolli.txt këtu.

  Si nisët: klikoni dy herë "Nis-Kontrollin.bat". Zgjat 1-2 minuta.
#>
param([string]$Database)

$ErrorActionPreference = 'Stop'
$Version = '1.0'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$cfgPath = Join-Path $here 'lidhja.json'
$outPath = Join-Path $here 'kontrolli.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Out([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color; $lines.Add($text) }

if (-not (Test-Path $cfgPath)) { Write-Host 'lidhja.json mungon. Nisni njëherë Nis-Lidhjen.bat, pastaj këtë.' -ForegroundColor Red; exit 1 }
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$db = if ($Database) { $Database } else { [string]$cfg.database }

Add-Type -AssemblyName System.Data
$b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b['Data Source'] = $cfg.server; $b['Initial Catalog'] = $db
$b['Application Name'] = 'NexusERP-Kontrolli (vetem lexim)'; $b['Connect Timeout'] = 15
try { $b['ApplicationIntent'] = 'ReadOnly' } catch { }
if ($cfg.sql_user) { $b['User ID'] = $cfg.sql_user; $b['Password'] = $cfg.sql_password } else { $b['Integrated Security'] = $true }
$conn = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
$conn.Open()
$c0 = $conn.CreateCommand(); $c0.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 10000;'; [void]$c0.ExecuteNonQuery()

function Query([string]$sql) {
  if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw 'Vetëm SELECT lejohet.' }
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 300
  $t = New-Object System.Data.DataTable
  [void](New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($t)
  return ,$t
}
function Try-Query([string]$sql) { try { return Query $sql } catch { return $null } }
function D($v) { if ($v -is [DBNull] -or $null -eq $v) { return '-' }; return ([datetime]$v).ToString('yyyy-MM-dd') }

# rows per table from the catalogue (fast, no scan) and the columns of every table
$rows = @{}
foreach ($r in (Query "SELECT t.name AS t, SUM(p.rows) AS n FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) GROUP BY t.name").Rows) { $rows[[string]$r.t] = [long]$r.n }
$cols = @{}
foreach ($r in (Query "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS").Rows) {
  $t = [string]$r.t; if (-not $cols.ContainsKey($t)) { $cols[$t] = New-Object System.Collections.Generic.List[string] }; $cols[$t].Add([string]$r.c)
}
function Has([string]$t, [string]$c) { return $cols.ContainsKey($t) -and $cols[$t].Contains($c) }

# one line per table: rows, rows touched in the last year, last change
function Table([string]$t, [string]$where = '') {
  if (-not $rows.ContainsKey($t)) { return }
  $n = $rows[$t]
  $extra = ''
  if ($n -gt 0 -and (Has $t 'UPDATED')) {
    $w = if ($where) { "WHERE $where" } else { '' }
    $q = Try-Query "SELECT COUNT(*) AS n, SUM(CASE WHEN UPDATED >= DATEADD(year, -1, GETDATE()) THEN 1 ELSE 0 END) AS y, MAX(UPDATED) AS m FROM $t WITH (NOLOCK) $w"
    if ($q) { $r = $q.Rows[0]; $extra = "  ndryshuar 12 muajt e fundit: $($r.y)  e fundit: $(D $r.m)"; if ($where) { $extra = "  [$where] $($r.n)" + $extra } }
  }
  Out ("  {0,-34} {1,10} rreshta{2}" -f $t, $n, $extra) $(if ($n -gt 0) { 'White' } else { 'DarkGray' })
}
function Section([string]$title, [string[]]$patterns) {
  Out ''; Out "== $title" 'Cyan'
  $found = @($rows.Keys | Where-Object { $name = $_; $patterns | Where-Object { $name -like $_ } } | Sort-Object)
  if (-not $found.Count) { Out '  (asnjë tabelë)' 'DarkGray'; return }
  foreach ($t in $found) { Table $t }
}
function Breakdown([string]$title, [string]$sql) {
  $q = Try-Query $sql
  if ($q -and $q.Rows.Count) { Out ("  {0}: {1}" -f $title, (($q.Rows | ForEach-Object { ($_.ItemArray | ForEach-Object { if ($_ -is [DBNull]) { '-' } else { "$_".Trim() } }) -join '/' }) -join ', ')) 'Gray' }
}

Out "NexusERP Kontrolli $Version · $db · $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Out "Tabela gjithsej: $($rows.Count), me të dhëna: $(@($rows.Values | Where-Object { $_ -gt 0 }).Count)"

Out ''; Out '== 1. Porositë te furnitorët' 'Cyan'
if (Has 'C_ORDER' 'ISSOTRX') {
  Breakdown 'C_ORDER blerje sipas statusit' "SELECT ISNULL(DOCSTATUS,'-') AS s, COUNT(*) AS n FROM C_ORDER WITH (NOLOCK) WHERE ISSOTRX = 'N' GROUP BY DOCSTATUS ORDER BY 2 DESC"
  Breakdown 'C_ORDER blerje 12 muajt e fundit' "SELECT ISNULL(DOCSTATUS,'-') AS s, COUNT(*) AS n FROM C_ORDER WITH (NOLOCK) WHERE ISSOTRX = 'N' AND DATEORDERED >= DATEADD(year,-1,GETDATE()) GROUP BY DOCSTATUS ORDER BY 2 DESC"
  if (Has 'C_ORDERLINE' 'QTYDELIVERED') {
    Breakdown 'Rreshta blerjeje ende pa ardhur (porositur > pranuar)' "SELECT COUNT(*) AS n FROM C_ORDERLINE l WITH (NOLOCK) JOIN C_ORDER o WITH (NOLOCK) ON o.C_ORDER_ID = l.C_ORDER_ID WHERE o.ISSOTRX = 'N' AND o.DOCSTATUS IN ('IP','CO','DR') AND l.QTYORDERED > ISNULL(l.QTYDELIVERED,0) AND o.DATEORDERED >= DATEADD(month,-6,GETDATE())"
  }
}
if ((Has 'C_DOCTYPE' 'NAME') -and (Has 'C_ORDER' 'C_DOCTYPE_ID')) {
  Breakdown 'C_ORDER sipas llojit (12 muaj)' "SELECT TOP 25 RTRIM(ISNULL(d.NAME,'-')) AS lloji, o.ISSOTRX, COUNT(*) AS n FROM C_ORDER o WITH (NOLOCK) LEFT JOIN C_DOCTYPE d WITH (NOLOCK) ON d.C_DOCTYPE_ID = o.C_DOCTYPE_ID WHERE o.DATEORDERED >= DATEADD(year,-1,GETDATE()) GROUP BY d.NAME, o.ISSOTRX ORDER BY 3 DESC"
}
Section 'Requisition / furnizim' @('M_REQUISITION*', 'C_RFQ*', '*PURCHASE*')

Section '2. Zbritjet dhe aksionet' @('M_DISCOUNT*', '*PROMO*', '*AKSION*', '*ACTION*', 'C_BP_DISCOUNT*', '*DISCOUNT*', 'M_PRICELIST_VERSION', 'M_PRODUCTPRICE*')
if (Has 'M_PRICELIST_VERSION' 'VALIDFROM') { Breakdown 'Versione çmimesh sipas datës së fillimit (12 muaj)' "SELECT COUNT(*) AS n, MIN(VALIDFROM) AS nga, MAX(VALIDFROM) AS deri FROM M_PRICELIST_VERSION WITH (NOLOCK) WHERE VALIDFROM >= DATEADD(year,-1,GETDATE())" }
if (Has 'C_BPARTNER' 'M_DISCOUNTSCHEMA_ID') { Breakdown 'Subjekte me skemë zbritjeje' "SELECT COUNT(*) AS n FROM C_BPARTNER WITH (NOLOCK) WHERE M_DISCOUNTSCHEMA_ID IS NOT NULL" }
if (Has 'C_BPARTNER' 'FLATDISCOUNT') { Breakdown 'Subjekte me zbritje fikse' "SELECT COUNT(*) AS n FROM C_BPARTNER WITH (NOLOCK) WHERE ISNULL(FLATDISCOUNT,0) <> 0" }

Section '3. Lotet dhe skadimet' @('M_LOT*', 'M_ATTRIBUTE*', '*EXPIR*', '*SKAD*', '*SERNO*')
if (Has 'M_ATTRIBUTESETINSTANCE' 'GUARANTEEDATE') { Breakdown 'Instanca me datë skadimi (gjithsej / në të ardhmen)' "SELECT COUNT(*) AS n, SUM(CASE WHEN GUARANTEEDATE >= GETDATE() THEN 1 ELSE 0 END) AS ardhme FROM M_ATTRIBUTESETINSTANCE WITH (NOLOCK) WHERE GUARANTEEDATE IS NOT NULL" }
if (Has 'M_STORAGE' 'M_ATTRIBUTESETINSTANCE_ID') { Breakdown 'Rreshta stoku me lot (sasi <> 0)' "SELECT COUNT(*) AS n FROM M_STORAGE WITH (NOLOCK) WHERE ISNULL(M_ATTRIBUTESETINSTANCE_ID,0) <> 0 AND QTYONHAND <> 0" }

Section '4. Plani kontabël dhe bankat' @('C_ELEMENT*', 'C_ACCTSCHEMA*', 'C_VALIDCOMBINATION', 'C_BANK*', 'C_PERIOD', 'C_YEAR', 'GL_JOURNAL*', 'C_TAX', 'C_TAXCATEGORY')
Section '5. Asetet' @('A_ASSET*', '*ASSET*')
Section '6. Pagat' @('HR_*', '*PAYROLL*', '*PAGA*')
Section '7. Arka dhe mbylljet (Z)' @('C_CASH*', 'C_POS*', '*FISCAL*', '*FISK*', '*ZREPORT*', '*SHIFT*', '*TURN*')
Section 'Fatura dhe pranime (për krahasim)' @('C_INVOICE*', 'M_INOUT*', 'C_ALLOCATION*', 'M_MATCH*')

# columns that hint at expiry, discount or promotion anywhere else
Out ''; Out '== Kolona me emra të tillë në tabela të tjera me të dhëna' 'Cyan'
$hits = foreach ($t in ($cols.Keys | Sort-Object)) {
  if (-not $rows.ContainsKey($t) -or $rows[$t] -eq 0) { continue }
  $m = @($cols[$t] | Where-Object { $_ -match 'EXPIR|GUARANTEE|SKAD|DISCOUNT|PROMO|AKSION|LOT$|^LOT|BESTBEFORE' })
  if ($m.Count) { "  {0,-34} {1}" -f $t, ($m -join ', ') }
}
if ($hits) { $hits | Select-Object -First 80 | ForEach-Object { Out $_ } } else { Out '  (asnjë)' 'DarkGray' }

# the 40 biggest tables, to see whatever else is in use
Out ''; Out '== 40 tabelat më të mëdha' 'Cyan'
$rows.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 40 | ForEach-Object { Out ("  {0,-34} {1,10}" -f $_.Key, $_.Value) }

$conn.Close()
[IO.File]::WriteAllLines($outPath, $lines, (New-Object System.Text.UTF8Encoding $true))
Write-Host ''
Write-Host "U RUAJT te $outPath" -ForegroundColor Green
Write-Host 'Kopjojeni kontrolli.txt në kompjuterin tuaj (Documents\NexusERP\Agjenti) dhe tregojini Claude-it.' -ForegroundColor Green
