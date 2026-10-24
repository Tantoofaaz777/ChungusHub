# ChungusHub dev launcher.
#   Frontend: Vite dev server with hot reload: save a file, see it instantly,
#             no build step.
#   Backend:  Bun server with --watch, auto-restarting when server code changes.
#   Vite proxies /api, /files and /ws to the Bun server, so the app behaves
#   exactly like production (single origin) while staying fast to iterate on.
#
#   Q = quit (stops both processes)
# Both run as child processes so we only ever kill *these* instances, never
# every bun.exe on the machine.

Set-Location -Path $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'ChungusHub (dev)'

. (Join-Path $PSScriptRoot 'scripts/ensure-bun.ps1')
try { $chungusBun = Get-ChungusBun }
catch { Write-Error $_; exit 1 }
$env:PATH = "$(Split-Path -Parent $chungusBun);$env:PATH"
# A fresh clone can launch without a separate dependency-install command.
& $chungusBun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$script:server = $null
$script:vite = $null

# Empty stdin sink for the child processes. Without this, Vite (running -NoNewWindow)
# grabs this window's keyboard for its own shortcuts and our [B]/[Q] keys never arrive.
# Redirecting their stdin to an empty file leaves the keyboard to this launcher.
$stdinSink = Join-Path $env:TEMP 'chungushub-dev-stdin'
if (-not (Test-Path $stdinSink)) { New-Item -ItemType File -Path $stdinSink | Out-Null }

function Stop-All {
    foreach ($proc in @($script:server, $script:vite)) {
        if ($proc -and -not $proc.HasExited) {
            # /T kills the whole process tree so ports are released cleanly.
            taskkill /PID $proc.Id /T /F | Out-Null
        }
    }
    $script:server = $null
    $script:vite = $null
}

Write-Host ''
Write-Host '[ChungusHub] Starting backend (bun --watch)...' -ForegroundColor Cyan
$script:server = Start-Process -FilePath $chungusBun -ArgumentList '--watch', 'server/index.ts' -NoNewWindow -PassThru -RedirectStandardInput $stdinSink

Write-Host '[ChungusHub] Starting frontend (vite dev, hot reload)...' -ForegroundColor Cyan
$script:vite = Start-Process -FilePath $chungusBun -ArgumentList 'run', 'dev' -NoNewWindow -PassThru -RedirectStandardInput $stdinSink

Write-Host ''
Write-Host '  This PC   ->  http://localhost:1420   (hot reload, no rebuild)' -ForegroundColor Green
Write-Host '  Phone/LAN ->  open the "Network:" URL Vite prints above (http://<this-PC-ip>:1420)' -ForegroundColor Green
# Off by default, and while it is off the port is closed to the network with no page and no
# log, so a phone following the line above just hangs. Say so where the line is read.
Write-Host '                Turn Network Access on first (Settings -> Security), or nothing answers there.' -ForegroundColor Green
Write-Host '  :4242 serves the built PWA; only rebuild it with [B] if you need the production build.' -ForegroundColor DarkGray

try {
    while ($true) {
        Write-Host ''
        Write-Host '  [B] Build client (build/ for the :4242 server / phone)   [Q] Quit' -ForegroundColor DarkGray
        $key = [Console]::ReadKey($true)
        $ch = [char]::ToLower($key.KeyChar)
        if ($ch -eq 'q') { break }
        elseif ($ch -eq 'b') {
            Write-Host ''
            Write-Host '[ChungusHub] Building client (build/ for the :4242 server)...' -ForegroundColor Cyan
            & $chungusBun run build
            if ($LASTEXITCODE -eq 0) {
                Write-Host '[ChungusHub] Build done. Hard-refresh the phone to pick it up.' -ForegroundColor Green
            } else {
                Write-Host '[ChungusHub] Build failed.' -ForegroundColor Red
            }
        }
    }
}
finally {
    Stop-All
}
