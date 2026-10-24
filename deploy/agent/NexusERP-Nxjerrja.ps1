<#
  NexusERP · Agjenti, hapi 2: nxjerrja e të dhënave nga Logmicro (Compiere/ADempiere në SQL Server)

  Lexon databazën e Logmicro dhe krijon skedarët CSV për Qendrën e migrimit të NexusERP:
  artikujt, subjektet, magazinat, stokun, çmimet, faturat e hapura, kontot dhe bilancin.
  VETËM LEXON: nuk shkruan, nuk fshin, nuk ndryshon asgjë. Nuk dërgon asgjë në internet.
  Fjalëkalime dhe tabela përdoruesish nuk lexohen.

  Si ekzekutohet: klikoni dy herë "Nis-Nxjerrjen.bat" në serverin e Logmicro.
  Opsione:
    -Server "localhost\SQLPRIME"  -Database "LM2026"
    -Cutover 2026-12-31     data e kalimit (gjendja në fund të kësaj dite); nëse mungon pyet
    -ActiveYears 2          artikujt pa lëvizje në kaq vite lihen jashtë (përveç atyre me stok)
    -MainPriceList "Cm. Shitese_1"   lista e çmimeve që bëhet çmimi i shitjes së artikullit
#>
param(
  [string]$Server,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$Cutover,
  [int]$ActiveYears = 2,
  [string]$MainPriceList
)

$ErrorActionPreference = 'Stop'
$Version = '1.0'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$inv = [Globalization.CultureInfo]::InvariantCulture

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Write-Host ''; Read-Host 'Shtypni Enter për të mbyllur' | Out-Null; exit 1 }
function Choose([string]$title, [string[]]$options) {
  Say ''; Say $title 'Cyan'
  for ($i = 0; $i -lt $options.Count; $i++) { Say ("  {0}. {1}" -f ($i + 1), $options[$i]) }
  while ($true) {
    $a = Read-Host 'Shkruani numrin'; $n = 0
    if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) { return $options[$n - 1] }
    Say 'Numër i pavlefshëm, provoni përsëri.' 'Yellow'
  }
}

Add-Type -AssemblyName System.Data
function New-Connection([string]$db) {
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = $Server; $b['Initial Catalog'] = $db
  $b['Application Name'] = 'NexusERP-Nxjerrja (vetem lexim)'; $b['Connect Timeout'] = 15
  try { $b['ApplicationIntent'] = 'ReadOnly' } catch { }
  if ($User) { $b['User ID'] = $User; $b['Password'] = $Password } else { $b['Integrated Security'] = $true }
  $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
  $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 10000;'; [void]$cmd.ExecuteNonQuery()
  return $c
}
function Query($conn, [string]$sql) {
  if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw 'Vetëm SELECT lejohet.' }
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 600
  $t = New-Object System.Data.DataTable
  [void](New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($t)
  return ,$t
}
function Str($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' } ; return ([string]$v).Trim() }
function Num($v, [int]$dec = 4) {
  if ($v -is [DBNull] -or $null -eq $v -or "$v" -eq '') { return '' }
  return ([math]::Round([decimal]$v, $dec)).ToString('0.####', $inv)
}
function Day($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return ([datetime]$v).ToString('yyyy-MM-dd') }

# EAN-8 / UPC-A / EAN-13 me shifër kontrolli të saktë
function Test-Barcode([string]$code) {
  if ($code -notmatch '^\d{8}$|^\d{12,14}$') { return $false }
  $digits = $code.ToCharArray() | ForEach-Object { [int]::Parse([string]$_) }
  $check = $digits[-1]; $body = $digits[0..($digits.Count - 2)]; [array]::Reverse($body)
  $sum = 0; for ($i = 0; $i -lt $body.Count; $i++) { $sum += $body[$i] * $(if ($i % 2 -eq 0) { 3 } else { 1 }) }
  return ((10 - ($sum % 10)) % 10) -eq $check
}

$unitMap = @{ 'cope' = 'pcs'; 'copë' = 'pcs'; 'cop' = 'pcs'; 'pcs' = 'pcs'; 'pc' = 'pcs'; 'copa' = 'pcs'; 'kg' = 'kg'; 'kilogram' = 'kg'; 'g' = 'g'; 'gr' = 'g'; 'gram' = 'g';
              'l' = 'l'; 'lit' = 'l'; 'liter' = 'l'; 'litër' = 'l'; 'litra' = 'l'; 'ml' = 'ml'; 'm' = 'm'; 'metër' = 'm'; 'meter' = 'm'; 'cm' = 'cm';
              'pako' = 'box'; 'kuti' = 'box'; 'box' = 'box'; 'paketë' = 'box'; 'pakete' = 'box'; 'dz' = 'dz'; 'duzinë' = 'dz'; 'ore' = 'h'; 'orë' = 'h'; 'h' = 'h' }

# CSV me pikëpresje, UTF-8 me BOM; ndahet në pjesë kur ka shumë rreshta
function Write-Csv([string]$base, [string[]]$headers, $rows, [int]$chunk) {
  $files = @()
  if ($rows.Count -eq 0) { return $files }
  $enc = New-Object System.Text.UTF8Encoding $true
  $parts = [math]::Ceiling($rows.Count / $chunk)
  for ($p = 0; $p -lt $parts; $p++) {
    $name = if ($parts -gt 1) { "$base-$($p + 1).csv" } else { "$base.csv" }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine(($headers -join ';'))
    $end = [math]::Min(($p + 1) * $chunk, $rows.Count) - 1
    for ($i = $p * $chunk; $i -le $end; $i++) {
      $r = $rows[$i]
      $cells = foreach ($h in $headers) {
        $v = [string]$r[$h]
        if ($v -match '[;"\r\n]') { '"' + $v.Replace('"', '""') + '"' } else { $v }
      }
      [void]$sb.AppendLine(($cells -join ';'))
    }
    $path = Join-Path $script:OutDir $name
    [IO.File]::WriteAllText($path, $sb.ToString(), $enc)
    $files += $name
  }
  return $files
}

Say ''
Say '==============================================================' 'Green'
Say " NexusERP · Nxjerrja nga Logmicro $Version" 'Green'
Say ' Vetëm lexon. Nuk ndryshon asgjë në databazë.' 'Green'
Say '==============================================================' 'Green'

# ---------------------------------------------------------------- lidhja
if (-not $Server) {
  $found = @()
  foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL') {
    try { $p = Get-ItemProperty $key -ErrorAction Stop
      foreach ($prop in $p.PSObject.Properties) { if ($prop.Name -like 'PS*') { continue }
        $name = if ($prop.Name -eq 'MSSQLSERVER') { 'localhost' } else { "localhost\$($prop.Name)" }
        if ($found -notcontains $name) { $found += $name } } } catch { }
  }
  if ($found.Count -eq 0) { $Server = Read-Host 'Adresa e serverit SQL (p.sh. localhost\SQLPRIME)' }
  elseif ($found.Count -eq 1) { $Server = $found[0] }
  else { $Server = Choose 'Cila instancë është e Logmicro? (te Lider Market: SQLPRIME)' $found }
}
try { $master = New-Connection 'master' } catch {
  Say "Hyrja me Windows nuk funksionoi: $($_.Exception.Message)" 'Yellow'
  $User = Read-Host 'Përdoruesi SQL'; $sec = Read-Host 'Fjalëkalimi' -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  try { $master = New-Connection 'master' } catch { Fail "Lidhja dështoi: $($_.Exception.Message)" }
}
if (-not $Database) {
  $dbs = @((Query $master "SELECT name FROM sys.databases WHERE database_id > 4 AND state_desc = 'ONLINE' ORDER BY name").Rows | ForEach-Object { $_.name })
  $Database = Choose 'Cila databazë? (zgjidhni vitin aktual, p.sh. LM2026)' $dbs
}
$master.Close()

if (-not $Cutover) {
  Say ''
  Say 'Data e kalimit: gjendja merret në fund të kësaj dite (p.sh. 2026-12-31).' 'Cyan'
  Say 'Stoku merret siç është TANI; ekzekutojeni nxjerrjen në ditën e kalimit, pasi të mbyllet dita.'
  $Cutover = Read-Host 'Data e kalimit (VVVV-MM-DD) [sot]'
  if (-not $Cutover) { $Cutover = (Get-Date).ToString('yyyy-MM-dd') }
}
try { $cut = [datetime]::ParseExact($Cutover, 'yyyy-MM-dd', $inv) } catch { Fail "Data '$Cutover' nuk është në formën VVVV-MM-DD." }
$cutSql = $cut.ToString('yyyyMMdd')
$sinceSql = $cut.AddYears(-$ActiveYears).ToString('yyyyMMdd')

$db = New-Connection $Database
$started = Get-Date
$script:OutDir = Join-Path $here ("nxjerrja-{0}-{1}" -f ($Database -replace '[^\w\-]', '_'), $cut.ToString('yyyy-MM-dd'))
New-Item -ItemType Directory -Force -Path $script:OutDir | Out-Null
$notes = New-Object System.Collections.ArrayList
function Note([string]$t) { [void]$notes.Add($t); Say "  $t" }

# ---------------------------------------------------------------- 0. skema kontabël dhe lista kryesore e çmimeve
# the accounting schema and cost type actually used (the settings can point elsewhere)
$schemaRow = (Query $db 'SELECT TOP 1 C_ACCTSCHEMA_ID AS id FROM FACT_ACCT WITH (NOLOCK) GROUP BY C_ACCTSCHEMA_ID ORDER BY COUNT(*) DESC').Rows
$schemaId = if ($schemaRow.Count) { $schemaRow[0].id } else { 0 }
$costRow = (Query $db 'SELECT TOP 1 M_COSTTYPE_ID AS id FROM M_COST WITH (NOLOCK) WHERE CURRENTCOSTPRICE > 0 GROUP BY M_COSTTYPE_ID ORDER BY COUNT(*) DESC').Rows
$costFilter = if ($costRow.Count -and -not ($costRow[0].id -is [DBNull])) { "AND c.M_COSTTYPE_ID = $($costRow[0].id)" } else { '' }
$lists = Query $db @"
SELECT pl.M_PRICELIST_ID AS id, pl.NAME AS name, pl.ISTAXINCLUDED AS taxincl,
       (SELECT TOP 1 v.M_PRICELIST_VERSION_ID FROM M_PRICELIST_VERSION v WITH (NOLOCK)
         WHERE v.M_PRICELIST_ID = pl.M_PRICELIST_ID AND v.ISACTIVE = 'Y' AND v.VALIDFROM < DATEADD(day, 1, '$cutSql')
         ORDER BY v.VALIDFROM DESC) AS version_id
  FROM M_PRICELIST pl WITH (NOLOCK)
 WHERE pl.ISACTIVE = 'Y' AND pl.ISSOPRICELIST = 'Y'
"@
$listInfo = @()
foreach ($l in $lists.Rows) {
  if ($l.version_id -is [DBNull]) { continue }
  $cnt = (Query $db "SELECT COUNT(*) AS n FROM M_PRODUCTPRICE WITH (NOLOCK) WHERE M_PRICELIST_VERSION_ID = $($l.version_id) AND PRICESTD > 0 AND ISACTIVE = 'Y'").Rows[0].n
  $listInfo += [pscustomobject]@{ id = $l.id; name = (Str $l.name); taxincl = ((Str $l.taxincl) -eq 'Y'); version = $l.version_id; count = [int]$cnt }
}
if ($listInfo.Count -eq 0) { Fail 'Nuk u gjet asnjë listë çmimesh shitjeje.' }
$main = if ($MainPriceList) { $listInfo | Where-Object { $_.name -eq $MainPriceList } | Select-Object -First 1 } else { $null }
if (-not $main) {
  $labels = @($listInfo | Sort-Object count -Descending | ForEach-Object { '{0}   ({1} çmime{2})' -f $_.name, $_.count, $(if ($_.taxincl) { ', me TVSH' } else { '' }) })
  $pick = Choose 'Cila listë është çmimi kryesor i shitjes (me pakicë)?' $labels
  $main = $listInfo | Where-Object { $pick.StartsWith($_.name + '   ') } | Select-Object -First 1
}
Say ''
Say "Databaza $Database · data e kalimit $($cut.ToString('dd.MM.yyyy')) · çmimi kryesor: $($main.name)" 'Cyan'

# ---------------------------------------------------------------- 1. magazinat
Say ''; Say '1/8 Magazinat...' 'Cyan'
$wh = Query $db @"
SELECT w.M_WAREHOUSE_ID AS id, w.VALUE AS code, w.NAME AS name, l.ADDRESS1 AS address, l.CITY AS city
  FROM M_WAREHOUSE w WITH (NOLOCK) LEFT JOIN C_LOCATION l WITH (NOLOCK) ON l.C_LOCATION_ID = w.C_LOCATION_ID
 WHERE w.ISACTIVE = 'Y' ORDER BY w.VALUE
"@
$whCode = @{}; $whRows = New-Object System.Collections.ArrayList
foreach ($w in $wh.Rows) {
  $code = Str $w.code; if (-not $code) { $code = "W$($w.id)" }
  $whCode[[string]$w.id] = $code
  [void]$whRows.Add(@{ code = $code; name = (Str $w.name); type = 'store'; address = (Str $w.address); city = (Str $w.city) })
}
$files = @{}
$files['04'] = Write-Csv '04-magazinat' @('code', 'name', 'type', 'address', 'city') $whRows 5000
Note ("{0} magazina/njësi" -f $whRows.Count)

# ---------------------------------------------------------------- 2. artikujt
Say ''; Say '2/8 Artikujt...' 'Cyan'
$prod = Query $db @"
WITH stock AS (
  SELECT s.M_PRODUCT_ID, SUM(s.QTYONHAND) AS qty FROM M_STORAGE s WITH (NOLOCK) GROUP BY s.M_PRODUCT_ID
), cost AS (
  SELECT c.M_PRODUCT_ID, MAX(c.CURRENTCOSTPRICE) AS cost
    FROM M_COST c WITH (NOLOCK) LEFT JOIN M_COSTELEMENT e WITH (NOLOCK) ON e.M_COSTELEMENT_ID = c.M_COSTELEMENT_ID
   WHERE c.CURRENTCOSTPRICE > 0 $costFilter AND ISNULL(e.COSTELEMENTTYPE, 'M') = 'M'
   GROUP BY c.M_PRODUCT_ID
)
SELECT p.M_PRODUCT_ID AS id, p.VALUE AS sku, p.NAME AS name, u.X12DE355 AS uom, u.NAME AS uom_name, p.PRODUCTTYPE AS ptype, p.ISSTOCKED AS stocked,
       cat.NAME AS category, t.RATE AS vat, p.UPC AS barcode, m.NAME AS brand, p.WEIGHT AS weight,
       ISNULL(cost.cost, p.PRICECOST) AS cost, pp.PRICESTD AS price, ISNULL(stock.qty, 0) AS qty
  FROM M_PRODUCT p WITH (NOLOCK)
  LEFT JOIN C_UOM u WITH (NOLOCK) ON u.C_UOM_ID = p.C_UOM_ID
  LEFT JOIN M_PRODUCT_CATEGORY cat WITH (NOLOCK) ON cat.M_PRODUCT_CATEGORY_ID = p.M_PRODUCT_CATEGORY_ID
  LEFT JOIN C_TAX t WITH (NOLOCK) ON t.C_TAX_ID = p.C_TAX_ID
  LEFT JOIN M_MANUFACTURER m WITH (NOLOCK) ON m.M_MANUFACTURER_ID = p.M_MANUFACTURER_ID
  LEFT JOIN cost ON cost.M_PRODUCT_ID = p.M_PRODUCT_ID
  LEFT JOIN stock ON stock.M_PRODUCT_ID = p.M_PRODUCT_ID
  LEFT JOIN M_PRODUCTPRICE pp WITH (NOLOCK) ON pp.M_PRODUCT_ID = p.M_PRODUCT_ID AND pp.M_PRICELIST_VERSION_ID = $($main.version)
 WHERE p.ISSUMMARY = 'N'
   AND (ISNULL(stock.qty, 0) <> 0
        OR (p.ISACTIVE = 'Y' AND (EXISTS (SELECT 1 FROM M_TRANSACTION x WITH (NOLOCK) WHERE x.M_PRODUCT_ID = p.M_PRODUCT_ID AND x.MOVEMENTDATE >= '$sinceSql')
                                  OR EXISTS (SELECT 1 FROM C_ORDERLINE ol WITH (NOLOCK) WHERE ol.M_PRODUCT_ID = p.M_PRODUCT_ID AND ol.DATEORDERED >= '$sinceSql')
                                  OR p.CREATED >= '$sinceSql')))
 ORDER BY p.VALUE
"@
$prodRows = New-Object System.Collections.ArrayList
$prodById = @{}; $seenBarcode = @{}; $badBarcodes = 0; $dupBarcodes = 0; $unknownUnits = @{}
foreach ($p in $prod.Rows) {
  $rate = if ($p.vat -is [DBNull]) { 18 } else { [decimal]$p.vat }
  $price = ''
  if (-not ($p.price -is [DBNull]) -and [decimal]$p.price -gt 0) {
    $v = [decimal]$p.price; if ($main.taxincl) { $v = $v / (1 + $rate / 100) }
    $price = Num $v 4
  }
  $uRaw = (Str $p.uom); if (-not $uRaw) { $uRaw = Str $p.uom_name }
  $u = $unitMap[$uRaw.ToLower()]
  if (-not $u) { $u = 'pcs'; if ($uRaw) { $unitMap[$uRaw.ToLower()] = 'pcs'; $unknownUnits[$uRaw] = 1 } }
  $bc = (Str $p.barcode) -replace '\s', ''
  if ($bc) {
    if (-not (Test-Barcode $bc)) { $badBarcodes++; $bc = '' }
    elseif ($seenBarcode.ContainsKey($bc)) { $dupBarcodes++; $bc = '' }
    else { $seenBarcode[$bc] = 1 }
  }
  # anything that has stock must be a stock item, whatever the flag says
  $type = if ((Str $p.ptype) -eq 'I' -or [decimal]$p.qty -ne 0) { if ((Str $p.stocked) -eq 'N' -and [decimal]$p.qty -eq 0) { 'consumable' } else { 'stockable' } } else { 'service' }
  $row = @{ sku = (Str $p.sku); name = (Str $p.name); uom = $u; type = $type; category = (Str $p.category); price = $price
            cost = (Num $p.cost 4); vat = (Num $rate 2); barcode = $bc; brand = (Str $p.brand); weight_kg = $(if ($p.weight -is [DBNull] -or [decimal]$p.weight -eq 0) { '' } else { Num $p.weight 3 }) }
  if (-not $row.sku -or -not $row.name) { continue }
  [void]$prodRows.Add($row)
  $prodById[[string]$p.id] = @{ sku = $row.sku; rate = $rate; cost = $p.cost }
}
$files['01'] = Write-Csv '01-artikujt' @('sku', 'name', 'uom', 'type', 'category', 'price', 'cost', 'vat', 'barcode', 'brand', 'weight_kg') $prodRows 4500
Note ("{0} artikuj (aktivë me lëvizje në {1} vitet e fundit, ose me stok)" -f $prodRows.Count, $ActiveYears)
if ($badBarcodes) { Note "$badBarcodes barkode me shifër kontrolli të gabuar u lanë bosh (artikujt hyjnë pa to)" }
if ($dupBarcodes) { Note "$dupBarcodes barkode të përsëritura te artikuj të tjerë u lanë bosh" }
if ($unknownUnits.Count) { Note ("Njësi të panjohura u bënë 'copë' (pcs): " + (($unknownUnits.Keys | Select-Object -First 15) -join ', ')) }

# ---------------------------------------------------------------- 3. subjektet
Say ''; Say '3/8 Klientët dhe furnitorët...' 'Cyan'
$bal = Query $db @"
SELECT l.C_BPartner_ID AS bp, ISNULL(l.C_ORDER_ID, 0) AS ord, SUM(ISNULL(l.DEBIT, 0) - ISNULL(l.CREDIT, 0)) AS bal
  FROM BP_LEDGER l WITH (NOLOCK)
 WHERE l.ISACTIVE = 'Y' AND l.DATETRX < DATEADD(day, 1, '$cutSql')
 GROUP BY l.C_BPartner_ID, ISNULL(l.C_ORDER_ID, 0)
HAVING ABS(SUM(ISNULL(l.DEBIT, 0) - ISNULL(l.CREDIT, 0))) >= 0.01
"@
$withBalance = @{}; foreach ($b in $bal.Rows) { $withBalance[[string]$b.bp] = 1 }
$bpIds = if ($withBalance.Count) { ($withBalance.Keys -join ',') } else { '0' }
$bps = Query $db @"
SELECT bp.C_BPARTNER_ID AS id, bp.VALUE AS code, bp.NAME AS name, bp.ISCUSTOMER AS cust, bp.ISVENDOR AS vend,
       COALESCE(NULLIF(LTRIM(RTRIM(bp.NRFISKAL)), ''), NULLIF(LTRIM(RTRIM(bp.NRB)), ''), NULLIF(LTRIM(RTRIM(bp.TAXID)), '')) AS tax,
       bp.SO_CREDITLIMIT AS credit, loc.PHONE AS phone, l.ADDRESS1 AS address, l.CITY AS city
  FROM C_BPARTNER bp WITH (NOLOCK)
  OUTER APPLY (SELECT TOP 1 bl.PHONE, bl.C_LOCATION_ID FROM C_BPARTNER_LOCATION bl WITH (NOLOCK)
                WHERE bl.C_BPARTNER_ID = bp.C_BPARTNER_ID AND bl.ISACTIVE = 'Y' ORDER BY bl.ISBILLTO DESC, bl.C_BPARTNER_LOCATION_ID) loc
  LEFT JOIN C_LOCATION l WITH (NOLOCK) ON l.C_LOCATION_ID = loc.C_LOCATION_ID
 WHERE bp.ISSUMMARY = 'N'
   AND ((bp.ISACTIVE = 'Y' AND (bp.ISCUSTOMER = 'Y' OR bp.ISVENDOR = 'Y')) OR bp.C_BPARTNER_ID IN ($bpIds))
 ORDER BY bp.VALUE
"@
$bpRows = New-Object System.Collections.ArrayList; $bpById = @{}; $seenTax = @{}; $dupTax = 0; $badTax = 0
foreach ($b in $bps.Rows) {
  $code = Str $b.code; if (-not $code) { $code = "BP$($b.id)" }
  $cust = (Str $b.cust) -eq 'Y'; $vend = (Str $b.vend) -eq 'Y'
  if (-not $cust -and -not $vend) { $cust = $true }
  $role = if ($cust -and $vend) { 'both' } elseif ($vend) { 'vendor' } else { 'customer' }
  $tax = ((Str $b.tax) -replace '\s', '').ToUpper()
  if ($tax -and $tax -notmatch '^\d{9}$|^[A-Z]\d{8}[A-Z]$') { $badTax++; $tax = '' }
  if ($tax) { if ($seenTax.ContainsKey($tax)) { $dupTax++; $tax = '' } else { $seenTax[$tax] = 1 } }
  $row = @{ code = $code; name = (Str $b.name); role = $role; tax_number = $tax; phone = (Str $b.phone); address = (Str $b.address); city = (Str $b.city)
            country = 'XK'; credit_limit = $(if ($b.credit -is [DBNull] -or [decimal]$b.credit -le 0) { '' } else { Num $b.credit 2 }) }
  if (-not $row.name) { $row.name = $code }
  [void]$bpRows.Add($row)
  $bpById[[string]$b.id] = @{ code = $code; vendor = $vend; customer = $cust }
}
$files['02'] = Write-Csv '02-subjektet' @('code', 'name', 'role', 'tax_number', 'phone', 'address', 'city', 'country', 'credit_limit') $bpRows 4500
Note ("{0} subjekte" -f $bpRows.Count)
if ($badTax) { Note "$badTax NUI/NIPT jo në formatin e duhur u lanë bosh" }
if ($dupTax) { Note "$dupTax NUI të përsëritura u lanë bosh te subjekti i dytë (që të mos bashkohen dy subjekte në një)" }

# ---------------------------------------------------------------- 4. stoku
Say ''; Say '4/8 Stoku...' 'Cyan'
$stk = Query $db @"
SELECT loc.M_WAREHOUSE_ID AS wh, s.M_PRODUCT_ID AS product, SUM(s.QTYONHAND) AS qty
  FROM M_STORAGE s WITH (NOLOCK) JOIN M_LOCATOR loc WITH (NOLOCK) ON loc.M_LOCATOR_ID = s.M_LOCATOR_ID
 GROUP BY loc.M_WAREHOUSE_ID, s.M_PRODUCT_ID
HAVING SUM(s.QTYONHAND) <> 0
"@
$byWh = @{}; $negative = 0; $negativeValue = [decimal]0; $stockValue = [decimal]0; $noCost = 0
foreach ($s in $stk.Rows) {
  $p = $prodById[[string]$s.product]; if (-not $p) { continue }
  $qty = [decimal]$s.qty
  $cost = if ($p.cost -is [DBNull] -or $null -eq $p.cost) { [decimal]0 } else { [decimal]$p.cost }
  if ($qty -lt 0) { $negative++; $negativeValue += $qty * $cost; continue }
  if ($cost -le 0) { $noCost++ }
  $code = $whCode[[string]$s.wh]; if (-not $code) { continue }
  if (-not $byWh.ContainsKey($code)) { $byWh[$code] = New-Object System.Collections.ArrayList }
  [void]$byWh[$code].Add(@{ sku = $p.sku; warehouse = $code; quantity = (Num $qty 3); unit_cost = (Num $cost 4) })
  $stockValue += $qty * $cost
}
$files['05'] = @()
foreach ($code in ($byWh.Keys | Sort-Object)) {
  $files['05'] += Write-Csv ("05-stoku-magazina-{0}" -f ($code -replace '[^\w\-]', '_')) @('sku', 'warehouse', 'quantity', 'unit_cost') $byWh[$code] 4500
}
Note ("Vlera e stokut: {0:N2} € në {1} magazina" -f $stockValue, $byWh.Count)
if ($negative) { Note ("{0} gjendje negative (vlerë {1:N2} €) u lanë jashtë; korrigjojini në Logmicro para kalimit ose pas tij me rregullim" -f $negative, $negativeValue) }
if ($noCost) { Note "$noCost rreshta stoku pa kosto (0); kontrollojini pas importit" }

# ---------------------------------------------------------------- 5. çmimet
Say ''; Say '5/8 Listat e çmimeve...' 'Cyan'
$priceRows = New-Object System.Collections.ArrayList
foreach ($l in $listInfo) {
  $pr = Query $db "SELECT M_PRODUCT_ID AS product, PRICESTD AS price FROM M_PRODUCTPRICE WITH (NOLOCK) WHERE M_PRICELIST_VERSION_ID = $($l.version) AND ISACTIVE = 'Y' AND PRICESTD > 0"
  foreach ($x in $pr.Rows) {
    $p = $prodById[[string]$x.product]; if (-not $p) { continue }
    $v = [decimal]$x.price; if ($l.taxincl) { $v = $v / (1 + $p.rate / 100) }
    [void]$priceRows.Add(@{ price_list = $l.name; sku = $p.sku; price = (Num $v 4) })
  }
}
$files['06'] = Write-Csv '06-cmimet' @('price_list', 'sku', 'price') $priceRows 15000
Note ("{0} çmime në {1} lista (pa TVSH)" -f $priceRows.Count, $listInfo.Count)

# ---------------------------------------------------------------- 6. faturat e hapura
Say ''; Say '6/8 Faturat e hapura...' 'Cyan'
$ordIds = @($bal.Rows | Where-Object { [long]$_.ord -gt 0 } | ForEach-Object { [string]$_.ord })
$orders = @{}
for ($i = 0; $i -lt $ordIds.Count; $i += 1000) {
  $ids = ($ordIds[$i..([math]::Min($i + 999, $ordIds.Count - 1))]) -join ','
  $o = Query $db @"
SELECT o.C_ORDER_ID AS id, o.DOCUMENTNO AS number, o.ISSOTRX AS sales, o.DATEORDERED AS date, ISNULL(pt.NETDAYS, 0) AS days
  FROM C_ORDER o WITH (NOLOCK) LEFT JOIN C_PAYMENTTERM pt WITH (NOLOCK) ON pt.C_PAYMENTTERM_ID = o.C_PAYMENTTERM_ID
 WHERE o.C_ORDER_ID IN ($ids)
"@
  foreach ($r in $o.Rows) { $orders[[string]$r.id] = $r }
}
$ar = New-Object System.Collections.ArrayList; $ap = New-Object System.Collections.ArrayList; $seenNo = @{}
$arTotal = [decimal]0; $apTotal = [decimal]0; $orphans = 0; $orphanValue = [decimal]0
foreach ($b in $bal.Rows) {
  $bp = $bpById[[string]$b.bp]; if (-not $bp) { $orphans++; $orphanValue += [decimal]$b.bal; continue }
  $amount = [decimal]$b.bal
  $o = $orders[[string]$b.ord]
  if ($o) {
    $no = Str $o.number; if (-not $no) { $no = "DOK-$($b.ord)" }
    $key = "$($bp.code)|$no"; if ($seenNo.ContainsKey($key)) { $no = "$no #$($b.ord)" }; $seenNo["$($bp.code)|$no"] = 1
    $date = [datetime]$o.date; $due = $date.AddDays([int]$o.days)
    $isSale = (Str $o.sales) -eq 'Y'
  } else {
    $no = "SALDO-$($bp.code)"; $date = $cut; $due = $cut
    $isSale = -not ($amount -lt 0 -and $bp.vendor)
  }
  $row = @{ partner = $bp.code; number = $no; date = $date.ToString('yyyy-MM-dd'); due_date = $due.ToString('yyyy-MM-dd') }
  if ($isSale) { $row.amount = Num $amount 2; [void]$ar.Add($row); $arTotal += $amount }
  else { $row.amount = Num (-$amount) 2; [void]$ap.Add($row); $apTotal += -$amount }
}
$files['07'] = Write-Csv '07-borxhet-klientet' @('partner', 'number', 'date', 'due_date', 'amount') $ar 15000
$files['08'] = Write-Csv '08-borxhet-furnitoret' @('partner', 'number', 'date', 'due_date', 'amount') $ap 15000
Note ("Klientët detyrohen: {0:N2} € ({1} dokumente)" -f $arTotal, $ar.Count)
Note ("Detyrime ndaj furnitorëve: {0:N2} € ({1} dokumente)" -f $apTotal, $ap.Count)
if ($orphans) { Note ("{0} saldo subjektesh që nuk gjenden te C_BPARTNER (neto {1:N2} €) u lanë jashtë" -f $orphans, $orphanValue) }

# ---------------------------------------------------------------- 7. kontot
Say ''; Say '7/8 Plani kontabël...' 'Cyan'
$acctSets = Query $db @"
SELECT 'receivable' AS kind, C_RECEIVABLE_ACCT AS id FROM C_ACCTSCHEMA_DEFAULT WITH (NOLOCK)
UNION SELECT 'receivable', C_RECEIVABLE_ACCT FROM C_BP_CUSTOMER_ACCT WITH (NOLOCK)
UNION SELECT 'payable', V_LIABILITY_ACCT FROM C_ACCTSCHEMA_DEFAULT WITH (NOLOCK)
UNION SELECT 'payable', V_LIABILITY_ACCT FROM C_BP_VENDOR_ACCT WITH (NOLOCK)
UNION SELECT 'inventory', P_ASSET_ACCT FROM C_ACCTSCHEMA_DEFAULT WITH (NOLOCK)
UNION SELECT 'inventory', P_ASSET_ACCT FROM M_PRODUCT_ACCT WITH (NOLOCK)
"@
$sub = @{}
foreach ($k in 'inventory', 'payable', 'receivable') { foreach ($r in $acctSets.Rows) { if ($r.kind -eq $k -and -not ($r.id -is [DBNull])) { $sub[[string]$r.id] = $k } } }
$tb = Query $db @"
SELECT f.ACCOUNT_ID AS id, SUM(f.AMTACCTDR) AS dr, SUM(f.AMTACCTCR) AS cr
  FROM FACT_ACCT f WITH (NOLOCK)
 WHERE f.C_ACCTSCHEMA_ID = $schemaId AND f.DATEACCT < DATEADD(day, 1, '$cutSql')
 GROUP BY f.ACCOUNT_ID
"@
$ptypes = Query $db "SELECT LTRIM(RTRIM(POSTINGTYPE)) AS t, COUNT(*) AS n, SUM(AMTACCTDR - AMTACCTCR) AS net FROM FACT_ACCT WITH (NOLOCK) WHERE C_ACCTSCHEMA_ID = $schemaId AND DATEACCT < DATEADD(day, 1, '$cutSql') GROUP BY LTRIM(RTRIM(POSTINGTYPE))"
$ev = Query $db 'SELECT C_ELEMENTVALUE_ID AS id, VALUE AS code, NAME AS name, ACCOUNTTYPE AS type, ISBANKACCOUNT AS bank, ISSUMMARY AS summary, ISACTIVE AS active FROM C_ELEMENTVALUE WITH (NOLOCK)'
$evById = @{}; foreach ($e in $ev.Rows) { $evById[[string]$e.id] = $e }
$used = @{}; foreach ($t in $tb.Rows) { $used[[string]$t.id] = $t }
$acctRows = New-Object System.Collections.ArrayList
foreach ($e in $ev.Rows) {
  $id = [string]$e.id; $type = Str $e.type
  if ((Str $e.summary) -eq 'Y' -or $type -notin @('A', 'L', 'O', 'R', 'E')) { continue }
  if ((Str $e.active) -ne 'Y' -and -not $used.ContainsKey($id)) { continue }
  $s = $sub[$id]; if (-not $s -and (Str $e.bank) -eq 'Y') { $s = 'bank' }
  [void]$acctRows.Add(@{ code = (Str $e.code); name = (Str $e.name); type = $type; subtype = [string]$s })
}
$files['09'] = Write-Csv '09-kontot' @('code', 'name', 'type', 'subtype') $acctRows 5000
Note ("{0} konto" -f $acctRows.Count)

# ---------------------------------------------------------------- 8. bilanci
Say ''; Say '8/8 Bilanci...' 'Cyan'
$tbRows = New-Object System.Collections.ArrayList; $pl = [decimal]0; $control = New-Object System.Collections.ArrayList; $unknownAcct = 0
foreach ($t in $tb.Rows) {
  $e = $evById[[string]$t.id]; if (-not $e) { $unknownAcct++; continue }
  $net = [decimal]$t.dr - [decimal]$t.cr
  if ([math]::Abs($net) -lt 0.005) { continue }
  $type = Str $e.type
  if ($type -in @('R', 'E')) { $pl += $net; continue }
  if ($type -notin @('A', 'L', 'O')) { continue }
  $s = $sub[[string]$t.id]
  if ($s) { [void]$control.Add(('  {0,-10} {1,-40} {2,-11} {3,16:N2}' -f (Str $e.code), (Str $e.name), $s, $net)); continue }
  [void]$tbRows.Add(@{ account = (Str $e.code); debit = $(if ($net -gt 0) { Num $net 2 } else { '' }); credit = $(if ($net -lt 0) { Num (-$net) 2 } else { '' }) })
}
if ([math]::Abs($pl) -ge 0.005) {
  [void]$tbRows.Add(@{ account = '109'; debit = $(if ($pl -gt 0) { Num $pl 2 } else { '' }); credit = $(if ($pl -lt 0) { Num (-$pl) 2 } else { '' }) })
}
$files['10'] = Write-Csv '10-bilanci' @('account', 'debit', 'credit') $tbRows 5000
Note ("{0} konto me saldo; fitimi/humbja e vitit ({1:N2} €) shkon te konto 109" -f $tbRows.Count, -$pl)
$db.Close()

# ---------------------------------------------------------------- përmbledhja
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("NexusERP · nxjerrja nga $Database ($Server)")
[void]$sb.AppendLine("Data e kalimit: $($cut.ToString('dd.MM.yyyy'))   ·   nxjerrë më $((Get-Date).ToString('dd.MM.yyyy HH:mm'))   ·   çmimi kryesor: $($main.name)")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('SKEDARËT, sipas hapave te NexusERP → Kalimi nga programi tjetër:')
$steps = [ordered]@{ '01' = '1. Produktet'; '02' = '2. Klientë dhe furnitorë'; '04' = '4. Dyqanet dhe magazinat'; '05' = '5. Gjendja fillestare (një skedar për magazinë)'
                     '06' = '6. Lista çmimesh'; '07' = '7. Faturat e hapura të klientëve'; '08' = '8. Faturat e hapura te furnitorët'; '09' = '9. Plani kontabël'; '10' = '10. Saldot e llogarive' }
foreach ($k in $steps.Keys) { [void]$sb.AppendLine(('  {0,-52} {1}' -f $steps[$k], (($files[$k] | Where-Object { $_ }) -join ', '))) }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('SHËNIME:')
foreach ($n in $notes) { [void]$sb.AppendLine("  - $n") }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('KONTROLL: saldot e kontove të klientëve, furnitorëve dhe stokut në Logmicro (nuk hyjnë te bilanci,')
[void]$sb.AppendLine('sepse vijnë nga faturat e hapura dhe stoku; krahasojini me totalet më lart):')
foreach ($c in $control) { [void]$sb.AppendLine($c) }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Llojet e regjistrimeve në FACT_ACCT deri në datën e kalimit (të gjitha u përfshinë):')
foreach ($p in $ptypes.Rows) { [void]$sb.AppendLine(('  lloji "{0}": {1} rreshta, neto {2:N2}' -f (Str $p.t), $p.n, $p.net)) }
if ($unknownAcct) { [void]$sb.AppendLine("  $unknownAcct konto në FACT_ACCT pa emër te C_ELEMENTVALUE u lanë jashtë") }
[IO.File]::WriteAllText((Join-Path $script:OutDir 'PERMBLEDHJA.txt'), $sb.ToString(), (New-Object System.Text.UTF8Encoding $true))

$secs = [int]((Get-Date) - $started).TotalSeconds
Say ''
Say '==============================================================' 'Green'
Say " Gati për $secs sekonda. Nuk u ndryshua asgjë në databazë." 'Green'
Say '==============================================================' 'Green'
Say "Skedarët janë te: $script:OutDir"
Say 'Lexoni PERMBLEDHJA.txt, pastaj importojini skedarët me radhë te NexusERP → Kalimi nga programi tjetër.'
try { Start-Process explorer.exe $script:OutDir } catch { }
Read-Host 'Shtypni Enter për të mbyllur' | Out-Null
