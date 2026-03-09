Param([string]$AppDir = ".")
function Say($m){ Write-Host "`n$m" -ForegroundColor Green }
function Warn($m){ Write-Host "`n$m" -ForegroundColor Yellow }
function Fail($m){ Write-Host "`n$m" -ForegroundColor Red; exit 1 }
Say "AFN Stripe + Novo Portal (Tempe) — one-click install"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Missing dependency: node" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "Missing dependency: npm" }
Set-Location $AppDir
if (-not (Test-Path ".env")) {
  Say "Creating .env from .env.example"
  Copy-Item .env.example .env
  Warn "Edit .env and set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET"
}
Say "Installing dependencies"; npm install
Say "Seeding products"; npm run seed
Say "Starting server"; Warn "Open: http://localhost:3000"; npm start
