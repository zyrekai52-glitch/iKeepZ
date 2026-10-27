# Local equivalent of the CI Windows build. Requires Flutter 3.47.x with Visual Studio 2022 (Desktop development with C++).
# Output: release\iKeepZ-windows-x64\ (runnable folder) and release\iKeepZ-windows-x64.zip
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path "config/app_config.json")) {
    throw "config/app_config.json is missing. Copy config/app_config.example.json to config/app_config.json and fill it in."
}

flutter pub get
flutter build windows --release --dart-define-from-file=config/app_config.json

$src = "build/windows/x64/runner/Release"
$dst = "release/iKeepZ-windows-x64"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Recurse -Force "$src/*" $dst

# App-local copy of the Visual C++ runtime so the app also starts on PCs without the redistributable installed.
foreach ($dll in "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll") {
    $path = Join-Path $env:SystemRoot "System32/$dll"
    if (Test-Path $path) { Copy-Item $path $dst -Force } else { Write-Warning "$dll not found in System32" }
}

if (-not (Test-Path "$dst/iKeepZ.exe")) { throw "iKeepZ.exe was not produced" }
if (Test-Path "release/iKeepZ-windows-x64.zip") { Remove-Item -Force "release/iKeepZ-windows-x64.zip" }
Compress-Archive -Path "$dst/*" -DestinationPath "release/iKeepZ-windows-x64.zip" -Force
Get-FileHash "release/iKeepZ-windows-x64.zip" -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  iKeepZ-windows-x64.zip" } | Set-Content "release/SHA256SUMS-windows.txt"
Write-Host "Done. See release/."
