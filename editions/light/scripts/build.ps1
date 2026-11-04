param([switch]$Latest)
. (Join-Path $PSScriptRoot '_common.ps1')

Invoke-Preflight
Prepare-Node -Latest:$Latest
Ensure-NpmDependencies
Prepare-RustWorkspace

Write-Host 'Running Rust validation/tests from isolated staging workspace...'
Invoke-RustTestSuite
Invoke-RustLicenseAudit
Build-EngineRelease
Copy-EngineForPackaging

Write-Host 'Running renderer/Electron security tests with high-detail diagnostics...'
Invoke-NodeTestSuite
Write-Host 'Build PASS. Engine staged under gui/resources/engine/. Nothing was launched.'
