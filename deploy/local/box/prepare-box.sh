#!/usr/bin/env bash
# DrisPRO Box: makes a fresh mini-PC (Ubuntu Server 24.04 or 22.04) into the shop's DrisPRO server.
#
#   sudo LICENCE=NXS-XXXX-XXXX-XXXX bash box/prepare-box.sh
# Options (environment):
#   LICENCE     the client's licence code (asked by install.sh when missing)
#   BOX_NAME    the name on the network (drispro) -> http://drispro.local
#   HTTP_PORT   port of the app (80)
#   STATIC_IP   e.g. 192.168.1.20/24 to fix the address here (better: reserve it in the router)
#   GATEWAY     the router, with STATIC_IP (found by itself)
#   TUNNEL_TOKEN  Cloudflare tunnel, to open DrisPRO from outside the shop
#
# Run it from the unpacked drispro-server folder. It can be run again: it keeps the data.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run as root: sudo bash box/prepare-box.sh"
[ -f "$src/install.sh" ] || die "Run this from the unpacked drispro-server folder"
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = ubuntu ] || [ "${ID:-}" = debian ] || die "DrisPRO Box needs Ubuntu Server (24.04) or Debian"
name="${BOX_NAME:-drispro}"
port="${HTTP_PORT:-80}"
export DEBIAN_FRONTEND=noninteractive

say "1/8 System packages"
apt-get update -qq
apt-get install -y -qq curl openssl ca-certificates avahi-daemon libnss-mdns ufw unattended-upgrades chrony zip unzip >/dev/null

say "2/8 Name on the network: $name.local"
hostnamectl set-hostname "$name" 2>/dev/null || { echo "$name" > /etc/hostname; hostname "$name" 2>/dev/null || true; }
grep -q "127.0.1.1 $name" /etc/hosts || { sed -i '/^127\.0\.1\.1 /d' /etc/hosts; echo "127.0.1.1 $name" >> /etc/hosts; }
systemctl enable --now avahi-daemon >/dev/null 2>&1 || true
systemctl restart avahi-daemon || true

if [ -n "${STATIC_IP:-}" ]; then
  say "   fixed address $STATIC_IP"
  dev="$(ip route show default | awk '{print $5; exit}')"
  gw="${GATEWAY:-$(ip route show default | awk '{print $3; exit}')}"
  [ -n "$dev" ] && [ -n "$gw" ] || die "Network card or router not found; set GATEWAY"
  umask 077
  cat > /etc/netplan/60-drispro.yaml <<EOF
network:
  version: 2
  ethernets:
    $dev:
      dhcp4: false
      addresses: [$STATIC_IP]
      routes: [{ to: default, via: $gw }]
      nameservers: { addresses: [$gw, 1.1.1.1, 8.8.8.8] }
EOF
  umask 022
  netplan apply || die "The fixed address could not be set; remove /etc/netplan/60-drispro.yaml"
fi

say "3/8 Always on: no sleep, the right time"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf 2>/dev/null || true
timedatectl set-timezone Europe/Belgrade 2>/dev/null || true
systemctl enable --now chrony >/dev/null 2>&1 || true
# keep the system log small
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=300M\n' > /etc/systemd/journald.conf.d/drispro.conf
systemctl restart systemd-journald || true

say "4/8 Firewall: only DrisPRO ($port), remote help (22) and the name (5353)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow "$port"/tcp >/dev/null
ufw allow 5353/udp >/dev/null
ufw --force enable >/dev/null

say "5/8 Security updates by themselves (restart at 05:00 when one needs it)"
cat > /etc/apt/apt.conf.d/52drispro-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; "${distro_id}ESMApps:${distro_codename}-apps-security"; "${distro_id}ESM:${distro_codename}-infra-security"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

say "6/8 Docker"
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || printf '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' > /etc/docker/daemon.json
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
# Docker opens its own ports past ufw; DrisPRO only publishes the app port, the rest stays inside

say "7/8 DrisPRO in /opt/nexuserp"
mkdir -p /opt/nexuserp
if [ "$src" != /opt/nexuserp ]; then
  # keep what is there (.env with the keys, data); bring the new program files
  tar -C "$src" --exclude=./.env --exclude=./data -cf - . | tar -C /opt/nexuserp -xf -
fi
install -m 755 "$src/box/drispro-status.sh" /usr/local/bin/drispro-status
cd /opt/nexuserp
ip="$(hostname -I | awk '{print $1}')"
PUBLIC_URL="${PUBLIC_URL:-http://$ip$([ "$port" = 80 ] || echo ":$port")}" HTTP_PORT="$port" bash install.sh

say "8/8 Ready"
echo "DrisPRO Box: http://$name.local$([ "$port" = 80 ] || echo ":$port")  or  http://$ip$([ "$port" = 80 ] || echo ":$port")"
echo "State of the box at any time: sudo drispro-status"
echo "Reserve $ip for this box in the router, so the address never changes."
