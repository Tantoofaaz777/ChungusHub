param([switch]$Managed, [string]$RuntimeRoot = $env:CHUNGUS_RUNTIME_DIR)

# Dot-source for launchers/tests. Running this file directly prints only the selected path.
$script:ChungusBunManifest = Join-Path $PSScriptRoot 'bun-runtime.txt'

function Test-ChungusBunVersion([string]$Version, [string]$Minimum) {
    if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$') { return $false }
    $parts = @($Matches[1], $Matches[2], $Matches[3])
    $floor = $Minimum.Split('.')
    if ($floor.Count -ne 3) { return $false }
    for ($i = 0; $i -lt 3; $i++) {
        if ($parts[$i].Length -ne $floor[$i].Length) { return $parts[$i].Length -gt $floor[$i].Length }
        $order = [string]::CompareOrdinal($parts[$i], $floor[$i])
        if ($order -ne 0) { return $order -gt 0 }
    }
    return $true
}

function Get-ChungusBunVersion([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    try {
        $found = & $Path --version 2>$null
        if ($LASTEXITCODE -eq 0) { return ($found -join "`n").Trim() }
    } catch { }
    return ''
}

function Find-ChungusSystemBun {
    $command = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $fallback = Join-Path $env:USERPROFILE '.bun/bin/bun.exe'
    if (Test-Path -LiteralPath $fallback -PathType Leaf) { return $fallback }
    return $null
}

function Get-ChungusWindowsTarget {
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture) {
        'AMD64' { return 'windows-x64' }
        'ARM64' { return 'windows-aarch64' }
        default { throw '[ChungusHub] Unsupported Windows CPU architecture.' }
    }
}

function Save-ChungusBunArchive([string]$Url, [string]$Path) {
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -TimeoutSec 180 -ErrorAction Stop
}

function Get-ChungusBun([switch]$Managed, [string]$RuntimeRoot = $env:CHUNGUS_RUNTIME_DIR) {
    $ErrorActionPreference = 'Stop'
    $rows = @{}
    foreach ($line in Get-Content -LiteralPath $script:ChungusBunManifest) {
        if ($line -match '^\s*(#|$)') { continue }
        $fields = $line.Trim() -split '\s+'
        $rows[$fields[0]] = @($fields | Select-Object -Skip 1)
    }
    $minimum = $rows['minimum'][0]
    $approved = $rows['version'][0]
    if (-not (Test-ChungusBunVersion $approved $minimum)) { throw '[ChungusHub] Invalid Bun release manifest.' }
    $target = Get-ChungusWindowsTarget
    $artifact, $checksum = $rows[$target]
    if ($artifact -ne "bun-$target.zip" -or $checksum -notmatch '^[a-f0-9]{64}$') { throw '[ChungusHub] No approved Bun download for this platform.' }
    if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $env:LOCALAPPDATA 'ChungusHub/runtime' }
    if (-not [IO.Path]::IsPathRooted($RuntimeRoot)) { throw '[ChungusHub] Runtime directory must be an absolute directory path.' }
    $RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\', '/')
    if (-not $RuntimeRoot -or $RuntimeRoot -eq [IO.Path]::GetPathRoot($RuntimeRoot).TrimEnd('\', '/')) { throw '[ChungusHub] Runtime directory cannot be a drive root.' }
    # Versioned Windows paths avoid replacing an executable another Chungus window is using.
    $destinationDir = Join-Path $RuntimeRoot "bun-$approved/$($artifact.Replace('.zip', ''))"
    $destination = Join-Path $destinationDir 'bun.exe'
    if (Test-ChungusBunVersion (Get-ChungusBunVersion $destination) $minimum) { return $destination }
    if (-not $Managed) {
        $candidate = Find-ChungusSystemBun
        if ($candidate -and (Test-ChungusBunVersion (Get-ChungusBunVersion $candidate) $minimum)) { return $candidate }
    }
    [void][IO.Directory]::CreateDirectory($RuntimeRoot)
    if ((Get-Item -LiteralPath $RuntimeRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '[ChungusHub] Managed runtime directory must not be a link.' }
    $lock = $null
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        try { $lock = [IO.File]::Open((Join-Path $RuntimeRoot '.install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); break }
        catch [IO.IOException] { Start-Sleep -Seconds 1 }
    }
    if (-not $lock) { throw '[ChungusHub] Another Bun installation is still running. Retry after it finishes.' }
    $staging = Join-Path $RuntimeRoot ('.install.' + [guid]::NewGuid().ToString('N'))
    try {
        if (Test-ChungusBunVersion (Get-ChungusBunVersion $destination) $minimum) { return $destination }
        [void][IO.Directory]::CreateDirectory($staging)
        [Console]::Error.WriteLine("[ChungusHub] Installing private Bun $approved ($target)...")
        $archivePath = Join-Path $staging 'runtime.zip'
        Save-ChungusBunArchive "https://github.com/oven-sh/bun/releases/download/bun-v$approved/$artifact" $archivePath
        $inputStream = [IO.File]::OpenRead($archivePath)
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hasher.ComputeHash($inputStream)).Replace('-', '').ToLowerInvariant() }
        finally { $hasher.Dispose(); $inputStream.Dispose() }
        if ($actual -ne $checksum) { throw '[ChungusHub] Bun download checksum mismatch; existing runtime was kept.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        try { $archive = [IO.Compression.ZipFile]::OpenRead($archivePath) }
        catch { throw '[ChungusHub] Bun archive could not be read; existing runtime was kept.' }
        $extracted = Join-Path $staging 'bun.exe'
        try {
            $entry = $archive.GetEntry("$($artifact.Replace('.zip', ''))/bun.exe")
            if (-not $entry) { throw '[ChungusHub] Bun archive does not contain the expected executable.' }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extracted)
        } finally { $archive.Dispose() }
        if ((Get-ChungusBunVersion $extracted) -ne $approved) { throw '[ChungusHub] Downloaded Bun reported an unexpected version; existing runtime was kept.' }
        [void][IO.Directory]::CreateDirectory($destinationDir)
        if (Test-Path -LiteralPath $destination) { [IO.File]::Replace($extracted, $destination, $null) }
        else { [IO.File]::Move($extracted, $destination) }
        return $destination
    } finally {
        $lock.Dispose()
        $absoluteStaging = [IO.Path]::GetFullPath($staging)
        $prefix = $RuntimeRoot + [IO.Path]::DirectorySeparatorChar
        if ($absoluteStaging.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($absoluteStaging).StartsWith('.install.') -and (Test-Path -LiteralPath $absoluteStaging)) {
            Remove-Item -LiteralPath $absoluteStaging -Recurse -Force
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Get-ChungusBun -Managed:$Managed -RuntimeRoot $RuntimeRoot }
    catch { Write-Error $_; exit 1 }
}
