# E-mail verification (6-digit code)

New accounts receive a **6-digit code by e-mail** and must enter it before they can sign in, so every
registered address is real. Web app and Android app both show the code screen; **Resend code** is
available after 60 s.

| Rule | Value |
|---|---|
| Code | 6 digits, random, valid **10 minutes**, stored only as a hash |
| Wrong attempts | 5, then the code is burnt (request a new one) |
| Resend | at most every 60 s, 5 per hour per account |
| Existing accounts | accounts created before this feature keep working (treated as verified) |

## Why Brevo

Render's **free** plan blocks outgoing SMTP (ports 25/465/587) since September 2025, so "send through
Gmail" doesn't work from Render. **Brevo** sends over HTTPS and is free: **300 e-mails/day**, no credit
card, no own domain needed (you verify one sender address).

## Setup (≈10 minutes)

1. Sign up at **brevo.com** (free plan).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: name `Guardian Drive`, e-mail
   `galangec24@gmail.com` (or any inbox you own) → confirm the link Brevo e-mails you.
3. **SMTP & API → API keys → Generate a new API key** → copy it (shown once).
4. **Render** → your service → **Environment** → add:

   | Key | Value |
   |---|---|
   | `EMAIL_PROVIDER` | `brevo` |
   | `BREVO_API_KEY` | the key from step 3 |
   | `EMAIL_FROM` | the sender address verified in step 2 |
   | `EMAIL_FROM_NAME` | `Guardian Drive` |

   Save → Render redeploys. Verification is now **on** for new registrations.

5. Laptop (optional, same values in `backend/.env`), or for local testing without sending anything:
   `EMAIL_PROVIDER=console` — the code is printed in the backend log instead.

Turn it off any time with `EMAIL_VERIFICATION=off` (or remove `EMAIL_PROVIDER`).

## Notes

- **Spam folder:** mail sent "from" a @gmail.com address through Brevo can land in spam or show
  "via brevo" until you use your own domain (Brevo → Senders, domains → authenticate a domain). The
  code screen reminds users to check spam.
- **Never** put the Brevo key in the web app, the APK or GitHub — only in Render / `backend/.env`.
- The demo account created by `npm run seed` is marked verified automatically (it has no inbox).
- API: `POST /api/auth/register` → `{verificationRequired, email, retryAfterS}` (no token);
  `POST /api/auth/verify-email {email, code}` → `{token, user}`; `POST /api/auth/resend-code {email}`;
  `POST /api/auth/login` for an unverified account → `403 {details: {code: "EMAIL_NOT_VERIFIED"}}`
  (and a fresh code is sent).
