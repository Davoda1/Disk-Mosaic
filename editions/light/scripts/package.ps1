param([switch]$Latest)
. (Join-Path $PSScriptRoot '_common.ps1')

# Package-only: first run build.ps1 or use run.ps1 for build + test + package.
Invoke-Preflight
Prepare-Node -Latest:$Latest
Ensure-NpmDependencies
Assert-EngineStagedForPackaging
Assert-ReleaseAudit

$metadata = Get-Content -Raw (Join-Path $GuiDir 'package.json') | ConvertFrom-Json
$prefix = $metadata.build.productName.Replace(' ', '-')
$stem = "$prefix-$($metadata.version)-Windows-x86_64"
$packageDir = Join-Path $Root 'dist\package'
$windowsDir = Join-Path $Root 'dist\windows'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $packageDir
New-Item -ItemType Directory -Force -Path $windowsDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $windowsDir "$stem.zip"), (Join-Path $windowsDir 'SHA256SUM.txt')

Write-Host 'Packaging Windows x86-64 portable ZIP...'
Push-Location $GuiDir
try {
    & $NpmBin run dist:windows
    if ($LASTEXITCODE -ne 0) { Fail 'Electron Packager Windows packaging failed.' }
} finally { Pop-Location }

$artifact = Join-Path $packageDir "$stem.zip"
$unpacked = Join-Path $packageDir 'win-unpacked'
$resourceDir = Join-Path $unpacked 'resources'
foreach ($required in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSING-AUDIT.md', 'RUST_DEPENDENCIES.md', 'RUST_THIRD_PARTY_LICENSES.txt')) {
    if (-not (Test-Path (Join-Path $resourceDir $required))) { Fail "Windows packaged resources are missing $required" }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($unpacked, $artifact, [IO.Compression.CompressionLevel]::Optimal, $false)
if (-not (Test-Path $artifact)) { Fail "Expected package was not produced: $artifact" }
$zip = [IO.Compression.ZipFile]::OpenRead($artifact)
try {
    $expectedExe = "$($metadata.build.productName).exe"
    $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @($expectedExe, 'resources/engine/diskmosaic-engine.exe', 'resources/LICENSE', 'LICENSE.electron.txt', 'LICENSES.chromium.html')) {
        if ($required -notin $names) { Fail "Windows ZIP is missing $required at the expected path." }
    }
} finally { $zip.Dispose() }
Move-Item -Force $artifact (Join-Path $windowsDir "$stem.zip")
& $NodeBin (Join-Path $PSScriptRoot 'write-checksums.cjs') $windowsDir
if ($LASTEXITCODE -ne 0) { Fail 'Artifact checksums could not be written.' }
Write-Host "Windows package written to $windowsDir. Nothing was launched."
