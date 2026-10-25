<#
  DrisPRO · Historiku nga Logmicro (njëherë, mund të ndalet dhe të vazhdojë)

  Dërgon në DrisPRO gjithë historikun e Logmicro-s, si arkiv që nuk prek stokun,
  kontabilitetin e ri apo ATK-në:
    - gjendjet mujore të çdo konte (nga FACT_ACCT)
    - barkodet e tjera, kodet e furnitorëve, nivelet e riporositjes
    - punonjësit dhe prezenca
    - pagesat (C_PAYMENT) dhe arka (C_CASHLINE)
    - inventarizimet dhe transferimet e kaluara
    - çdo shitje, kupon, blerje dhe kthim (C_ORDER) me rreshtat
  VETËM LEXON nga Logmicro. Përdor të njëjtin lidhja.json si lidhja live.
  Mund ta mbyllni kur të doni: herën tjetër vazhdon aty ku mbeti (historiku-gjendja.json).

  Si nisët: klikoni dy herë "Nis-Historikun.bat".
  Opsione:  -Database LM2025   (një vit tjetër; secili vit ka databazën e vet)
            -Restart           (fillo nga e para për këtë databazë)
#>
param([string]$Database, [switch]$Restart)

$ErrorActionPreference = 'Stop'
$Version = '1.2'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$cfgPath = Join-Path $here 'lidhja.json'
$statePath = Join-Path $here 'historiku-gjendja.json'
$logPath = Join-Path $here 'historiku.log'
$inv = [Globalization.CultureInfo]::InvariantCulture
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Log([string]$text, [string]$color = 'Gray') {
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $text
  Write-Host $line -ForegroundColor $color
  try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch { }
}

if (-not (Test-Path $cfgPath)) { Log 'lidhja.json mungon. Nisni njëherë Nis-Lidhjen.bat, pastaj këtë.' 'Red'; exit 1 }
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($k in 'url', 'anon_key', 'sync_key', 'server', 'database') { if (-not $cfg.$k) { Log "lidhja.json: mungon '$k' - nisni njëherë Nis-Lidhjen.bat" 'Red'; exit 1 } }
$db = if ($Database) { $Database } else { [string]$cfg.database }
$url = ($cfg.url.TrimEnd('/')) + '/rest/v1/rpc/sync_history'

# ---------------------------------------------------------------- gjendja (ku mbeti)
$all = @{}
if (Test-Path $statePath) { try { $j = Get-Content $statePath -Raw | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $h = @{}; foreach ($q in $p.Value.PSObject.Properties) { $h[$q.Name] = $q.Value }; $all[$p.Name] = $h } } catch { } }
if ($Restart -or -not $all.ContainsKey($db)) { $all[$db] = @{} }
$st = $all[$db]
function Save-State { [IO.File]::WriteAllText($statePath, ($all | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding $false)) }

# ---------------------------------------------------------------- SQL (vetëm lexim)
Add-Type -AssemblyName System.Data
function New-Connection {
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = $cfg.server; $b['Initial Catalog'] = $db
  $b['Application Name'] = 'DrisPRO-Historiku (vetem lexim)'; $b['Connect Timeout'] = 15
  try { $b['ApplicationIntent'] = 'ReadOnly' } catch { }
  if ($cfg.sql_user) { $b['User ID'] = $cfg.sql_user; $b['Password'] = $cfg.sql_password } else { $b['Integrated Security'] = $true }
  $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
  $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 10000;'; [void]$cmd.ExecuteNonQuery()
  return $c
}
function Query($conn, [string]$sql) {
  if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw 'Vetëm SELECT lejohet.' }
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 900
  $t = New-Object System.Data.DataTable
  [void](New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($t)
  return ,$t
}
function Str($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return ([string]$v).Trim() }
function Num($v, [int]$dec = 4) { if ($v -is [DBNull] -or $null -eq $v -or "$v" -eq '') { return '' }; return ([math]::Round([decimal]$v, $dec)).ToString('0.####', $inv) }
function Day($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return ([datetime]$v).ToString('yyyy-MM-dd', $inv) }
function Stamp($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return ([datetime]$v).ToString('yyyy-MM-ddTHH:mm:ss', $inv) }
$skipStatus = "ISNULL(DOCSTATUS, 'CO') NOT IN ('VO', 'RE') AND ISNULL(ISACTIVE, 'Y') = 'Y'"
function Show-Statuses($conn, [string]$table) {
  $t = Query $conn "SELECT ISNULL(DOCSTATUS, '-') AS s, COUNT(*) AS n FROM $table WITH (NOLOCK) GROUP BY DOCSTATUS ORDER BY COUNT(*) DESC"
  Log ("  {0} sipas statusit: {1}" -f $table, (($t.Rows | ForEach-Object { "$($_.s)=$($_.n)" }) -join ', ')) 'DarkGray'
}
function Has-Table($conn, [string]$name) { return (Query $conn "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '$name'").Rows[0].n -gt 0 }

# ---------------------------------------------------------------- dërgimi
function Send([string]$kind, $rows) {
  if (-not $rows -or $rows.Count -eq 0) { return @{ saved = 0; skipped = 0 } }
  $body = @{ p_key = $cfg.sync_key; p_kind = $kind; p_rows = @($rows) } | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  for ($try = 1; $try -le 5; $try++) {
    try {
      return Invoke-RestMethod -Method Post -Uri $url -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 `
               -Headers @{ apikey = $cfg.anon_key; Authorization = "Bearer $($cfg.anon_key)" }
    } catch {
      $detail = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
      if ($try -eq 5) { throw "DrisPRO: $detail" }
      Log "  provë $try dështoi ($detail), provoj përsëri…" 'Yellow'
      Start-Sleep -Seconds (5 * $try)
    }
  }
}
# a list in small pieces; returns how many were saved
function Send-All([string]$kind, $rows, [int]$size) {
  $saved = 0; $skipped = 0
  for ($i = 0; $i -lt $rows.Count; $i += $size) {
    [object[]]$part = @($rows[$i..([math]::Min($i + $size, $rows.Count) - 1)])
    $r = Send $kind $part
    $saved += [int]$r.saved; $skipped += [int]$r.skipped
  }
  return @{ saved = $saved; skipped = $skipped }
}
function Bar([string]$name) { if ($st[$name]) { Log "$name - bërë më parë, kalohet" 'DarkGray'; return $false }; Log "$name…" 'Cyan'; return $true }
function Done([string]$name, $r) { $st[$name] = $true; Save-State; Log ("  {0}: {1} u ruajtën{2}" -f $name, $r.saved, $(if ($r.skipped) { ", $($r.skipped) u kaluan" } else { '' })) 'Green' }
function Barcode([string]$c) {
  $c = $c -replace '\s', ''
  if ($c.Length -eq 14 -and $c.StartsWith('0')) { $c = $c.Substring(1) }
  if ($c -notmatch '^\d{8}$|^\d{12,13}$') { return '' }
  return $c
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host " DrisPRO · Historiku nga Logmicro $Version" -ForegroundColor Green
Write-Host " $($cfg.server) / $db → $($cfg.url)" -ForegroundColor Green
Write-Host ' Vetëm lexon. Mund ta mbyllni; herën tjetër vazhdon aty ku mbeti.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
$started = Get-Date
$conn = New-Connection
try {
  # ------------------------------------------------------------ 1. kontabiliteti: gjendjet mujore
  if (Bar 'kontabiliteti4') {
    $pt = Query $conn "SELECT ISNULL(POSTINGTYPE, '-') AS p, COUNT(*) AS n FROM FACT_ACCT WITH (NOLOCK) GROUP BY POSTINGTYPE"
    Log ("  FACT_ACCT sipas llojit: {0}" -f (($pt.Rows | ForEach-Object { "$($_.p)=$($_.n)" }) -join ', ')) 'DarkGray'
    # several ledgers would count the same entry twice: keep the main one
    $sc = Query $conn "SELECT TOP 1 C_ACCTSCHEMA_ID AS id, COUNT(*) AS n FROM FACT_ACCT WITH (NOLOCK) GROUP BY C_ACCTSCHEMA_ID ORDER BY COUNT(*) DESC"
    $schema = $(if ($sc.Rows.Count) { [long]$sc.Rows[0].id } else { 0 })
    $hasA = @($pt.Rows | Where-Object { (Str $_.p) -eq 'A' }).Count -gt 0
    $ptFilter = $(if ($hasA) { "AND f.POSTINGTYPE = 'A'" } else { '' })
    Log ("  libri $schema, " + $(if ($hasA) { "vetëm lloji 'A'" } else { 'të gjitha llojet' })) 'DarkGray'
    $t = Query $conn @"
SELECT ev.VALUE AS code, MAX(ev.NAME) AS name, CONVERT(char(7), f.DATEACCT, 126) AS period, SUM(f.AMTACCTDR) AS debit, SUM(f.AMTACCTCR) AS credit
  FROM FACT_ACCT f WITH (NOLOCK) JOIN C_ELEMENTVALUE ev WITH (NOLOCK) ON ev.C_ELEMENTVALUE_ID = f.ACCOUNT_ID
 WHERE f.C_ACCTSCHEMA_ID = $schema $ptFilter AND f.DATEACCT IS NOT NULL
 GROUP BY ev.VALUE, CONVERT(char(7), f.DATEACCT, 126)
"@
    $rows = @($t.Rows | ForEach-Object { @{ account = (Str $_.code); name = (Str $_.name); period = (Str $_.period); debit = (Num $_.debit 2); credit = (Num $_.credit 2) } })
    Log "  $($rows.Count) konto-muaj të lexuara" 'DarkGray'
    Done 'kontabiliteti4' (Send-All 'balances' $rows 2000)
  }

  # ------------------------------------------------------------ 2. artikujt: barkodet, furnitorët, riporositja
  if (Bar 'barkodet') {
    $sql = "SELECT p.VALUE AS sku, x.code FROM M_PRODUCT p WITH (NOLOCK) CROSS APPLY (VALUES (p.UPC), (p.UPC1), (p.UPC2), (p.UPC3), (p.UPC4)) x(code) WHERE x.code IS NOT NULL AND LEN(x.code) >= 8"
    if (Has-Table $conn 'M_PRODUCT_UPC') { $sql += " UNION SELECT p.VALUE, u.UPC FROM M_PRODUCT_UPC u WITH (NOLOCK) JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = u.M_PRODUCT_ID WHERE u.ISACTIVE = 'Y'" }
    $t = Query $conn $sql
    $rows = @($t.Rows | ForEach-Object { $c = Barcode (Str $_.code); if ($c) { @{ sku = (Str $_.sku); barcode = $c } } })
    Done 'barkodet' (Send-All 'barcodes' $rows 1000)
  }
  if (Bar 'furnitoret') {
    $t = Query $conn @"
SELECT p.VALUE AS sku, bp.VALUE AS vendor, x.VENDORPRODUCTNO AS vsku, x.DESCRIPTION AS name, p.PRICECOST AS price
  FROM C_BPARTNER_PRODUCT x WITH (NOLOCK)
  JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = x.M_PRODUCT_ID
  JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = x.C_BPARTNER_ID
 WHERE x.ISACTIVE = 'Y'
"@
    $rows = @($t.Rows | ForEach-Object { @{ sku = (Str $_.sku); vendor = (Str $_.vendor); vendor_sku = (Str $_.vsku); name = (Str $_.name); price = (Num $_.price 4) } })
    Done 'furnitoret' (Send-All 'vendor_products' $rows 1000)
  }
  if (Bar 'riporositja') {
    $t = Query $conn @"
SELECT p.VALUE AS sku, w.VALUE AS wh, r.LEVEL_MIN AS mn, r.LEVEL_MAX AS mx
  FROM M_REPLENISH r WITH (NOLOCK)
  JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = r.M_PRODUCT_ID
  JOIN M_WAREHOUSE w WITH (NOLOCK) ON w.M_WAREHOUSE_ID = r.M_WAREHOUSE_ID
 WHERE r.ISACTIVE = 'Y' AND (r.LEVEL_MIN > 0 OR r.LEVEL_MAX > 0)
"@
    $rows = @($t.Rows | ForEach-Object { $mn = [decimal]$(if ($_.mn -is [DBNull]) { 0 } else { $_.mn }); $mx = [decimal]$(if ($_.mx -is [DBNull]) { 0 } else { $_.mx })
      @{ sku = (Str $_.sku); warehouse = (Str $_.wh); min = (Num $mn 3); max = (Num ([math]::Max($mn, $mx)) 3) } })
    Done 'riporositja' (Send-All 'reorder' $rows 1000)
  }

  # ------------------------------------------------------------ 3. punonjësit dhe prezenca
  # Logmicro gives every employee CODE '1', so the partner id is the only unique key
  $hasClock = Has-Table $conn 'HR_CHECKINOUT'
  if ((Has-Table $conn 'HR_EMPLOYEE') -and (Bar 'punonjesit3')) {
    $clock = $(if ($hasClock) { "OR bp.C_BPARTNER_ID IN (SELECT C_BPARTNER_ID FROM HR_CHECKINOUT WITH (NOLOCK) WHERE C_BPARTNER_ID IS NOT NULL)" } else { '' })
    $t = Query $conn @"
SELECT 'LM' + CAST(bp.C_BPARTNER_ID AS varchar(20)) AS code, COALESCE(e.NAME, bp.NAME) AS name, CASE WHEN e.NAME IS NULL THEN bp.NAME2 ELSE e.NAME2 END AS name2,
       e.NATIONALCODE AS personal, e.BIRTHDATE AS birth, e.GENDER AS gender, e.STARTDATE AS sd, e.ENDDATE AS ed,
       CASE WHEN bp.ISACTIVE = 'N' OR e.ISACTIVE = 'N' THEN 'N' ELSE 'Y' END AS active, bp.VALUE AS partner
  FROM C_BPARTNER bp WITH (NOLOCK)
  OUTER APPLY (SELECT TOP 1 * FROM HR_EMPLOYEE x WITH (NOLOCK) WHERE x.C_BPARTNER_ID = bp.C_BPARTNER_ID ORDER BY x.HR_EMPLOYEE_ID DESC) e
 WHERE bp.ISEMPLOYEE = 'Y' $clock
"@
    Log "  $($t.Rows.Count) punonjës në Logmicro" 'DarkGray'
    $rows = @($t.Rows | ForEach-Object {
      $n = Str $_.name; $n2 = Str $_.name2
      if ($n2) { $first = $n; $last = $n2 } else { $i = $n.LastIndexOf(' '); if ($i -gt 0) { $first = $n.Substring(0, $i); $last = $n.Substring($i + 1) } else { $first = ''; $last = $n } }
      @{ code = (Str $_.code); first = $first; last = $last; personal = (Str $_.personal); birth = (Day $_.birth); gender = (Str $_.gender).ToLower()
         start = (Day $_.sd); end = (Day $_.ed); active = ((Str $_.active) -ne 'N'); partner = (Str $_.partner) } })
    Done 'punonjesit3' (Send-All 'employees' $rows 500)
  }
  if ($hasClock -and (Bar 'prezenca4')) {
    $t = Query $conn @"
SELECT 'LM' + CAST(c.C_BPARTNER_ID AS varchar(20)) AS emp, CAST(c.CHECKTIME AS date) AS d, MIN(c.CHECKTIME) AS i, MAX(c.CHECKTIME) AS o
  FROM HR_CHECKINOUT c WITH (NOLOCK)
 WHERE ISNULL(c.ISACTIVE, 'Y') = 'Y' AND c.CHECKTIME IS NOT NULL AND c.C_BPARTNER_ID IS NOT NULL
 GROUP BY c.C_BPARTNER_ID, CAST(c.CHECKTIME AS date)
"@
    Log "  $($t.Rows.Count) ditë pune në Logmicro" 'DarkGray'
    $rows = @($t.Rows | ForEach-Object { @{ employee = (Str $_.emp); date = (Day $_.d); in = (Stamp $_.i); out = $(if ([datetime]$_.o -gt [datetime]$_.i) { Stamp $_.o } else { '' }) } })
    Done 'prezenca4' (Send-All 'attendance' $rows 500)
  }

  # ------------------------------------------------------------ 4. pagesat dhe arka (me copa, vazhdon aty ku mbeti)
  if (-not $st['pagesat2_bere']) {
    Log 'pagesat (C_PAYMENT)…' 'Cyan'
    Show-Statuses $conn 'C_PAYMENT'
    $total = 0
    while ($true) {
      $last = [long]$(if ($st['pagesat2']) { $st['pagesat2'] } else { 0 })
      $t = Query $conn @"
SELECT TOP 2000 p.C_PAYMENT_ID AS id, p.DOCUMENTNO AS num, COALESCE(p.DATETRX, p.DATEACCT) AS d, p.ISRECEIPT AS rec, p.PAYAMT AS amt, p.C_BANKACCOUNT_ID AS bank,
       bp.VALUE AS pcode, bp.NAME AS pname, COALESCE(ba.DESCRIPTION, ba.ACCOUNTNO) AS book, o.DOCUMENTNO AS doc, p.DESCRIPTION AS descr
  FROM C_PAYMENT p WITH (NOLOCK)
  LEFT JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = p.C_BPARTNER_ID
  LEFT JOIN C_BANKACCOUNT ba WITH (NOLOCK) ON ba.C_BANKACCOUNT_ID = p.C_BANKACCOUNT_ID
  LEFT JOIN C_ORDER o WITH (NOLOCK) ON o.C_ORDER_ID = COALESCE(p.C_ORDER_ID, p.C_INVOICE_ID)
 WHERE p.C_PAYMENT_ID > $last AND ISNULL(p.DOCSTATUS, 'CO') NOT IN ('VO', 'RE') AND ISNULL(p.ISACTIVE, 'Y') = 'Y' AND COALESCE(p.DATETRX, p.DATEACCT) IS NOT NULL
 ORDER BY p.C_PAYMENT_ID
"@
      if ($t.Rows.Count -eq 0) { break }
      $rows = @($t.Rows | ForEach-Object { $a = [decimal]$_.amt; if ((Str $_.rec) -ne 'Y') { $a = -$a }
        @{ ext_id = "P:${db}:$($_.id)"; kind = $(if ($_.bank -is [DBNull]) { 'payment' } else { 'bank' }); number = (Str $_.num); date = (Day $_.d)
           partner = (Str $_.pcode); partner_name = (Str $_.pname); amount = (Num $a 2); book = (Str $_.book); document = (Str $_.doc); description = (Str $_.descr) } })
      [void](Send-All 'payments' $rows 1000)
      $total += $rows.Count
      $st['pagesat2'] = [string]($t.Rows | ForEach-Object { [long]$_.id } | Measure-Object -Maximum).Maximum; Save-State
      Log "  pagesat: $total" 'DarkGray'
    }
    $st['pagesat2_bere'] = $true; Save-State; Log "  pagesat: $total gjithsej" 'Green'
  }
  if (-not $st['arka_bere']) {
    Log 'arka (C_CASHLINE)…' 'Cyan'
    $total = 0
    while ($true) {
      $last = [long]$(if ($st['arka']) { $st['arka'] } else { 0 })
      $t = Query $conn @"
SELECT TOP 3000 l.C_CASHLINE_ID AS id, c.NAME AS num, COALESCE(l.DATETRX, c.STATEMENTDATE) AS d, l.AMOUNT AS amt, cb.NAME AS book,
       bp.VALUE AS pcode, bp.NAME AS pname, o.DOCUMENTNO AS doc, l.DESCRIPTION AS descr
  FROM C_CASHLINE l WITH (NOLOCK)
  JOIN C_CASH c WITH (NOLOCK) ON c.C_CASH_ID = l.C_CASH_ID
  LEFT JOIN C_CASHBOOK cb WITH (NOLOCK) ON cb.C_CASHBOOK_ID = c.C_CASHBOOK_ID
  LEFT JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = l.C_BPARTNER_ID
  LEFT JOIN C_ORDER o WITH (NOLOCK) ON o.C_ORDER_ID = l.C_INVOICE_ID
 WHERE l.C_CASHLINE_ID > $last AND l.ISACTIVE = 'Y'
 ORDER BY l.C_CASHLINE_ID
"@
      if ($t.Rows.Count -eq 0) { break }
      $rows = @($t.Rows | Where-Object { -not ($_.d -is [DBNull]) } | ForEach-Object {
        @{ ext_id = "C:${db}:$($_.id)"; kind = 'cash'; number = (Str $_.num); date = (Day $_.d); partner = (Str $_.pcode); partner_name = (Str $_.pname)
           amount = (Num $_.amt 2); book = (Str $_.book); document = (Str $_.doc); description = (Str $_.descr) } })
      [void](Send-All 'payments' $rows 1500)
      $total += $rows.Count
      $st['arka'] = [string]($t.Rows | ForEach-Object { [long]$_.id } | Measure-Object -Maximum).Maximum; Save-State
      Log "  arka: $total" 'DarkGray'
    }
    $st['arka_bere'] = $true; Save-State; Log "  arka: $total gjithsej" 'Green'
  }

  # ------------------------------------------------------------ 5. inventarizimet dhe transferimet
  if (Bar 'inventarizimet2') {
    $h = Query $conn "SELECT i.M_INVENTORY_ID AS id, i.DOCUMENTNO AS num, i.MOVEMENTDATE AS d, w.VALUE AS wh, i.DESCRIPTION AS descr FROM M_INVENTORY i WITH (NOLOCK) LEFT JOIN M_WAREHOUSE w WITH (NOLOCK) ON w.M_WAREHOUSE_ID = i.M_WAREHOUSE_ID WHERE ISNULL(i.DOCSTATUS, 'CO') NOT IN ('VO', 'RE') AND ISNULL(i.ISACTIVE, 'Y') = 'Y'"
    $l = Query $conn "SELECT il.M_INVENTORY_ID AS id, il.LINE AS line, p.VALUE AS sku, p.NAME AS name, il.QTYBOOK AS qb, il.QTYCOUNT AS qc, il.PRICEACTUAL AS price FROM M_INVENTORYLINE il WITH (NOLOCK) JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = il.M_PRODUCT_ID WHERE il.ISACTIVE = 'Y'"
    $byDoc = @{}; foreach ($x in $l.Rows) { $k = [string]$x.id; if (-not $byDoc[$k]) { $byDoc[$k] = New-Object System.Collections.ArrayList }
      $q = [decimal]$(if ($x.qc -is [DBNull]) { 0 } else { $x.qc }) - [decimal]$(if ($x.qb -is [DBNull]) { 0 } else { $x.qb })
      [void]$byDoc[$k].Add(@{ line = [int]$x.line; sku = (Str $x.sku); name = (Str $x.name); qty = (Num $q 4); price = (Num $x.price 4) }) }
    $rows = @($h.Rows | Where-Object { -not ($_.d -is [DBNull]) } | ForEach-Object { @{ ext_id = "INV:${db}:$($_.id)"; kind = 'count'; doc_type = 'Inventarizim'; number = (Str $_.num); date = (Day $_.d)
      warehouse = (Str $_.wh); total = '0'; description = (Str $_.descr); lines = @($(if ($byDoc[[string]$_.id]) { $byDoc[[string]$_.id] } else { @() })) } })
    Done 'inventarizimet2' (Send-All 'documents' $rows 20)
  }
  if (Bar 'transferimet2') {
    $h = Query $conn "SELECT m.M_MOVEMENT_ID AS id, m.DOCUMENTNO AS num, m.MOVEMENTDATE AS d, m.DESCRIPTION AS descr, m.TOTALAMT AS total FROM M_MOVEMENT m WITH (NOLOCK) WHERE ISNULL(m.DOCSTATUS, 'CO') NOT IN ('VO', 'RE') AND ISNULL(m.ISACTIVE, 'Y') = 'Y'"
    $l = Query $conn @"
SELECT ml.M_MOVEMENT_ID AS id, ml.LINE AS line, p.VALUE AS sku, p.NAME AS name, ml.MOVEMENTQTY AS qty, ml.PRICEACTUAL AS price, ml.LINENETAMT AS net,
       wf.VALUE AS wfrom, wt.VALUE AS wto
  FROM M_MOVEMENTLINE ml WITH (NOLOCK) JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = ml.M_PRODUCT_ID
  LEFT JOIN M_LOCATOR lf WITH (NOLOCK) ON lf.M_LOCATOR_ID = ml.M_LOCATOR_ID LEFT JOIN M_WAREHOUSE wf WITH (NOLOCK) ON wf.M_WAREHOUSE_ID = lf.M_WAREHOUSE_ID
  LEFT JOIN M_LOCATOR lt WITH (NOLOCK) ON lt.M_LOCATOR_ID = ml.M_LOCATORTO_ID LEFT JOIN M_WAREHOUSE wt WITH (NOLOCK) ON wt.M_WAREHOUSE_ID = lt.M_WAREHOUSE_ID
 WHERE ml.ISACTIVE = 'Y'
"@
    $byDoc = @{}; $route = @{}
    foreach ($x in $l.Rows) { $k = [string]$x.id; if (-not $byDoc[$k]) { $byDoc[$k] = New-Object System.Collections.ArrayList; $route[$k] = @((Str $x.wfrom), (Str $x.wto)) }
      [void]$byDoc[$k].Add(@{ line = [int]$x.line; sku = (Str $x.sku); name = (Str $x.name); qty = (Num $x.qty 4); price = (Num $x.price 4); net = (Num $x.net 2); total = (Num $x.net 2) }) }
    $rows = @($h.Rows | Where-Object { -not ($_.d -is [DBNull]) } | ForEach-Object { $k = [string]$_.id; $rt = $route[$k]
      @{ ext_id = "MV:${db}:$k"; kind = 'transfer'; doc_type = 'Transferim'; number = (Str $_.num); date = (Day $_.d); warehouse = $(if ($rt) { $rt[0] } else { '' })
         total = (Num $_.total 2); description = $(if ($rt) { "$($rt[0]) → $($rt[1])" } else { Str $_.descr }); lines = @($(if ($byDoc[$k]) { $byDoc[$k] } else { @() })) } })
    Done 'transferimet2' (Send-All 'documents' $rows 20)
  }

  # ------------------------------------------------------------ 6. shitjet, kuponat, blerjet, kthimet (me copa)
  if (-not $st['dokumentet2_bere']) {
    Show-Statuses $conn 'C_ORDER'
    $count = (Query $conn "SELECT COUNT(*) AS n FROM C_ORDER WITH (NOLOCK) WHERE $skipStatus").Rows[0].n
    Log "dokumentet (C_ORDER): $count gjithsej" 'Cyan'
    $done = [long]$(if ($st['dokumentet2_numri']) { $st['dokumentet2_numri'] } else { 0 })
    $t0 = Get-Date
    while ($true) {
      $last = [long]$(if ($st['dokumentet2']) { $st['dokumentet2'] } else { 0 })
      $h = Query $conn @"
SELECT TOP 400 o.C_ORDER_ID AS id, o.DOCUMENTNO AS num, o.ISSOTRX AS so, COALESCE(o.DATEORDERED, o.DATEACCT) AS d, o.GRANDTOTAL AS total, o.TOTALLINES AS net, o.PAIDAMT AS paid,
       o.DISCOUNTAMT AS disc, o.C_POS_ID AS pos, o.DESCRIPTION AS descr, COALESCE(o.NOI_FISCALIZATION, o.IIC_FISCALIZATION) AS fiscal,
       dt.NAME AS dtname, dt.ISRETURN AS isret, bp.VALUE AS pcode, bp.NAME AS pname, w.VALUE AS wh, u.NAME AS cashier,
       (SELECT SUM(x.TAXAMT) FROM C_ORDERTAX x WITH (NOLOCK) WHERE x.C_ORDER_ID = o.C_ORDER_ID) AS tax
  FROM C_ORDER o WITH (NOLOCK)
  LEFT JOIN C_DOCTYPE dt WITH (NOLOCK) ON dt.C_DOCTYPE_ID = o.C_DOCTYPE_ID
  LEFT JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = o.C_BPARTNER_ID
  LEFT JOIN M_WAREHOUSE w WITH (NOLOCK) ON w.M_WAREHOUSE_ID = o.M_WAREHOUSE_ID
  LEFT JOIN AD_USER u WITH (NOLOCK) ON u.AD_USER_ID = o.SALESREP_ID
 WHERE o.C_ORDER_ID > $last AND ISNULL(o.DOCSTATUS, 'CO') NOT IN ('VO', 'RE') AND ISNULL(o.ISACTIVE, 'Y') = 'Y' AND COALESCE(o.DATEORDERED, o.DATEACCT) IS NOT NULL
 ORDER BY o.C_ORDER_ID
"@
      if ($h.Rows.Count -eq 0) { break }
      $ids = ($h.Rows | ForEach-Object { [string]$_.id }) -join ','
      $l = Query $conn @"
SELECT ol.C_ORDER_ID AS id, ol.LINE AS line, p.VALUE AS sku, COALESCE(p.NAME, ol.DESCRIPTION) AS name, ol.QTYORDERED AS qty, ol.PRICEACTUAL AS price,
       ol.DISCOUNT AS disc, ol.LINENETAMT AS net, ol.LINETOTALAMT AS total, t.RATE AS rate, ol.PRICECOST AS cost
  FROM C_ORDERLINE ol WITH (NOLOCK)
  LEFT JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = ol.M_PRODUCT_ID
  LEFT JOIN C_TAX t WITH (NOLOCK) ON t.C_TAX_ID = ol.C_TAX_ID
 WHERE ol.C_ORDER_ID IN ($ids) AND ol.ISACTIVE = 'Y'
"@
      $byDoc = @{}
      foreach ($x in $l.Rows) { $k = [string]$x.id; if (-not $byDoc[$k]) { $byDoc[$k] = New-Object System.Collections.ArrayList }
        [void]$byDoc[$k].Add(@{ line = [int]$(if ($x.line -is [DBNull]) { 0 } else { $x.line }); sku = (Str $x.sku); name = (Str $x.name); qty = (Num $x.qty 4); price = (Num $x.price 4)
                                discount = (Num $x.disc 3); net = (Num $x.net 2); total = (Num $x.total 2); tax_rate = (Num $x.rate 2); cost = (Num $x.cost 4) }) }
      $rows = @($h.Rows | ForEach-Object {
        $so = (Str $_.so) -eq 'Y'; $ret = (Str $_.isret) -eq 'Y'
        $kind = if ($so) { if ($ret) { 'sale_return' } elseif (-not ($_.pos -is [DBNull])) { 'pos_sale' } else { 'sale' } } else { if ($ret) { 'purchase_return' } else { 'purchase' } }
        $k = [string]$_.id
        @{ ext_id = "O:${db}:$k"; kind = $kind; doc_type = (Str $_.dtname); number = (Str $_.num); date = (Day $_.d); partner = (Str $_.pcode); partner_name = (Str $_.pname)
           warehouse = (Str $_.wh); total = (Num $_.total 2); net = (Num $_.net 2); tax = (Num $_.tax 2); discount = (Num $_.disc 2); paid = (Num $_.paid 2)
           cashier = (Str $_.cashier); fiscal = (Str $_.fiscal); description = (Str $_.descr); lines = @($(if ($byDoc[$k]) { $byDoc[$k] } else { @() })) } })
      [void](Send-All 'documents' $rows 200)
      $done += $rows.Count
      $st['dokumentet2'] = [string]($h.Rows | ForEach-Object { [long]$_.id } | Measure-Object -Maximum).Maximum
      $st['dokumentet2_numri'] = [string]$done; Save-State
      $pct = if ($count -gt 0) { [math]::Min(100, [math]::Round(100 * $done / $count, 1)) } else { 100 }
      $rate = $done / [math]::Max(((Get-Date) - $t0).TotalSeconds, 1)
      $eta = if ($rate -gt 0 -and $count -gt $done) { [TimeSpan]::FromSeconds(($count - $done) / $rate).ToString('hh\:mm') } else { '00:00' }
      Log ("  dokumentet: {0} nga {1} ({2}%), mbeten rreth {3}" -f $done, $count, $pct, $eta) 'DarkGray'
    }
    $st['dokumentet2_bere'] = $true; Save-State; Log "  dokumentet: $done gjithsej" 'Green'
  }
} finally { $conn.Close() }

Log ("Historiku i {0} u dërgua i gjithi për {1:hh\:mm\:ss}." -f $db, ((Get-Date) - $started)) 'Green'
Write-Host 'Mund ta mbyllni dritaren.' -ForegroundColor Green
