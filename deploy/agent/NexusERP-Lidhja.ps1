<#
  NexusERP · Lidhja live me Logmicro (një drejtim: Logmicro → NexusERP)

  Çdo ~30 sekonda lexon nga Logmicro vetëm atë që ka ndryshuar (artikuj, çmime, subjekte,
  stok, faturat e papaguara) dhe ia dërgon NexusERP-it me çelësin e lidhjes.
  VETËM LEXON nga Logmicro. Nuk lexon fjalëkalime. Dërgon vetëm te adresa e NexusERP në lidhja.json.

  Hera e parë:  klikoni dy herë "Nis-Lidhjen.bat" — ngjitni konfigurimin nga NexusERP
                (Klientët → veprimet → Lidhja live), prisni ngarkimin e plotë.
  Pastaj:       "Instalo-Lidhjen.bat" e bën të punojë vetë, edhe pas rinisjes së serverit.
  Opsione:      -Service (pa pyetje, për Task Scheduler)  -Full (ngarko gjithçka nga e para)  -Once (një cikël)
#>
param([switch]$Service, [switch]$Full, [switch]$Once)

$ErrorActionPreference = 'Stop'
$Version = '1.0'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$cfgPath = Join-Path $here 'lidhja.json'
$statePath = Join-Path $here 'lidhja-gjendja.json'
$logPath = Join-Path $here 'lidhja.log'
$inv = [Globalization.CultureInfo]::InvariantCulture
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Log([string]$text, [string]$color = 'Gray') {
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $text
  if (-not $Service) { Write-Host $line -ForegroundColor $color }
  try {
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 5MB) { Move-Item $logPath "$logPath.1" -Force }
    Add-Content -Path $logPath -Value $line -Encoding UTF8
  } catch { }
}

# ---------------------------------------------------------------- konfigurimi
if (-not (Test-Path $cfgPath)) {
  if ($Service) { Log 'lidhja.json mungon; nisni njëherë Nis-Lidhjen.bat' 'Red'; exit 1 }
  Write-Host ''
  Write-Host 'Ngjitni konfigurimin nga NexusERP (Klientët → veprimet e klientit → Lidhja live).' -ForegroundColor Cyan
  Write-Host 'Ngjiteni të gjithë tekstin {...}, pastaj shtypni Enter dy herë.' -ForegroundColor Cyan
  $lines = @(); while ($true) { $l = Read-Host; if ($l -eq '' -and $lines.Count -gt 0) { break }; $lines += $l }
  try { $cfg = ($lines -join "`n") | ConvertFrom-Json } catch { Write-Host 'Teksti nuk është konfigurim i vlefshëm.' -ForegroundColor Red; Read-Host; exit 1 }
  if (-not $cfg.server) { $cfg | Add-Member -NotePropertyName server -NotePropertyValue (Read-Host 'Serveri SQL (te Lider Market: localhost\SQLPRIME)') -Force }
  if (-not $cfg.database) { $cfg | Add-Member -NotePropertyName database -NotePropertyValue (Read-Host 'Databaza (p.sh. LM2026)') -Force }
  if (-not $cfg.main_price_list) { $cfg | Add-Member -NotePropertyName main_price_list -NotePropertyValue (Read-Host 'Emri i listës kryesore të çmimeve (p.sh. Cm. Shitese_1)') -Force }
  if (-not $cfg.interval_seconds) { $cfg | Add-Member -NotePropertyName interval_seconds -NotePropertyValue 30 -Force }
  if (-not $cfg.active_years) { $cfg | Add-Member -NotePropertyName active_years -NotePropertyValue 2 -Force }
  [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
  Write-Host "U ruajt te $cfgPath" -ForegroundColor Green
}
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($k in 'url', 'anon_key', 'sync_key', 'server', 'database', 'main_price_list') { if (-not $cfg.$k) { Log "lidhja.json: mungon '$k'" 'Red'; exit 1 } }
$pushUrl = ($cfg.url.TrimEnd('/')) + '/rest/v1/rpc/sync_push'

$state = @{ wm = @{}; full_done = $false }
if ((Test-Path $statePath) -and -not $Full) {
  try { $s = Get-Content $statePath -Raw | ConvertFrom-Json; $state.full_done = [bool]$s.full_done; foreach ($p in $s.wm.PSObject.Properties) { $state.wm[$p.Name] = $p.Value } } catch { }
}
function Save-State { [IO.File]::WriteAllText($statePath, (@{ full_done = $state.full_done; wm = $state.wm } | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false)) }

# ---------------------------------------------------------------- SQL (vetëm lexim)
Add-Type -AssemblyName System.Data
function New-Connection {
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = $cfg.server; $b['Initial Catalog'] = $cfg.database
  $b['Application Name'] = 'NexusERP-Lidhja (vetem lexim)'; $b['Connect Timeout'] = 15
  try { $b['ApplicationIntent'] = 'ReadOnly' } catch { }
  if ($cfg.sql_user) { $b['User ID'] = $cfg.sql_user; $b['Password'] = $cfg.sql_password } else { $b['Integrated Security'] = $true }
  $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
  $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 10000;'; [void]$cmd.ExecuteNonQuery()
  return $c
}
function Query($conn, [string]$sql) {
  if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw 'Vetëm SELECT lejohet.' }
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 300
  $t = New-Object System.Data.DataTable
  [void](New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($t)
  return ,$t
}
function Str($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return ([string]$v).Trim() }
function Num($v, [int]$dec = 4) { if ($v -is [DBNull] -or $null -eq $v -or "$v" -eq '') { return '' }; return ([math]::Round([decimal]$v, $dec)).ToString('0.####', $inv) }
function Test-Barcode([string]$code) {
  if ($code -notmatch '^\d{8}$|^\d{12,14}$') { return $false }
  $d = $code.ToCharArray() | ForEach-Object { [int]::Parse([string]$_) }
  $check = $d[-1]; $body = $d[0..($d.Count - 2)]; [array]::Reverse($body)
  $sum = 0; for ($i = 0; $i -lt $body.Count; $i++) { $sum += $body[$i] * $(if ($i % 2 -eq 0) { 3 } else { 1 }) }
  return ((10 - ($sum % 10)) % 10) -eq $check
}
$unitMap = @{ 'cope' = 'pcs'; 'copë' = 'pcs'; 'pcs' = 'pcs'; 'kg' = 'kg'; 'g' = 'g'; 'gr' = 'g'; 'l' = 'l'; 'lit' = 'l'; 'litër' = 'l'; 'ml' = 'ml'; 'm' = 'm'; 'cm' = 'cm';
              'pako' = 'box'; 'kuti' = 'box'; 'box' = 'box'; 'paketë' = 'box'; 'dz' = 'dz'; 'ore' = 'h'; 'orë' = 'h' }
function SqlTime($t) { return ([datetime]$t).ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv) }

# ---------------------------------------------------------------- dërgimi
function Push([hashtable]$batch) {
  $body = @{ p_key = $cfg.sync_key; p_batch = $batch } | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  for ($try = 1; $try -le 3; $try++) {
    try {
      $r = Invoke-RestMethod -Method Post -Uri $pushUrl -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 60 `
             -Headers @{ apikey = $cfg.anon_key; Authorization = "Bearer $($cfg.anon_key)" }
      if ($r.ok -eq $false) { throw "NexusERP: $($r.error)" }
      return $r
    } catch {
      if ($try -eq 3) { throw }
      Start-Sleep -Seconds (5 * $try)
    }
  }
}
# dërgon një listë në copa të vogla (NexusERP pranon pak rreshta për thirrje)
function Push-List([string]$name, $rows, [int]$size, [hashtable]$extra = @{}) {
  if ($rows.Count -eq 0 -and $extra.Count -eq 0) { return 0 }
  $sent = 0
  for ($i = 0; $i -lt [math]::Max($rows.Count, 1); $i += $size) {
    # (an if-expression would unwrap a one-row list into a single object)
    [object[]]$part = @()
    if ($rows.Count) { $part = @($rows[$i..([math]::Min($i + $size, $rows.Count) - 1)]) }
    $b = @{ $name = $part }
    if ($i -eq 0) { foreach ($k in $extra.Keys) { $b[$k] = $extra[$k] } }
    $r = Push $b
    $sent += $part.Count
    $errs = $r.$name.errors
    if ($errs) { Log ("  {0}: {1} rreshta me gabime (p.sh. {2})" -f $name, $errs, (($r.$name.sample | Select-Object -First 1 | ConvertTo-Json -Compress))) 'Yellow' }
  }
  return $sent
}

# ---------------------------------------------------------------- leximet nga Logmicro
function Read-Lists($db, [string]$now) {
  $l = Query $db @"
SELECT pl.NAME AS name, pl.ISTAXINCLUDED AS taxincl,
       (SELECT TOP 1 v.M_PRICELIST_VERSION_ID FROM M_PRICELIST_VERSION v WITH (NOLOCK)
         WHERE v.M_PRICELIST_ID = pl.M_PRICELIST_ID AND v.ISACTIVE = 'Y' AND v.VALIDFROM <= '$now' ORDER BY v.VALIDFROM DESC) AS version
  FROM M_PRICELIST pl WITH (NOLOCK) WHERE pl.ISACTIVE = 'Y' AND pl.ISSOPRICELIST = 'Y'
"@
  return @($l.Rows | Where-Object { -not ($_.version -is [DBNull]) } | ForEach-Object { [pscustomobject]@{ name = (Str $_.name); taxincl = ((Str $_.taxincl) -eq 'Y'); version = $_.version } })
}

function Read-Products($db, $lists, [string]$where) {
  $main = $lists | Where-Object { $_.name -eq $cfg.main_price_list } | Select-Object -First 1
  if (-not $main) { throw "Lista e çmimeve '$($cfg.main_price_list)' nuk u gjet te Logmicro" }
  $since = (Get-Date).AddYears(-[int]$cfg.active_years).ToString('yyyyMMdd')
  $t = Query $db @"
WITH stock AS (SELECT s.M_PRODUCT_ID, SUM(s.QTYONHAND) AS qty FROM M_STORAGE s WITH (NOLOCK) GROUP BY s.M_PRODUCT_ID),
cost AS (SELECT c.M_PRODUCT_ID, MAX(c.CURRENTCOSTPRICE) AS cost FROM M_COST c WITH (NOLOCK)
          LEFT JOIN M_COSTELEMENT e WITH (NOLOCK) ON e.M_COSTELEMENT_ID = c.M_COSTELEMENT_ID
         WHERE c.CURRENTCOSTPRICE > 0 AND ISNULL(e.COSTELEMENTTYPE, 'M') = 'M' GROUP BY c.M_PRODUCT_ID)
SELECT p.M_PRODUCT_ID AS id, p.VALUE AS sku, p.NAME AS name, u.X12DE355 AS uom, p.PRODUCTTYPE AS ptype, p.ISSTOCKED AS stocked,
       cat.NAME AS category, t.RATE AS vat, p.UPC AS barcode, m.NAME AS brand, ISNULL(cost.cost, p.PRICECOST) AS cost,
       pp.PRICESTD AS price, ISNULL(stock.qty, 0) AS qty
  FROM M_PRODUCT p WITH (NOLOCK)
  LEFT JOIN C_UOM u WITH (NOLOCK) ON u.C_UOM_ID = p.C_UOM_ID
  LEFT JOIN M_PRODUCT_CATEGORY cat WITH (NOLOCK) ON cat.M_PRODUCT_CATEGORY_ID = p.M_PRODUCT_CATEGORY_ID
  LEFT JOIN C_TAX t WITH (NOLOCK) ON t.C_TAX_ID = p.C_TAX_ID
  LEFT JOIN M_MANUFACTURER m WITH (NOLOCK) ON m.M_MANUFACTURER_ID = p.M_MANUFACTURER_ID
  LEFT JOIN cost ON cost.M_PRODUCT_ID = p.M_PRODUCT_ID
  LEFT JOIN stock ON stock.M_PRODUCT_ID = p.M_PRODUCT_ID
  LEFT JOIN M_PRODUCTPRICE pp WITH (NOLOCK) ON pp.M_PRODUCT_ID = p.M_PRODUCT_ID AND pp.M_PRICELIST_VERSION_ID = $($main.version)
 WHERE p.ISSUMMARY = 'N'
   AND (ISNULL(stock.qty, 0) <> 0 OR (p.ISACTIVE = 'Y' AND (p.CREATED >= '$since'
        OR EXISTS (SELECT 1 FROM M_TRANSACTION x WITH (NOLOCK) WHERE x.M_PRODUCT_ID = p.M_PRODUCT_ID AND x.MOVEMENTDATE >= '$since'))))
   $where
"@
  $rows = New-Object System.Collections.ArrayList; $seen = @{}
  foreach ($p in $t.Rows) {
    $rate = if ($p.vat -is [DBNull]) { 18 } else { [decimal]$p.vat }
    $price = ''
    if (-not ($p.price -is [DBNull]) -and [decimal]$p.price -gt 0) { $v = [decimal]$p.price; if ($main.taxincl) { $v = $v / (1 + $rate / 100) }; $price = Num $v 4 }
    $u = $unitMap[(Str $p.uom).ToLower()]; if (-not $u) { $u = 'pcs' }
    $bc = (Str $p.barcode) -replace '\s', ''; if ($bc -and (-not (Test-Barcode $bc) -or $seen.ContainsKey($bc))) { $bc = '' }; if ($bc) { $seen[$bc] = 1 }
    $type = if ((Str $p.ptype) -eq 'I' -or [decimal]$p.qty -ne 0) { if ((Str $p.stocked) -eq 'N' -and [decimal]$p.qty -eq 0) { 'consumable' } else { 'stockable' } } else { 'service' }
    if (-not (Str $p.sku) -or -not (Str $p.name)) { continue }
    [void]$rows.Add(@{ sku = (Str $p.sku); name = (Str $p.name); uom = $u; type = $type; category = (Str $p.category); price = $price; cost = (Num $p.cost 4)
                       vat = (Num $rate 2); barcode = $bc; brand = (Str $p.brand) })
  }
  return ,$rows
}

function Read-Partners($db, [string]$where) {
  $t = Query $db @"
SELECT bp.C_BPARTNER_ID AS id, bp.VALUE AS code, bp.NAME AS name, bp.ISCUSTOMER AS cust, bp.ISVENDOR AS vend, bp.SO_CREDITLIMIT AS credit,
       COALESCE(NULLIF(LTRIM(RTRIM(bp.NRFISKAL)), ''), NULLIF(LTRIM(RTRIM(bp.NRB)), ''), NULLIF(LTRIM(RTRIM(bp.TAXID)), '')) AS tax,
       loc.PHONE AS phone, l.ADDRESS1 AS address, l.CITY AS city,
       (SELECT MIN(o.C_BPARTNER_ID) FROM C_BPARTNER o WITH (NOLOCK)
         WHERE COALESCE(NULLIF(LTRIM(RTRIM(o.NRFISKAL)), ''), NULLIF(LTRIM(RTRIM(o.NRB)), ''), NULLIF(LTRIM(RTRIM(o.TAXID)), ''))
             = COALESCE(NULLIF(LTRIM(RTRIM(bp.NRFISKAL)), ''), NULLIF(LTRIM(RTRIM(bp.NRB)), ''), NULLIF(LTRIM(RTRIM(bp.TAXID)), ''))) AS first_with_tax
  FROM C_BPARTNER bp WITH (NOLOCK)
  OUTER APPLY (SELECT TOP 1 bl.PHONE, bl.C_LOCATION_ID FROM C_BPARTNER_LOCATION bl WITH (NOLOCK)
                WHERE bl.C_BPARTNER_ID = bp.C_BPARTNER_ID AND bl.ISACTIVE = 'Y' ORDER BY bl.ISBILLTO DESC, bl.C_BPARTNER_LOCATION_ID) loc
  LEFT JOIN C_LOCATION l WITH (NOLOCK) ON l.C_LOCATION_ID = loc.C_LOCATION_ID
 WHERE bp.ISSUMMARY = 'N' AND (bp.ISCUSTOMER = 'Y' OR bp.ISVENDOR = 'Y') $where
"@
  $rows = New-Object System.Collections.ArrayList
  foreach ($b in $t.Rows) {
    $code = Str $b.code; if (-not $code) { $code = "BP$($b.id)" }
    $cust = (Str $b.cust) -eq 'Y'; $vend = (Str $b.vend) -eq 'Y'
    $tax = ((Str $b.tax) -replace '\s', '').ToUpper()
    # a NUI shared by several partners stays only on the first one, so they are not merged
    if ($tax -and ($tax -notmatch '^\d{9}$|^[A-Z]\d{8}[A-Z]$' -or ((-not ($b.first_with_tax -is [DBNull])) -and [long]$b.first_with_tax -ne [long]$b.id))) { $tax = '' }
    [void]$rows.Add(@{ code = $code; name = $(if (Str $b.name) { Str $b.name } else { $code }); role = $(if ($cust -and $vend) { 'both' } elseif ($vend) { 'vendor' } else { 'customer' })
                       tax_number = $tax; phone = (Str $b.phone); address = (Str $b.address); city = (Str $b.city); country = 'XK'
                       credit_limit = $(if ($b.credit -is [DBNull] -or [decimal]$b.credit -le 0) { '' } else { Num $b.credit 2 }) })
  }
  return ,$rows
}

function Read-Stock($db, [string]$productFilter) {
  $t = Query $db @"
SELECT w.VALUE AS warehouse, p.VALUE AS sku, SUM(s.QTYONHAND) AS qty, MAX(ISNULL(c.cost, p.PRICECOST)) AS cost
  FROM M_STORAGE s WITH (NOLOCK)
  JOIN M_LOCATOR loc WITH (NOLOCK) ON loc.M_LOCATOR_ID = s.M_LOCATOR_ID
  JOIN M_WAREHOUSE w WITH (NOLOCK) ON w.M_WAREHOUSE_ID = loc.M_WAREHOUSE_ID
  JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = s.M_PRODUCT_ID
  OUTER APPLY (SELECT MAX(mc.CURRENTCOSTPRICE) AS cost FROM M_COST mc WITH (NOLOCK) WHERE mc.M_PRODUCT_ID = s.M_PRODUCT_ID AND mc.CURRENTCOSTPRICE > 0) c
 WHERE 1 = 1 $productFilter
 GROUP BY w.VALUE, p.VALUE
"@
  $rows = New-Object System.Collections.ArrayList
  foreach ($s in $t.Rows) { [void]$rows.Add(@{ warehouse = (Str $s.warehouse); sku = (Str $s.sku); qty = (Num $s.qty 3); cost = (Num $s.cost 4) }) }
  return ,$rows
}

function Read-OpenDocuments($db, [string]$partnerFilter) {
  $t = Query $db @"
WITH l AS (
  SELECT l.C_BPartner_ID AS bp, ISNULL(l.C_ORDER_ID, 0) AS ord, SUM(ISNULL(l.DEBIT, 0) - ISNULL(l.CREDIT, 0)) AS bal
    FROM BP_LEDGER l WITH (NOLOCK) WHERE l.ISACTIVE = 'Y' $partnerFilter
   GROUP BY l.C_BPartner_ID, ISNULL(l.C_ORDER_ID, 0)
  HAVING ABS(SUM(ISNULL(l.DEBIT, 0) - ISNULL(l.CREDIT, 0))) >= 0.01)
SELECT l.bp, l.ord, l.bal, bp.VALUE AS code, bp.ISVENDOR AS vend, o.DOCUMENTNO AS number, o.ISSOTRX AS sales, o.DATEORDERED AS date,
       o.GRANDTOTAL AS total, ISNULL(pt.NETDAYS, 0) AS days, w.VALUE AS warehouse
  FROM l JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = l.bp
  LEFT JOIN C_ORDER o WITH (NOLOCK) ON o.C_ORDER_ID = l.ord
  LEFT JOIN C_PAYMENTTERM pt WITH (NOLOCK) ON pt.C_PAYMENTTERM_ID = o.C_PAYMENTTERM_ID
  LEFT JOIN M_WAREHOUSE w WITH (NOLOCK) ON w.M_WAREHOUSE_ID = o.M_WAREHOUSE_ID
"@
  $rows = New-Object System.Collections.ArrayList
  foreach ($d in $t.Rows) {
    $amount = [decimal]$d.bal
    $hasDoc = -not ($d.number -is [DBNull])
    $isSale = if ($hasDoc) { (Str $d.sales) -eq 'Y' } else { -not ($amount -lt 0 -and (Str $d.vend) -eq 'Y') }
    $date = if ($hasDoc) { ([datetime]$d.date) } else { Get-Date }
    [void]$rows.Add(@{ ext_id = $(if ($hasDoc) { "O$($d.ord)" } else { "B$($d.bp)" }); kind = $(if (-not $hasDoc) { 'balance' } elseif ($isSale) { 'sale' } else { 'purchase' })
                       number = $(if ($hasDoc) { Str $d.number } else { "SALDO-$(Str $d.code)" }); partner = (Str $d.code)
                       date = $date.ToString('yyyy-MM-dd'); due_date = $date.AddDays($(if ($hasDoc) { [int]$d.days } else { 0 })).ToString('yyyy-MM-dd')
                       total = (Num $d.total 2); open = $(if ($isSale) { Num $amount 2 } else { Num (-$amount) 2 }); warehouse = (Str $d.warehouse) })
  }
  return ,$rows
}

# ---------------------------------------------------------------- një cikël
function Run-Cycle {
  $db = New-Connection
  try {
    $now = (Query $db 'SELECT GETDATE() AS t').Rows[0].t
    $nowSql = SqlTime $now
    $lists = Read-Lists $db $nowSql
    $sent = [ordered]@{}
    if (-not $state.full_done) {
      Log 'Ngarkimi i plotë i parë (mund të zgjasë disa minuta)...' 'Cyan'
      $wh = Query $db "SELECT w.VALUE AS code, w.NAME AS name, l.ADDRESS1 AS address, l.CITY AS city FROM M_WAREHOUSE w WITH (NOLOCK) LEFT JOIN C_LOCATION l WITH (NOLOCK) ON l.C_LOCATION_ID = w.C_LOCATION_ID WHERE w.ISACTIVE = 'Y'"
      $whRows = @($wh.Rows | ForEach-Object { @{ code = (Str $_.code); name = (Str $_.name); type = 'store'; address = (Str $_.address); city = (Str $_.city) } })
      $sent.magazina = Push-List 'warehouses' $whRows 200
      $sent.artikuj = Push-List 'products' (Read-Products $db $lists '') 150
      $sent.subjekte = Push-List 'partners' (Read-Partners $db "AND bp.ISACTIVE = 'Y'") 200
      $prices = New-Object System.Collections.ArrayList
      foreach ($l in $lists) {
        $pr = Query $db "SELECT p.VALUE AS sku, pp.PRICESTD AS price, t.RATE AS vat FROM M_PRODUCTPRICE pp WITH (NOLOCK) JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = pp.M_PRODUCT_ID LEFT JOIN C_TAX t WITH (NOLOCK) ON t.C_TAX_ID = p.C_TAX_ID WHERE pp.M_PRICELIST_VERSION_ID = $($l.version) AND pp.ISACTIVE = 'Y' AND pp.PRICESTD > 0 AND p.ISACTIVE = 'Y'"
        foreach ($x in $pr.Rows) { $v = [decimal]$x.price; $rate = if ($x.vat -is [DBNull]) { 18 } else { [decimal]$x.vat }; if ($l.taxincl) { $v = $v / (1 + $rate / 100) }
          [void]$prices.Add(@{ price_list = $l.name; sku = (Str $x.sku); price = (Num $v 4) }) }
      }
      $sent.cmime = Push-List 'prices' $prices 400
      $sent.stok = Push-List 'stock' (Read-Stock $db 'AND s.QTYONHAND <> 0') 300
      $docs = Read-OpenDocuments $db ''
      $sent.dokumente = Push-List 'documents' $docs 300
      $state.full_done = $true
    } else {
      $w = @{}; foreach ($k in 'products', 'partners', 'prices', 'stock', 'ledger') { $w[$k] = SqlTime (([datetime]$state.wm[$k]).AddSeconds(-5)) }
      $prodWhere = "AND (p.UPDATED > '$($w.products)' OR p.M_PRODUCT_ID IN (SELECT pp.M_PRODUCT_ID FROM M_PRODUCTPRICE pp WITH (NOLOCK) WHERE pp.UPDATED > '$($w.prices)'))"
      $sent.artikuj = Push-List 'products' (Read-Products $db $lists $prodWhere) 150
      $sent.subjekte = Push-List 'partners' (Read-Partners $db "AND bp.UPDATED > '$($w.partners)'") 200
      $prices = New-Object System.Collections.ArrayList
      foreach ($l in $lists) {
        $pr = Query $db "SELECT p.VALUE AS sku, pp.PRICESTD AS price, t.RATE AS vat FROM M_PRODUCTPRICE pp WITH (NOLOCK) JOIN M_PRODUCT p WITH (NOLOCK) ON p.M_PRODUCT_ID = pp.M_PRODUCT_ID LEFT JOIN C_TAX t WITH (NOLOCK) ON t.C_TAX_ID = p.C_TAX_ID WHERE pp.M_PRICELIST_VERSION_ID = $($l.version) AND pp.UPDATED > '$($w.prices)' AND pp.PRICESTD > 0"
        foreach ($x in $pr.Rows) { $v = [decimal]$x.price; $rate = if ($x.vat -is [DBNull]) { 18 } else { [decimal]$x.vat }; if ($l.taxincl) { $v = $v / (1 + $rate / 100) }
          [void]$prices.Add(@{ price_list = $l.name; sku = (Str $x.sku); price = (Num $v 4) }) }
      }
      $sent.cmime = Push-List 'prices' $prices 400
      # stock: every warehouse of the products that moved (zero included, so sold-out items go to 0)
      $moved = "AND s.M_PRODUCT_ID IN (SELECT M_PRODUCT_ID FROM M_STORAGE WITH (NOLOCK) WHERE UPDATED > '$($w.stock)' UNION SELECT M_PRODUCT_ID FROM M_TRANSACTION WITH (NOLOCK) WHERE CREATED > '$($w.stock)')"
      $sent.stok = Push-List 'stock' (Read-Stock $db $moved) 300
      # documents: partners whose card changed get their open documents resent in full
      $changed = Query $db "SELECT DISTINCT bp.VALUE AS code, l.C_BPartner_ID AS id FROM BP_LEDGER l WITH (NOLOCK) JOIN C_BPARTNER bp WITH (NOLOCK) ON bp.C_BPARTNER_ID = l.C_BPartner_ID WHERE l.UPDATED > '$($w.ledger)' OR l.CREATED > '$($w.ledger)'"
      if ($changed.Rows.Count) {
        $ids = (@($changed.Rows | ForEach-Object { [string]$_.id }) | Select-Object -First 2000) -join ','
        $codes = @($changed.Rows | ForEach-Object { Str $_.code })
        $docs = Read-OpenDocuments $db "AND l.C_BPartner_ID IN ($ids)"
        $sent.dokumente = Push-List 'documents' $docs 300 @{ replace_partners = $codes }
      }
    }
    foreach ($k in 'products', 'partners', 'prices', 'stock', 'ledger') { $state.wm[$k] = $nowSql }
    Save-State
    $summary = ($sent.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { "$($_.Key) $($_.Value)" }) -join ', '
    if ($summary) { Log "U dërguan: $summary" 'Green' } elseif (-not $Service) { Write-Host ('{0}  pa ndryshime' -f (Get-Date).ToString('HH:mm:ss')) -ForegroundColor DarkGray }
  } finally { $db.Close() }
}

# ---------------------------------------------------------------- cikli i përhershëm
if (-not $Service) {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Green
  Write-Host " NexusERP · Lidhja live me Logmicro $Version" -ForegroundColor Green
  Write-Host " $($cfg.database) → $($cfg.url)   çdo $($cfg.interval_seconds) sekonda" -ForegroundColor Green
  Write-Host ' Vetëm lexon nga Logmicro. Mbylleni dritaren për ta ndalur.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Green
}
Log "Nisi lidhja ($($cfg.database) → $($cfg.url))"
$failures = 0
while ($true) {
  try {
    Run-Cycle
    $failures = 0
  } catch {
    $failures++
    Log "Gabim: $($_.Exception.Message)" 'Red'
  }
  if ($Once) { break }
  # after repeated errors wait longer (up to 5 minutes)
  $wait = [math]::Min([int]$cfg.interval_seconds * [math]::Pow(2, [math]::Min($failures, 4)), 300)
  Start-Sleep -Seconds ([int]$wait)
}
