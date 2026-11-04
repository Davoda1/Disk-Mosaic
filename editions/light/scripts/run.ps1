param([switch]$Latest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$buildScript = Join-Path $PSScriptRoot 'build.ps1'
$packageScript = Join-Path $PSScriptRoot 'package.ps1'

if ($Latest) {
    & $buildScript -Latest
    & $packageScript -Latest
} else {
    & $buildScript
    & $packageScript
}

Write-Host 'DiskMosaic 1.0.1 all-in-one build + package PASS. Nothing was launched.'
