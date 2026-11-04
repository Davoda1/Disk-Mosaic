Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Script:GuiDir = Join-Path $Root 'gui'
$Script:EngineDir = Join-Path $Root 'engine'
$Script:EngineManifest = Join-Path $EngineDir 'Cargo.toml'
$Script:DepsDir = Join-Path $Root 'dependencies'
$Script:ToolingsDir = Join-Path $Root 'toolings'
$Script:NodePointer = Join-Path $ToolingsDir 'node-current.txt'
$Script:RustWorkRoot = Join-Path $DepsDir 'rust-work'
$Script:RustEngineDir = Join-Path $RustWorkRoot 'engine'
$Script:RustEngineManifest = Join-Path $RustEngineDir 'Cargo.toml'
$Script:CargoTargetDir = Join-Path $DepsDir 'cargo-target'

function Fail([string]$Message) { throw $Message }

function Invoke-Preflight {
    if (-not [Environment]::Is64BitOperatingSystem) { Fail 'DiskMosaic targets Windows x86-64; a 64-bit OS is required.' }
    if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) { Fail 'rustc was not found. Install stable Rust and rerun; this script will not modify your Rust installation.' }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { Fail 'cargo was not found. Install stable Rust and rerun.' }

    $cargoHome = Join-Path $DepsDir 'cargo-home'
    $npmCache = Join-Path $DepsDir 'npm-cache'
    $electronCache = Join-Path $DepsDir 'electron-cache'
    $tempDir = Join-Path $DepsDir 'tmp'
    New-Item -ItemType Directory -Force -Path $cargoHome, $npmCache, $electronCache, $tempDir, $CargoTargetDir, $RustWorkRoot, $ToolingsDir, (Join-Path $Root 'dist') | Out-Null

    # Keep all state written by cargo/rustc for these scripts inside the project.
    # The installed rustc/cargo executables are used as-is; rustup is never invoked and
    # no user/global Cargo configuration, PATH, or PowerShell profile is modified.
    $env:CARGO_HOME = $cargoHome
    $env:CARGO_TARGET_DIR = $CargoTargetDir
    $env:TEMP = $tempDir
    $env:TMP = $tempDir

    # Keep Node/Electron caches project-local as well.
    $env:npm_config_cache = $npmCache
    $env:npm_config_audit = 'false'
    $env:npm_config_fund = 'false'
    $env:npm_config_package_lock = 'true'
    $env:ELECTRON_CACHE = $electronCache
    $env:electron_config_cache = $electronCache

    $drive = Get-Item $Root
    $rootDrive = Get-PSDrive -Name $drive.PSDrive.Name
    if ($rootDrive.Free -lt 4GB) { Fail 'At least 4 GiB of free space is recommended for Electron/Rust build dependencies.' }
    Write-Host "Preflight PASS: $(rustc --version); $(cargo --version)"
    Write-Host "Rust build state is isolated under: $cargoHome, $RustWorkRoot and $CargoTargetDir"
}

function Get-CachedNodeDir {
    if (-not (Test-Path $NodePointer)) { return $null }
    $version = (Get-Content -Raw $NodePointer).Trim()
    $dir = Join-Path $ToolingsDir "node-$version-win-x64"
    if (Test-Path (Join-Path $dir 'node.exe')) { return $dir }
    return $null
}

function Get-CurrentNodeLtsVersion {
    Write-Host 'Resolving the current Node.js LTS release...'
    try { $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' }
    catch { Fail "Could not download the Node.js release index. A network connection is required when project-local Node must be prepared or refreshed. $($_.Exception.Message)" }
    $release = $index | Where-Object { $_.lts } | Select-Object -First 1
    if (-not $release) { Fail 'Could not determine the current Node.js LTS version.' }
    return ([string]$release.version).TrimStart('v')
}

function Get-ProjectNode([string]$Version) {
    $nodeDir = Join-Path $ToolingsDir "node-$Version-win-x64"
    if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
        $archiveName = "node-v$Version-win-x64.zip"
        $archive = Join-Path $ToolingsDir $archiveName
        $url = "https://nodejs.org/dist/v$Version/$archiveName"
        $checksums = Join-Path $ToolingsDir "node-v$Version-SHASUMS256.txt"
        Write-Host "Downloading Node.js v$Version LTS into toolings/..."
        Invoke-WebRequest -Uri $url -OutFile $archive
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v$Version/SHASUMS256.txt" -OutFile $checksums
        $escapedName = [regex]::Escape($archiveName)
        $checksumLine = Get-Content $checksums | Where-Object { $_ -match "\s+$escapedName$" } | Select-Object -First 1
        if (-not $checksumLine) { Fail "Could not find a SHA-256 entry for $archiveName." }
        $expected = (($checksumLine -split '\s+')[0]).ToLowerInvariant()
        $actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { Fail "Node.js SHA-256 verification failed for $archiveName." }
        Remove-Item -Force $checksums
        $expanded = Join-Path $ToolingsDir "node-v$Version-win-x64"
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $expanded, $nodeDir
        Expand-Archive -Path $archive -DestinationPath $ToolingsDir -Force
        Move-Item $expanded $nodeDir
        Remove-Item -Force $archive
    }
    return $nodeDir
}

function Use-LatestNpm {
    $latestDir = Join-Path $ToolingsDir 'npm-latest'
    Write-Host 'Latest mode: installing/updating npm@latest inside toolings\npm-latest\...'
    & $Script:NpmBin install --prefix $latestDir --no-save --no-package-lock --no-audit --no-fund npm@latest
    if ($LASTEXITCODE -ne 0) { Fail 'Project-local npm@latest installation failed.' }
    $latestBin = Join-Path $latestDir 'node_modules\.bin\npm.cmd'
    if (-not (Test-Path $latestBin)) { Fail 'npm@latest was installed but its project-local executable was not found.' }
    $Script:NpmBin = $latestBin
}

function Prepare-Node {
    param([switch]$Latest)

    $nodeDir = $null
    if (-not $Latest) {
        $installedNode = Get-Command node -ErrorAction SilentlyContinue
        $installedNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($installedNode -and $installedNpm) {
            $Script:NodeBin = $installedNode.Source
            $Script:NpmBin = $installedNpm.Source
            & $NodeBin -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>26||(a===26&&b>=13)?0:1)'
            if ($LASTEXITCODE -ne 0) { Fail 'Node.js 26.13.0 LTS or newer is required.' }
            Write-Host "Installed Node: $(& $NodeBin --version); npm: $(& $NpmBin --version)"
            return
        }
        $nodeDir = Get-CachedNodeDir
        if (-not $nodeDir) { Fail 'Install Node.js 26.13.0 LTS or newer, or use -Latest to download project-local tooling.' }
    }

    if (-not $nodeDir) {
        $version = Get-CurrentNodeLtsVersion
        $nodeDir = Get-ProjectNode $version
        Set-Content -NoNewline -Path $NodePointer -Value $version
    }

    $env:PATH = "$nodeDir;$env:PATH"
    $Script:NodeBin = Join-Path $nodeDir 'node.exe'
    $Script:NpmBin = Join-Path $nodeDir 'npm.cmd'
    & $NodeBin -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>26||(a===26&&b>=13)?0:1)'
    if ($LASTEXITCODE -ne 0) { Fail 'Cached Node.js is too old. Use -Latest to prepare Node.js 26.13.0 LTS or newer.' }
    if ($Latest) {
        Use-LatestNpm
        Write-Host "Project-local Node: $(& $NodeBin --version); npm: $(& $NpmBin --version) (Latest mode)"
    } else {
        Write-Host "Project-local Node: $(& $NodeBin --version); npm: $(& $NpmBin --version)"
    }
}

function Ensure-NpmDependencies {
    $lock = Join-Path $GuiDir 'package-lock.json'
    if (-not (Test-Path $lock)) { Fail 'The committed gui/package-lock.json is required.' }
    $fingerprint = & $NodeBin (Join-Path $PSScriptRoot 'dependency-fingerprint.cjs') $GuiDir
    if ($LASTEXITCODE -ne 0) { Fail 'Could not fingerprint the dependency lockfile.' }
    $stamp = Join-Path $GuiDir 'node_modules\.diskmosaic-lock-fingerprint'
    $recorded = if (Test-Path $stamp) { (Get-Content -Raw $stamp).Trim() } else { '' }
    $electron = Join-Path $GuiDir 'node_modules\.bin\electron.cmd'
    $packager = Join-Path $GuiDir 'node_modules\.bin\electron-packager.cmd'
    if ($recorded -ne $fingerprint -or -not (Test-Path $electron) -or -not (Test-Path $packager)) {
        Write-Host 'Installing locked project-local Electron dependencies...'
        Push-Location $GuiDir
        try {
            & $NpmBin ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed.' }
        } finally { Pop-Location }
        Set-Content -NoNewline -Encoding utf8 -Path $stamp -Value $fingerprint
    }
}

function ConvertTo-TomlBasicString([string]$Value) {
    return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Prepare-RustWorkspace {
    # Copy the committed lockfile into a disposable staging tree. --locked prevents
    # ordinary builds from silently changing the dependency graph.
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $RustWorkRoot
    $cargoConfigDir = Join-Path $RustEngineDir '.cargo'
    New-Item -ItemType Directory -Force -Path $cargoConfigDir | Out-Null
    $cargoLock = Join-Path $EngineDir 'Cargo.lock'
    if (-not (Test-Path $cargoLock)) { Fail 'The committed engine/Cargo.lock is required.' }
    Copy-Item -Force $EngineManifest $RustEngineManifest
    Copy-Item -Force $cargoLock (Join-Path $RustEngineDir 'Cargo.lock')
    Copy-Item -Recurse -Force (Join-Path $EngineDir 'src') (Join-Path $RustEngineDir 'src')
    Copy-Item -Recurse -Force (Join-Path $Root 'tests') (Join-Path $RustWorkRoot 'tests')

    # Keep build-machine checkout/cache paths out of the shipped Rust executable without
    # touching any persistent Cargo configuration. These rules exist only in dependencies/.
    $maps = @(
        [pscustomobject]@{ From = $RustEngineDir; To = '/usr/src/diskmosaic/engine' },
        [pscustomobject]@{ From = $RustWorkRoot; To = '/usr/src/diskmosaic/rust-work' },
        [pscustomobject]@{ From = $env:CARGO_HOME; To = '/usr/src/cargo' },
        [pscustomobject]@{ From = $CargoTargetDir; To = '/usr/src/diskmosaic/target' },
        [pscustomobject]@{ From = $env:TEMP; To = '/tmp/diskmosaic' },
        [pscustomobject]@{ From = $Root; To = '/usr/src/diskmosaic' }
    )
    $flags = foreach ($map in $maps) {
        $from = ConvertTo-TomlBasicString ([string]$map.From)
        $to = [string]$map.To
        "  `"--remap-path-prefix=$from=$to`""
    }
    $config = "[build]`nrustflags = [`n$($flags -join ",`n")`n]`n"
    $configPath = Join-Path $cargoConfigDir 'config.toml'
    [IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
    Write-Host "Rust source/build paths will be remapped by disposable $configPath"
}


function Write-RustDiagnosticContext {
    Write-Host '--- DiskMosaic Rust diagnostic context ---'
    Write-Host "Project root: $Root"
    Write-Host "Staged manifest: $RustEngineManifest"
    Write-Host "CARGO_HOME: $env:CARGO_HOME"
    Write-Host "CARGO_TARGET_DIR: $env:CARGO_TARGET_DIR"
    Write-Host "TEMP: $env:TEMP"
    Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        Write-Host "Elevated PowerShell: $isAdmin"
    } catch {
        Write-Host "Elevated PowerShell: unavailable ($($_.Exception.Message))"
    }
    Write-Host 'rustc verbose version:'
    & rustc -vV
    Write-Host 'cargo version:'
    & cargo -V
    Write-Host 'Staged Cargo.toml dependency lines:'
    Get-Content $RustEngineManifest | Where-Object { $_ -match '^(name|version|edition|blake3|notify|rusqlite|trash|windows-sys)\s*=' } | ForEach-Object { Write-Host "  $_" }
    Write-Host '--- End Rust diagnostic context ---'
}

function Invoke-RustTestSuite {
    $oldBacktrace = $env:RUST_BACKTRACE
    $env:RUST_BACKTRACE = '1'
    try {
        Write-RustDiagnosticContext
        Push-Location $RustEngineDir
        try {
            Write-Host '[Rust 1/3] Compiling all test targets without running them...'
            & cargo test --locked --manifest-path $RustEngineManifest --no-run
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'Rust test compilation FAILED before any tests executed.' -ForegroundColor Red
                Write-RustDiagnosticContext
                Fail 'Rust test compilation failed. The diagnostic context above is intended to be included with the full build log.'
            }

            $fmtAvailable = $false
            & cargo fmt --version *> $null
            if ($LASTEXITCODE -eq 0) { $fmtAvailable = $true }
            if ($fmtAvailable) {
                Write-Host '[Rust 2/3] Checking Rust formatting in the disposable staging workspace...'
                & cargo fmt --manifest-path $RustEngineManifest --all -- --check
                if ($LASTEXITCODE -ne 0) {
                    Write-Host 'Rust formatting check reported differences. This is diagnostic-only and does not block compilation/tests.' -ForegroundColor Yellow
                }
            } else {
                Write-Host '[Rust 2/3] rustfmt is not installed; formatting check SKIPPED.'
            }

            Write-Host '[Rust 3/3] Running tests sequentially with captured output disabled and backtraces enabled...'
            & cargo test --locked --manifest-path $RustEngineManifest -- --nocapture --test-threads=1
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'Rust test suite FAILED. Running focused diagnostic passes by subsystem...' -ForegroundColor Red
                $filters = @(
                    'analysis::tests::',
                    'history::tests::',
                    'filetype::tests::',
                    'model::tests::',
                    'watcher::tests::',
                    'duplicates::tests::',
                    'snapshot::tests::',
                    'scanner::tests::'
                )
                foreach ($filter in $filters) {
                    Write-Host "--- Focused Rust diagnostics: $filter ---"
                    & cargo test --locked --manifest-path $RustEngineManifest $filter -- --nocapture --test-threads=1
                    Write-Host "--- Focused result: $filter exit code $LASTEXITCODE ---"
                }
                Write-RustDiagnosticContext
                Fail 'Rust tests failed. The full log now includes sequential output, backtraces, environment details and focused subsystem reruns.'
            }
        } finally {
            Pop-Location
        }
    } finally {
        if ($null -eq $oldBacktrace) { Remove-Item Env:RUST_BACKTRACE -ErrorAction SilentlyContinue }
        else { $env:RUST_BACKTRACE = $oldBacktrace }
    }
}


function Write-NodeDiagnosticContext {
    Write-Host '--- DiskMosaic Node/static diagnostic context ---'
    Write-Host "Project root: $Root"
    Write-Host "GUI directory: $GuiDir"
    Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
    if ($Script:NodeBin -and (Test-Path $Script:NodeBin)) { Write-Host "Node: $(& $Script:NodeBin --version)" }
    elseif (Get-Command node -ErrorAction SilentlyContinue) { Write-Host "Node: $(node --version)" }
    else { Write-Host 'Node: unavailable' }
    if ($Script:NpmBin -and (Test-Path $Script:NpmBin)) { Write-Host "npm: $(& $Script:NpmBin --version)" }
    elseif (Get-Command npm -ErrorAction SilentlyContinue) { Write-Host "npm: $(npm --version)" }
    else { Write-Host 'npm: unavailable' }
    Write-Host 'Renderer test files:'
    Get-ChildItem (Join-Path $GuiDir 'tests') -Filter '*.test.cjs' | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name)" }
    Write-Host '--- End Node/static diagnostic context ---'
}

function Invoke-NodeTestSuite {
    $node = $Script:NodeBin
    if (-not $node -or -not (Test-Path $node)) {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $cmd) { Fail 'node was not found for renderer/static validation.' }
        $node = $cmd.Source
    }
    Write-NodeDiagnosticContext
    Write-Host '[Node 1/3] Verifying renderer source...'
    Push-Location $GuiDir
    try {
        & $node 'electron/verify-renderer.cjs'
        if ($LASTEXITCODE -ne 0) { Write-NodeDiagnosticContext; Fail 'Renderer verification failed.' }
    } finally { Pop-Location }

    Write-Host '[Node 2/3] Checking JavaScript/CommonJS syntax file-by-file...'
    $files = Get-ChildItem (Join-Path $GuiDir 'electron'), (Join-Path $GuiDir 'renderer'), (Join-Path $GuiDir 'tests'), (Join-Path $Root 'scripts') -Recurse -File | Where-Object { $_.Extension -in @('.js', '.cjs') }
    foreach ($file in $files) {
        & $node --check $file.FullName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "JavaScript syntax FAILED: $($file.FullName)" -ForegroundColor Red
            Write-NodeDiagnosticContext
            Fail 'JavaScript/CommonJS syntax validation failed.'
        }
    }

    Write-Host '[Node 3/3] Running full static/Electron regression suite with spec reporter...'
    Push-Location $GuiDir
    try {
        & $node --test --test-reporter=spec 'tests/*.test.cjs'
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Node/static suite FAILED. Re-running each test file independently for fault localization...' -ForegroundColor Red
            Get-ChildItem (Join-Path $GuiDir 'tests') -Filter '*.test.cjs' | Sort-Object Name | ForEach-Object {
                Write-Host "--- Focused Node diagnostics: $($_.Name) ---"
                & $node --test --test-reporter=spec $_.FullName
                Write-Host "--- Focused result: $($_.Name) exit code $LASTEXITCODE ---"
            }
            Write-NodeDiagnosticContext
            Fail 'Node/static tests failed. The log includes per-file reruns and environment context.'
        }
    } finally { Pop-Location }
}

function Invoke-RustLicenseAudit {
    $metadata = Join-Path $DepsDir 'rust-license-metadata.json'
    $report = Join-Path $DepsDir 'rust-license-audit.md'
    $licenses = Join-Path $DepsDir 'rust-third-party-licenses.txt'
    Write-Host 'Auditing the exact resolved Rust dependency licenses...'
    Push-Location $RustEngineDir
    try {
        $json = & cargo metadata --locked --format-version 1 --manifest-path $RustEngineManifest
        if ($LASTEXITCODE -ne 0) { Fail 'cargo metadata failed during the Rust dependency licensing audit.' }
    } finally { Pop-Location }
    [IO.File]::WriteAllText($metadata, ($json -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    & $NodeBin (Join-Path $Root 'scripts\audit-rust-licenses.cjs') $metadata $report $licenses
    if ($LASTEXITCODE -ne 0) { Fail 'Rust dependency licensing audit failed.' }
    Remove-Item -Force -ErrorAction SilentlyContinue $metadata
}

function Assert-ReleaseAudit {
    $report = Join-Path $DepsDir 'rust-license-audit.md'
    $licenses = Join-Path $DepsDir 'rust-third-party-licenses.txt'
    if (-not (Test-Path $report)) { Fail 'Resolved Rust license audit is missing. Run scripts\build.ps1 first (or scripts\run.ps1 for the all-in-one flow).' }
    if (-not (Test-Path $licenses)) { Fail 'Collected Rust dependency license texts are missing. Run scripts\build.ps1 first.' }
}

function Test-EngineBuildPaths {
    $source = Join-Path $CargoTargetDir 'release\diskmosaic-engine.exe'
    if (-not (Test-Path $source)) { Fail "Release engine is missing before build-path privacy check: $source" }
    & $NodeBin (Join-Path $Root 'scripts\check-binary-paths.cjs') $source $Root $RustWorkRoot $env:CARGO_HOME $CargoTargetDir $env:TEMP
    if ($LASTEXITCODE -ne 0) { Fail 'Release engine contains a forbidden absolute build-machine path.' }
}

function Build-EngineRelease {
    Write-Host 'Building Rust engine (release) from isolated staging workspace...'
    Push-Location $RustEngineDir
    try {
        & cargo build --locked --release --manifest-path $RustEngineManifest
        if ($LASTEXITCODE -ne 0) { Fail 'Rust release build failed.' }
    } finally { Pop-Location }
    Test-EngineBuildPaths
}

function Copy-EngineForPackaging {
    $source = Join-Path $CargoTargetDir 'release\diskmosaic-engine.exe'
    if (-not (Test-Path $source)) { Fail "Release engine is missing: $source" }
    $dest = Join-Path $GuiDir 'resources\engine'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Force $source (Join-Path $dest 'diskmosaic-engine.exe')
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $dest 'diskmosaic-engine')
}

function Assert-EngineStagedForPackaging {
    $engine = Join-Path $GuiDir 'resources\engine\diskmosaic-engine.exe'
    if (-not (Test-Path $engine)) {
        Fail 'Packaged engine is not staged. Run scripts\build.ps1 first (or scripts\run.ps1 for the all-in-one flow).'
    }
}
