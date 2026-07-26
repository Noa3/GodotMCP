param(
    [string]$TargetConfig = (Join-Path (Get-Location) '.mcp.json')
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$SourceConfig = Join-Path $RootDir '.mcp.example.json'
$TargetDir = Split-Path -Parent $TargetConfig

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

Copy-Item -Path $SourceConfig -Destination $TargetConfig -Force

Write-Host "Wrote MCP config to: $TargetConfig"
Write-Host "Next steps:"
Write-Host "  1. Open your Godot 4 project."
Write-Host "  2. Copy addons/godot_universal_mcp into the project."
Write-Host "  3. Enable the plugin from Project Settings > Plugins."
Write-Host "  4. Run your MCP-compatible client with the generated config."
