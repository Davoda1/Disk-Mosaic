Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { Fail 'Node.js is required for source validation.' }
$Script:NodeBin = $nodeCommand.Source
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
$Script:NpmBin = if ($npmCommand) { $npmCommand.Source } else { $null }
& $NodeBin (Join-Path $PSScriptRoot 'validate-metadata.cjs')
if ($LASTEXITCODE -ne 0) { Fail 'Source metadata validation failed.' }
Invoke-NodeTestSuite
Write-Host 'Source validation PASS. Native Rust tests and binary checks run through scripts/build.ps1.'
