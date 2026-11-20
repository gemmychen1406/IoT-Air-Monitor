$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Chưa cài được thư viện. Kiểm tra kết nối mạng và thử lại.' }
}
& npm.cmd run diagnostics:local
if ($LASTEXITCODE -ne 0) { throw 'Chưa khởi chạy được AirGuard local. Xem thông báo ở phía trên.' }
