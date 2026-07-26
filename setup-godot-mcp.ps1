# Godot MCP Setup
$ErrorActionPreference = "Stop"
function WS($m){Write-Host "[OK] $m" -ForegroundColor Green}
function WF($m){Write-Host "[FAIL] $m" -ForegroundColor Red}
function WI($m){Write-Host "     $m" -ForegroundColor Gray}
function WST($m){Write-Host "[SETUP] $m" -ForegroundColor Cyan}
WST "Godot MCP Setup"
$P="E:\OpenMakaiRanch\OpenMakaiRanchGame"
$G="C:\Users\noa3\Documents\GodotMCP"
$E="E:\OpenMakaiRanch\Godot_v4.7-stable_mono_win64.exe"
$H="C:\Users\noa3\AppData\Local\hermes\config.yaml"
WST "1. Prerequisites"
if(!(Test-Path $G)){WF "GodotMCP fehlt: $G";exit 1}
if(!(Test-Path $P)){WF "Projekt fehlt: $P";exit 1}
try{$v=node --version;WS "Node.js: $v"}catch{WF "Node.js fehlt";exit 1}
if(Test-Path $E){WS "Godot: $E"}else{WF "Godot fehlt";exit 1}
WST "2. MCP bauen"
Set-Location $G
npm install
npm run build
if($LASTEXITCODE -ne 0){WF "Build failed";exit 1}
WS "MCP gebaut"
WST "3. Addon kopieren"
$AS="$G\addons\godot_universal_mcp"
$AD="$P\addons\godot_universal_mcp"
if(Test-Path $AD){Remove-Item $AD -Recurse -Force}
Copy-Item $AS $AD -Recurse -Force
$pcfg='[configuration]`nname = "Godot Universal MCP"`ndescription = "Universal MCP bridge for AI-assisted Godot development"`nauthor = "Godot Universal MCP Contributors"`nversion = "0.1.0"`nscript = "plugin.gd"'
Set-Content -Path "$AD\plugin.cfg" -Value $pcfg -Encoding UTF8
WS "Addon kopiert + plugin.cfg gefixt"
WST "4. Plugin aktivieren"
New-Item -ItemType Directory -Path "$P\.godot\plugins\godot_universal_mcp" -Force | Out-Null
$pecfg='[configuration]`nenable = "on"`nconfig = "addons/godot_universal_mcp/plugin.cfg"`nversion = "0.1.0"'
Set-Content -Path "$P\.godot\plugins\godot_universal_mcp\plugin.cfg" -Value $pecfg -Encoding UTF8
WS "Plugin aktiviert"
WST "5. project.godot"
$pg=Get-Content "$P\project.godot" -Raw
if($pg -notmatch "GodotUniversalMcpRuntime"){$pg=$pg -replace "\[autoload\]","`n[autoload]`n  GodotUniversalMcpRuntime=`"*res://addons/godot_universal_mcp/runtime_bridge.gd`""}
if($pg -notmatch "godot_universal_mcp/editor_port"){$pg+="$([char]10)[godot_universal_mcp]$([char]10)editor_port = 9500$([char]10)runtime_port = 9501"}
Set-Content -Path "$P\project.godot" -Value $pg -Encoding UTF8
WS "project.godot updated"
WST "6. Hermes"
if(Test-Path $H){
  $hc=Get-Content $H -Raw
  if($hc -notmatch "godotMCP"){
    $mc="mcp_servers:`n  godotMCP:`n    type: stdio`n    command: npx`n    args:`n      - godot-universal-mcp"
    if($hc -match "mcp_servers:"){$hc=$hc -replace "(mcp_servers:.*)","`$1`n  godotMCP:`n    type: stdio`n    command: npx`n    args:`n      - godot-universal-mcp"}else{$hc+="$([char]10)$mc"}
    Set-Content -Path $H -Value $hc -Encoding UTF8
    WS "Hermes config updated"
  }else{WI "Hermes config exists"}
}
WST "7. VS Code + Open Code"
New-Item -ItemType Directory -Path "$P\.vscode" -Force | Out-Null
$vm=@{servers=@{"godot-universal"=@{type="stdio";command="npx";args=@("godot-universal-mcp")}}}|ConvertTo-Json -Depth 10
Set-Content -Path "$P\.vscode\mcp.json" -Value $vm -Encoding UTF8
$oc=@{mcpServers=@{"godot-universal"=@{command="npx";args=@("godot-universal-mcp")}}}|ConvertTo-Json -Depth 10
Set-Content -Path "E:\OpenMakaiRanch\opencode.json" -Value $oc -Encoding UTF8
WS "VS Code + Open Code configs created"
Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
WS "Setup abgeschlossen!"
Write-Host ""
Write-Host "Nächste Schritte:" -ForegroundColor Yellow
Write-Host "1. Godot Editor starten" -ForegroundColor White
Write-Host "2. Editor -> Plugins -> 'Godot Universal MCP' auf 'on'" -ForegroundColor White
Write-Host "3. Start-Skript: .\start-godot-mcp.bat" -ForegroundColor White
Write-Host "4. Hermes/VS Code/Open Code - MCP sollte connecten" -ForegroundColor White
Write-Host ""
Write-Host "Ports: Editor=9500, Runtime=9501" -ForegroundColor Gray
