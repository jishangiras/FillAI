# FillAI Donations

FillAI is free. Donations are collected through a Stripe Payment Link.

- Stripe donation link: https://donate.stripe.com/9B65kD1fw7tA0WQarY2sM02
- Stripe product: `prod_UWXxyzFillAI`
- Price: `price_1TXTRkE3FNscJyVT...`
- Custom amount, minimum `$1`, default `$5`
- Stripe account: `acct_18hXnKE3FNscJyVT`

User-facing donation entry points:

- In-page FillAI panel settings: `src/content.ts`, `.fillai-donate`
- Legacy popup markup: `popup.html`, `.donate`

To update the donation link, replace it in:

- `src/content.ts`
- `popup.html`
- `CLAUDE.md`
- `STRIPE.md`
