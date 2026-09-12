param(
    [Parameter(Mandatory=$true)][string]$ProjectPath,
    [switch]$Enable,
    [switch]$Autoload
)
$ErrorActionPreference = 'Stop'
$Project = (Resolve-Path $ProjectPath).Path
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $Root
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    $Arguments = @('dist/cli/index.js', 'install', $Project)
    if ($Enable) { $Arguments += '--enable' }
    if ($Autoload) { $Arguments += '--autoload' }
    & node @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Installation failed' }
} finally {
    Pop-Location
}
