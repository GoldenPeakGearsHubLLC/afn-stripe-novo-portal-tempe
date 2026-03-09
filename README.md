# AFN Stripe + Novo Portal (Tempe, AZ) — One-Click

This is a minimal production-ready portal for:
- Store (digital products)
- Donations
- Investor contributions (preset buttons: $250, $500, $1,000, $2,500, $5,000)
- Public remittance info page

Payments:
- Stripe Checkout Sessions
Banking:
- Novo (configure payouts in Stripe)

## Install

macOS/Linux/WSL:
```bash
chmod +x install.sh
./install.sh
```

Windows PowerShell:
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

## Webhooks
Configure Stripe webhook to:
- POST /webhook/stripe
- Subscribe to checkout.session.completed

Stripe signature verification requires raw request body and STRIPE_WEBHOOK_SECRET.
