#!/usr/bin/env python3
"""DrisPRO · the VPS reports to the platform console, every minute (run by cron as root).

    python3 server-monitor.py <db-container>

Sends: CPU, load, memory, swap, disks, network, uptime; every Docker container (state,
health, restarts, CPU, memory); error and warning lines of the containers' logs since the
last run; every five minutes the last 150 lines of each log; the website and API answering
and their SSL certificate. Passwords, keys and tokens are hidden before anything leaves.
Only the Python standard library and the docker command are used.
"""
import json, os, re, socket, ssl, subprocess, sys, time, urllib.request
from datetime import datetime, timezone

DB = sys.argv[1] if len(sys.argv) > 1 else ''
STATE = '/var/lib/drispro-monitor/state.json'
CHECKS = [u for u in os.environ.get('DRISPRO_CHECKS', 'https://erp.dris-ks.com,https://api.erp.dris-ks.com/rest/v1/').split(',') if u]
DISK_PATHS = ['/', '/root/backups', '/var/lib/docker']


def sh(args, timeout=30):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ''


# ---------------------------------------------------------------- hide secrets
SECRET = [
    (re.compile(r'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'), '[token]'),
    (re.compile(r'sk-ant-[A-Za-z0-9_-]+'), '[key]'),
    (re.compile(r'(?i)(bearer\s+)[A-Za-z0-9._-]{12,}'), r'\1[token]'),
    (re.compile(r'(?i)\b(apikey|api_key|password|passwd|pwd|secret|token|authorization|service_key|access_token)(["\']?\s*[=:]\s*["\']?)[^\s"\'&,;]+'), r'\1\2[hidden]'),
    (re.compile(r'postgres(ql)?://[^:\s]+:[^@\s]+@'), r'postgres\1://[user]:[hidden]@'),
]


def hide(s):
    for rx, rep in SECRET:
        s = rx.sub(rep, s)
    return s


# ---------------------------------------------------------------- the machine
def cpu_pct():
    def read():
        with open('/proc/stat') as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        return sum(parts), idle
    t1, i1 = read(); time.sleep(1); t2, i2 = read()
    return round(100.0 * (1 - (i2 - i1) / max(t2 - t1, 1)), 1)


def meminfo():
    m = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':', 1)
            m[k] = int(v.split()[0]) * 1024
    return m


def disks():
    out, seen = [], set()
    for p in DISK_PATHS:
        if not os.path.exists(p):
            continue
        st = os.statvfs(p)
        key = (st.f_blocks, st.f_frsize)
        if key in seen:
            continue
        seen.add(key)
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        out.append({'mount': p, 'total': total, 'used': total - st.f_bfree * st.f_frsize, 'free': free,
                    'inodes_pct': round(100.0 * (1 - st.f_favail / st.f_files), 1) if st.f_files else None})
    return out


def net():
    rx = tx = 0
    with open('/proc/net/dev') as f:
        for line in f.readlines()[2:]:
            name, data = line.split(':', 1)
            name = name.strip()
            if name == 'lo' or name.startswith(('veth', 'docker', 'br-', 'cni', 'flannel', 'virbr')):
                continue
            v = data.split()
            rx += int(v[0]); tx += int(v[8])
    return rx, tx


def host():
    osname = ''
    try:
        with open('/etc/os-release') as f:
            for line in f:
                if line.startswith('PRETTY_NAME='):
                    osname = line.split('=', 1)[1].strip().strip('"')
    except Exception:
        pass
    docker_v = sh(['docker', 'version', '--format', '{{.Server.Version}}']).strip()
    return {'hostname': socket.gethostname(), 'os': osname, 'kernel': os.uname().release, 'docker': docker_v,
            'boot': datetime.fromtimestamp(time.time() - float(open('/proc/uptime').read().split()[0]), timezone.utc).isoformat()}


def check(url):
    r = {'name': url.split('/')[2], 'url': url}
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'drispro-monitor'})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                r['status'] = res.status
        except urllib.error.HTTPError as e:   # the API answers 401 without a key: it is up
            r['status'] = e.code
        r['ms'] = int((time.time() - t0) * 1000)
        r['ok'] = r['status'] < 500
    except Exception as e:
        r['ok'] = False; r['error'] = str(e)[:200]; r['ms'] = int((time.time() - t0) * 1000)
    try:
        h = url.split('/')[2]
        ctx = ssl.create_default_context()
        with socket.create_connection((h, 443), timeout=8) as s, ctx.wrap_socket(s, server_hostname=h) as ss:
            na = ss.getpeercert()['notAfter']
        r['cert_days'] = int((ssl.cert_time_to_seconds(na) - time.time()) // 86400)
    except Exception:
        pass
    return r


# ---------------------------------------------------------------- docker
def size(s):
    m = re.match(r'([\d.]+)\s*([KMGT]?i?B)', s.strip())
    if not m:
        return None
    n = float(m.group(1)); u = m.group(2)
    mult = {'B': 1, 'KB': 1e3, 'MB': 1e6, 'GB': 1e9, 'TB': 1e12, 'KiB': 1024, 'MiB': 1024 ** 2, 'GiB': 1024 ** 3, 'TiB': 1024 ** 4}
    return int(n * mult.get(u, 1))


def containers():
    rows = {}
    for line in sh(['docker', 'ps', '-a', '--format', '{{json .}}']).splitlines():
        try:
            x = json.loads(line)
        except Exception:
            continue
        rows[x['Names']] = {'name': x['Names'], 'image': x.get('Image'), 'state': x.get('State'), 'status': x.get('Status')}
    if not rows:
        return []
    fmt = '{{.Name}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.StartedAt}}|{{.HostConfig.RestartPolicy.Name}}|{{.State.ExitCode}}'
    for line in sh(['docker', 'inspect', '--format', fmt] + list(rows)).splitlines():
        n, rc, health, started, policy, code = (line.split('|') + [''] * 6)[:6]
        n = n.lstrip('/')
        if n in rows:
            rows[n].update({'restarts': int(rc or 0), 'health': health, 'started_at': started if not started.startswith('0001') else '',
                            'restart_policy': policy or 'no', 'exit_code': int(code) if code.lstrip('-').isdigit() else None})
    for line in sh(['docker', 'stats', '--no-stream', '--format', '{{json .}}'], timeout=40).splitlines():
        try:
            x = json.loads(line)
        except Exception:
            continue
        n = x.get('Name')
        if n in rows:
            used, _, limit = x.get('MemUsage', '').partition('/')
            rows[n].update({'cpu_pct': float(x.get('CPUPerc', '0').rstrip('%') or 0), 'mem_bytes': size(used), 'mem_limit': size(limit),
                            'net_io': x.get('NetIO'), 'block_io': x.get('BlockIO')})
    return list(rows.values())


ERR = re.compile(r'(?i)\b(error|fatal|panic|exception|traceback|crit(ical)?|segfault|out of memory|oom)\b')
WARN = re.compile(r'(?i)\b(warn(ing)?)\b')
NOISE = re.compile(r'(?i)(error_count=0|errors?: 0\b|no error|"level":"info"|request body is buffered to a temporary file|upstream response is buffered to a temporary file)')


def logs(names, since):
    out = []
    for n in names:
        text = sh(['docker', 'logs', '--timestamps', '--since', since, '--tail', '2000', n], timeout=20)
        text += sh_err(['docker', 'logs', '--timestamps', '--since', since, '--tail', '2000', n])
        k = 0
        for line in text.splitlines():
            if NOISE.search(line):
                continue
            lvl = 'error' if ERR.search(line) else 'warn' if WARN.search(line) else None
            if not lvl:
                continue
            at, _, rest = line.partition(' ')
            out.append({'container': n, 'at': at if at[:2] == '20' else '', 'level': lvl, 'line': hide(rest or line)[:2000]})
            k += 1
            if k >= 60:   # a container that writes errors in a loop: enough of them
                break
    return out


def sh_err(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=20).stderr
    except Exception:
        return ''


def tails(names):
    out = []
    for n in names:
        r = subprocess.run(['docker', 'logs', '--timestamps', '--tail', '150', n], capture_output=True, text=True, timeout=20)
        lines = sorted((r.stdout + r.stderr).splitlines())[-150:]
        out.append({'container': n, 'lines': hide('\n'.join(lines))})
    return out


# ---------------------------------------------------------------- send
def send(payload):
    if not DB:
        print(json.dumps(payload)[:2000]); return
    pw = sh(['docker', 'exec', DB, 'printenv', 'POSTGRES_PASSWORD']).strip()
    body = json.dumps(payload).replace('$J$', '$ J$')
    sql = 'select drispro_meta.server_report($J$' + body + '$J$::jsonb);'
    for user in ('supabase_admin', 'postgres'):
        r = subprocess.run(['docker', 'exec', '-i', '-e', 'PGPASSWORD=' + pw, DB, 'psql', '-h', '127.0.0.1', '-U', user, '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'],
                           input=sql, capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            return
    sys.stderr.write('could not report: ' + r.stderr[-500:] + '\n')


def main():
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    try:
        state = json.load(open(STATE))
    except Exception:
        state = {}
    now = int(time.time())
    since = str(state.get('last', now - 120))
    m = meminfo()
    rx, tx = net()
    load = os.getloadavg()
    sample = {'cpu_pct': cpu_pct(), 'load1': round(load[0], 2), 'load5': round(load[1], 2), 'load15': round(load[2], 2), 'cores': os.cpu_count(),
              'mem_total': m.get('MemTotal'), 'mem_available': m.get('MemAvailable'), 'swap_total': m.get('SwapTotal'),
              'swap_used': (m.get('SwapTotal', 0) - m.get('SwapFree', 0)), 'net_rx': rx, 'net_tx': tx,
              'uptime_s': int(float(open('/proc/uptime').read().split()[0])), 'disks': disks(), 'checks': [check(u) for u in CHECKS], 'host': host()}
    cs = containers()
    running = [c['name'] for c in cs if c.get('state') == 'running']
    payload = {'sample': sample, 'containers': cs, 'logs': logs(running, since)}
    if now // 60 % 5 == 0 or not state.get('tails'):
        payload['tails'] = tails([c['name'] for c in cs])
        state['tails'] = now
    send(payload)
    state['last'] = now
    json.dump(state, open(STATE, 'w'))


if __name__ == '__main__':
    main()
