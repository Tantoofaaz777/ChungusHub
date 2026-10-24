#!/usr/bin/env bash
# ChungusHub dev launcher for macOS and Linux, the counterpart of dev.ps1.
#   Frontend: Vite dev server with hot reload: save a file, see it instantly,
#             no build step.
#   Backend:  Bun server with --watch, auto-restarting when server code changes.
#   Vite proxies /api, /files and /ws to the Bun server, so the app behaves
#   exactly like production (single origin) while staying fast to iterate on.
#
#   Q = quit (stops both processes)
# Both run as background jobs under job control, so each one leads its own
# process group and quitting kills those groups only, never every bun on the
# machine.

set -u
cd "$(dirname "$0")"

chungus_bun=$(bash scripts/ensure-bun.sh) || exit 1
export PATH="$(dirname "$chungus_bun"):$PATH"
"$chungus_bun" install --frozen-lockfile || exit $?

if [ -t 1 ]; then
    cyan=$'\033[36m'; green=$'\033[32m'; red=$'\033[31m'; gray=$'\033[90m'; reset=$'\033[0m'
    printf '\033]0;ChungusHub (dev)\007'
else
    cyan=''; green=''; red=''; gray=''; reset=''
fi

set -m

server_pid=''
vite_pid=''

stop_all() {
    for pid in "$server_pid" "$vite_pid"; do
        # Negative PID: the whole process group, so ports are released cleanly.
        [ -n "$pid" ] && kill -TERM -"$pid" 2>/dev/null
    done
    server_pid=''
    vite_pid=''
}
trap stop_all EXIT
trap 'exit 130' INT TERM

printf '\n%s[ChungusHub] Starting backend (bun --watch)...%s\n' "$cyan" "$reset"
"$chungus_bun" --watch server/index.ts </dev/null &
server_pid=$!

printf '%s[ChungusHub] Starting frontend (vite dev, hot reload)...%s\n' "$cyan" "$reset"
# Empty stdin for the children. Without it Vite grabs this terminal's keyboard for
# its own shortcuts and our [B]/[Q] keys never arrive.
"$chungus_bun" run dev </dev/null &
vite_pid=$!

printf '\n'
printf '%s  This Mac  ->  http://localhost:1420   (hot reload, no rebuild)%s\n' "$green" "$reset"
printf '%s  Phone/LAN ->  open the "Network:" URL Vite prints above (http://<this-Mac-ip>:1420)%s\n' "$green" "$reset"
# Off by default, and while it is off the port is closed to the network with no page and no
# log, so a phone following the line above just hangs. Say so where the line is read.
printf '%s                Turn Network Access on first (Settings -> Security), or nothing answers there.%s\n' "$green" "$reset"
printf '%s  :4242 serves the built PWA; only rebuild it with [B] if you need the production build.%s\n' "$gray" "$reset"

# No terminal to read keys from (an editor task, a piped run): hold both processes
# until Ctrl-C instead of quitting on the first failed read.
if [ ! -t 0 ]; then
    printf '\n%s  No terminal for keys. Ctrl-C stops both processes.%s\n' "$gray" "$reset"
    wait
    exit 0
fi

while true; do
    printf '\n%s  [B] Build client (build/ for the :4242 server / phone)   [Q] Quit%s\n' "$gray" "$reset"
    IFS= read -rsn 1 key || break
    case "$key" in
        q | Q) break ;;
        b | B)
            printf '\n%s[ChungusHub] Building client (build/ for the :4242 server)...%s\n' "$cyan" "$reset"
            if "$chungus_bun" run build; then
                printf '%s[ChungusHub] Build done. Hard-refresh the phone to pick it up.%s\n' "$green" "$reset"
            else
                printf '%s[ChungusHub] Build failed.%s\n' "$red" "$reset"
            fi
            ;;
    esac
done
