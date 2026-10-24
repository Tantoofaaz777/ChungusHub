#!/usr/bin/env bash
# One-time migration for an existing Linux systemd service. Does not restart it.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
service=${CHUNGUS_SERVICE_NAME:-chungushub}
[[ "$service" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo '[ChungusHub] Invalid service name.' >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo '[ChungusHub] This setup is for Linux systemd services.' >&2; exit 1; }
owner=$(id -un)
service_owner=$(systemctl show "$service" --property=User --value --no-pager)
[[ -n "$service_owner" && "$service_owner" == "$owner" ]] || { echo '[ChungusHub] Run this as the existing service user. The service must already exist with an explicit User setting.' >&2; exit 1; }
service_repo=$(systemctl show "$service" --property=WorkingDirectory --value --no-pager)
[[ -n "$service_repo" && "$(cd "$service_repo" && pwd)" == "$repo" ]] || { echo '[ChungusHub] Run setup from the repository already used as this service working directory.' >&2; exit 1; }
chungus_bun=$(bash "$repo/scripts/ensure-bun.sh" --managed)
runtime_root=$(dirname "$(dirname "$chungus_bun")")

staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
# systemd uses its own quoting and percent specifiers, not shell escaping.
unit_value() {
    local value=$1
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    value=${value//\\/\\\\}; value=${value//\"/\\\"}; value=${value//%/%%}
    printf '%s' "$value"
}
# WorkingDirectory takes one path, not a command-line word: its parser does not
# remove quotes or C escapes. Internal spaces are literal; only % specifiers expand.
[[ "$repo" != *$'\n'* && "$repo" != *$'\r'* ]] || { echo '[ChungusHub] Service directory cannot contain line breaks.' >&2; exit 1; }
unit_repo=${repo//%/%%}
unit_bun=$(unit_value "$chungus_bun")
unit_bun=${unit_bun//\$/\$\$}
unit_bin=$(unit_value "$(dirname "$chungus_bun")")
cat > "$staging/runtime.conf" <<EOF
[Service]
WorkingDirectory=$unit_repo
ExecStart=
ExecStart="$unit_bun" server/index.ts
Environment="PATH=$unit_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EOF
if command -v systemd-analyze >/dev/null 2>&1; then
    {
        printf '[Unit]\nDescription=ChungusHub runtime configuration check\nDefaultDependencies=no\n'
        cat "$staging/runtime.conf"
    } > "$staging/chungus-runtime-check.service"
    if ! systemd-analyze verify --man=no "$staging/chungus-runtime-check.service"; then
        echo '[ChungusHub] Generated service configuration failed validation; existing service configuration was kept.' >&2
        exit 1
    fi
fi
{
    printf '#!/usr/bin/env bash\n'
    printf 'export CHUNGUS_SERVICE_NAME=%q\n' "$service"
    printf 'export CHUNGUS_RUNTIME_DIR=%q\n' "$runtime_root"
    printf 'exec bash %q "$@"\n' "$repo/scripts/chungus-update.sh"
} > "$staging/chungus-update"
dropin="/etc/systemd/system/$service.service.d/zz-chungus-runtime.conf"
updater=/usr/local/bin/chungus-update
sudo mkdir -p "/etc/systemd/system/$service.service.d"
for path in "$dropin" "$updater"; do
    if sudo test -e "$path" && ! sudo test -e "$path.before-managed-runtime"; then sudo cp -a "$path" "$path.before-managed-runtime"; fi
done
sudo install -m 0644 "$staging/runtime.conf" "$dropin"
sudo install -m 0755 "$staging/chungus-update" "$updater"
sudo systemctl daemon-reload
configured=$(systemctl show "$service" --property=ExecStart --value --no-pager)
[[ "$configured" == *"path=$chungus_bun ;"* ]] || { echo '[ChungusHub] systemd did not accept the managed executable. Inspect systemctl status and systemctl cat before restarting.' >&2; exit 1; }
echo '[ChungusHub] Managed runtime and chungus-update configured. The running service was not restarted.'
echo '[ChungusHub] Run chungus-update to build and restart with the managed runtime.'
