#!/usr/bin/env bash
# No Bun, Node, jq or administrator privileges required. stdout is the selected executable.
set -euo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd)
managed=false
case "${1:-}" in '') ;; --managed) managed=true ;; *) echo 'Usage: ensure-bun.sh [--managed]' >&2; exit 1 ;; esac

minimum=''; approved=''; artifact=''; checksum=''
while read -r key value digest; do
    case "$key" in minimum) minimum=$value ;; version) approved=$value ;; esac
done < "$script_dir/bun-runtime.txt"

version_ok() {
    local version=$1 floor=$2 i left right
    local stable='^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)([+][a-zA-Z0-9-]+([.][a-zA-Z0-9-]+)*)?$'
    [[ "$version" =~ $stable ]] || return 1
    local current=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")
    [[ "$floor" =~ $stable ]] || return 1
    local required=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")
    for i in 0 1 2; do
        left=${current[$i]}; right=${required[$i]}
        # Compare normalized integer strings without arithmetic overflow.
        if ((${#left} > ${#right})); then return 0; fi
        if ((${#left} < ${#right})); then return 1; fi
        [[ "$left" > "$right" ]] && return 0
        [[ "$left" < "$right" ]] && return 1
    done
    return 0
}
usable() { local found; found=$("$1" --version 2>/dev/null) && version_ok "$found" "$minimum"; }
version_ok "$approved" "$minimum" || { echo '[ChungusHub] Invalid Bun release manifest.' >&2; exit 1; }

case "$(uname -s)" in
    Linux) platform=linux; default_root="${XDG_DATA_HOME:-$HOME/.local/share}/chungushub/runtime" ;;
    Darwin) platform=darwin; default_root="$HOME/Library/Application Support/ChungusHub/runtime" ;;
    *) echo '[ChungusHub] Automatic Bun installation supports Linux and macOS here. Use ensure-bun.ps1 on Windows.' >&2; exit 1 ;;
esac
runtime_root=${CHUNGUS_RUNTIME_DIR:-$default_root}
[[ "$runtime_root" == /* && "$runtime_root" != / && "$runtime_root" != *$'\n'* && "$runtime_root" != *$'\r'* ]] || { echo '[ChungusHub] Runtime directory must be an absolute directory path.' >&2; exit 1; }
case "$runtime_root/" in */../*|*/./*) echo '[ChungusHub] Runtime directory cannot contain dot path components.' >&2; exit 1 ;; esac
bun_path="$runtime_root/bin/bun"
if [[ -x "$bun_path" ]] && usable "$bun_path"; then printf '%s\n' "$bun_path"; exit 0; fi
if ! $managed; then
    candidate=$(command -v bun || true)
    if [[ -n "$candidate" ]] && usable "$candidate"; then printf '%s\n' "$candidate"; exit 0; fi
    if [[ -x "$HOME/.bun/bin/bun" ]] && usable "$HOME/.bun/bin/bun"; then printf '%s\n' "$HOME/.bun/bin/bun"; exit 0; fi
fi

case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=aarch64 ;; *) echo '[ChungusHub] Unsupported CPU architecture.' >&2; exit 1 ;; esac
target="$platform-$arch"
if [[ "$platform" == linux ]] && command -v ldd >/dev/null 2>&1; then
    libc=$(ldd --version 2>&1 || true)
    [[ "$libc" != *musl* ]] || target="$target-musl"
fi
while read -r key value digest; do
    if [[ "$key" == "$target" ]]; then artifact=$value; checksum=$digest; fi
done < "$script_dir/bun-runtime.txt"
[[ "$artifact" == "bun-$target.zip" && "$checksum" =~ ^[a-f0-9]{64}$ ]] || { echo '[ChungusHub] No approved Bun download for this platform.' >&2; exit 1; }
for tool in curl unzip; do
    command -v "$tool" >/dev/null 2>&1 || { echo "[ChungusHub] Install $tool to download Bun, then retry." >&2; exit 1; }
done
if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
else echo '[ChungusHub] Install sha256sum or shasum to verify Bun, then retry.' >&2; exit 1; fi
[[ ! -L "$runtime_root" && ! -L "$runtime_root/bin" ]] || { echo '[ChungusHub] Managed runtime directories must not be symbolic links.' >&2; exit 1; }
mkdir -p "$runtime_root/bin"
lock="$runtime_root/.install-lock"
attempt=0
until mkdir "$lock" 2>/dev/null; do
    attempt=$((attempt + 1))
    if ((attempt >= 180)); then echo "[ChungusHub] Another Bun installation holds $lock. Retry after it finishes." >&2; exit 1; fi
    sleep 1
done
staging=''
cleanup() {
    if [[ -n "$staging" && "$staging" == "$runtime_root"/.install.* ]]; then rm -rf -- "$staging"; fi
    rmdir "$lock" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
# Another launcher may have installed while this one waited.
if [[ -x "$bun_path" ]] && usable "$bun_path"; then printf '%s\n' "$bun_path"; exit 0; fi
staging=$(mktemp -d "$runtime_root/.install.XXXXXXXX")
echo "[ChungusHub] Installing private Bun $approved ($target)..." >&2
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --retry 2 --connect-timeout 15 --max-time 180 \
    --output "$staging/runtime.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$approved/$artifact"
if [[ "$hash_tool" == sha256sum ]]; then actual=$(sha256sum < "$staging/runtime.zip")
else actual=$(shasum -a 256 < "$staging/runtime.zip"); fi
[[ "${actual%% *}" == "$checksum" ]] || { echo '[ChungusHub] Bun download checksum mismatch; existing runtime was kept.' >&2; exit 1; }
# Extract only the executable; never let archive paths choose filesystem destinations.
if ! unzip -p "$staging/runtime.zip" "${artifact%.zip}/bun" > "$staging/bun"; then
    echo '[ChungusHub] Bun archive could not be read; existing runtime was kept.' >&2
    exit 1
fi
chmod 755 "$staging/bun"
[[ "$("$staging/bun" --version)" == "$approved" ]] || { echo '[ChungusHub] Downloaded Bun reported an unexpected version; existing runtime was kept.' >&2; exit 1; }
# Same-filesystem rename leaves the old executable intact until validation succeeds.
mv -f "$staging/bun" "$bun_path"
printf '%s\n' "$bun_path"
