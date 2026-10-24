#!/usr/bin/env bash
# Installed wrapper points here, so git pull also updates the updater itself.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
service=${CHUNGUS_SERVICE_NAME:-chungushub}
[[ "$service" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo '[ChungusHub] Invalid service name.' >&2; exit 1; }

echo '[ChungusHub] Updating repository...'
git pull --ff-only origin main
chungus_bun=$(bash "$repo/scripts/ensure-bun.sh" --managed)
export PATH="$(dirname "$chungus_bun"):$PATH"
configured=$(systemctl show "$service" --property=ExecStart --value --no-pager)
if [[ "$configured" != *"path=$chungus_bun ;"* ]]; then
    echo '[ChungusHub] Service does not use the managed runtime. Run bash scripts/setup-updater.sh once before updating.' >&2
    exit 1
fi

health_url=${CHUNGUS_HEALTH_URL:-}
if [[ -z "$health_url" ]]; then
    # Match the service's override, not an unrelated port in this SSH shell.
    service_environment=$(systemctl show "$service" --property=Environment --value --no-pager)
    service_port=''
    if [[ "$service_environment" =~ (^|[[:space:]\"])CHUNGUS_PORT=([0-9]+)($|[[:space:]\"]) ]]; then service_port=${BASH_REMATCH[2]}; fi
    port=$(CHUNGUS_SERVICE_PORT="$service_port" "$chungus_bun" -e '
        const fs = require("node:fs");
        const config = fs.existsSync("chungushub.config.json") ? JSON.parse(fs.readFileSync("chungushub.config.json", "utf8")) : {};
        const port = Number(process.env.CHUNGUS_SERVICE_PORT || (config.port ?? 4242));
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Set CHUNGUS_HEALTH_URL for this service port.");
        console.log(port);
    ')
    health_url="http://127.0.0.1:$port/api/health"
fi
echo '[ChungusHub] Installing dependencies and building...'
"$chungus_bun" install --frozen-lockfile
"$chungus_bun" run build
sudo systemctl restart "$service"
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 \
    --connect-timeout 3 --max-time 10 --output /dev/null "$health_url"
systemctl is-active --quiet "$service"
echo '[ChungusHub] Updated and running.'
