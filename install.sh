#!/usr/bin/env bash
set -euo pipefail
say(){ printf "\n\033[1;32m%s\033[0m\n" "$*"; }
warn(){ printf "\n\033[1;33m%s\033[0m\n" "$*"; }
err(){ printf "\n\033[1;31m%s\033[0m\n" "$*"; }
need(){ command -v "$1" >/dev/null 2>&1 || { err "Missing dependency: $1"; exit 1; }; }

say "AFN Stripe + Novo Portal (Tempe) — one-click install"
need node
need npm

if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  warn "Edit .env and set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET"
fi

say "Installing dependencies"
npm install
say "Seeding products"
npm run seed
say "Starting server"
warn "Open: http://localhost:${PORT:-3000}"
npm start
