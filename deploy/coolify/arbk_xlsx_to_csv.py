#!/usr/bin/env python3
"""The ARBK open-data workbook (Bizneset_YYYY-MM-DD.xlsx) as the CSV the register is loaded from.

Standard library only (the server has no extra packages): the sheet is read as a stream, so the
whole 30 MB file never sits in memory as a tree.

usage: arbk_xlsx_to_csv.py Bizneset.xlsx out.csv
"""
import csv
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
MONTHS = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                                       'October', 'November', 'December'], 1)}
# the columns of the ARBK file, as named in its first row
WANT = {
    'nui': 'Nr. i biznesit', 'name': 'Emri i biznesit', 'trade_name': 'Emri tregtare', 'legal_form': 'Lloji i biznesit',
    'activity': 'Aktiv. Nace2 - Përshkrimi', 'sector': 'Sektori', 'employees': 'Nr. punëtorëve', 'size': 'Madhësia',
    'city': 'Qyteti', 'status': 'Statusi i biznesit', 'year': 'Years', 'month': 'Months', 'dissolved_on': 'Data Shuarjes',
}


def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def excel_date(v):
    if not v:
        return ''
    m = re.match(r'(\d{1,2})[./](\d{1,2})[./](\d{4})', v)
    if m:   # 22/06/2015
        return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    try:
        d = float(v)
    except ValueError:
        return v[:10] if re.match(r'\d{4}-\d{2}-\d{2}', v) else ''
    import datetime
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(d))).isoformat()


def main(src, dst):
    z = zipfile.ZipFile(src)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for _, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
            if el.tag == NS + 'si':
                shared.append(''.join(t.text or '' for t in el.iter(NS + 't')))
                el.clear()
    sheet = next(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))
    head = None
    n = 0
    with open(dst, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['nui', 'name', 'trade_name', 'legal_form', 'activity', 'sector', 'employees', 'size', 'city', 'status', 'registered', 'dissolved_on'])
        for _, el in ET.iterparse(z.open(sheet)):
            if el.tag != NS + 'row':
                continue
            cells = {}
            for c in el.iter(NS + 'c'):
                v = c.find(NS + 'v')
                txt = None
                if c.get('t') == 's' and v is not None:
                    txt = shared[int(v.text)]
                elif c.get('t') == 'inlineStr':
                    txt = ''.join(t.text or '' for t in c.iter(NS + 't'))
                elif v is not None:
                    txt = v.text
                cells[col_index(c.get('r'))] = (txt or '').strip()
            el.clear()
            row = [cells.get(i, '') for i in range(max(cells) + 1)] if cells else []
            if head is None:
                head = {name: row.index(label) for name, label in WANT.items() if label in row}
                if 'nui' not in head or 'name' not in head:
                    sys.exit('This is not the ARBK business file: the columns "Nr. i biznesit" and "Emri i biznesit" are missing')
                continue
            g = lambda k: row[head[k]] if k in head and head[k] < len(row) else ''
            nui = re.sub(r'\D', '', g('nui'))
            if not nui or not g('name'):
                continue
            emp = g('employees')
            emp = str(int(float(emp))) if re.fullmatch(r'\d+(\.0+)?', emp or '') else ''
            year, month = g('year'), g('month')
            year = str(int(float(year))) if re.fullmatch(r'\d+(\.0+)?', year or '') else ''
            registered = f"{year}-{MONTHS.get(month, 0):02d}" if year else ''
            w.writerow([nui, g('name'), g('trade_name'), g('legal_form'), g('activity'), g('sector'), emp, g('size'), g('city'), g('status'),
                        registered, excel_date(g('dissolved_on'))])
            n += 1
    print(f'{n} businesses')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
