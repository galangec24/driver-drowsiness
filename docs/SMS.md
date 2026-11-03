# Text messages (SMS) when a driver is drowsy

When a driver becomes **drowsy** or has a **microsleep**, the parent gets a text message on the
mobile number in their profile, besides the in-app alert and push notification. A text arrives
without mobile data or Wi-Fi and with the app closed, so the parent hears about it even when they
are offline.

Example:

```
Guardian Drive: Galang is DROWSY (11:07 AM). Call now and ask them to pull over safely.
Location: https://maps.google.com/?q=10.33446,123.89520
```

## Rules

- Only **drowsy** and **microsleep** alerts. A warning is not texted, but it is texted if it
  becomes drowsy.
- **Once per alert.** "Detected again" updates the same alert and does not text again.
- In the parent's **preferred language**: English, Filipino or Cebuano (others get English).
- Readings that arrive **more than 10 minutes late** (car was offline) are not texted.
- Cost guards: at most `SMS_PER_PARENT_DAILY` (10) texts per parent per day and `SMS_DAILY_LIMIT`
  (100) in total per day.
- The number is optional at sign-up and in Settings → Profile. Numbers without a country code are
  taken as Philippine: `0917 123 4567` is saved as `+639171234567`. A **(?)** next to the field
  explains why it matters.
- Each alert records what happened (`sms.status`: sent, failed, no_phone, limit); the alert details
  show "Texted to +63•••••4567".

## Setting it up (Semaphore, Philippines)

1. Sign up at https://semaphore.co and buy credits (about PHP 0.50 per 160-character text; a
   drowsiness text with a map link is one or two texts).
2. Copy your **API key** (Account → API).
3. Optional: request a **sender name** (e.g. `GuardianDrv`, up to 11 characters). Until it's
   approved, texts come from "SEMAPHORE".
4. In Render → guardian-drive-api → Environment, add:

   | Key | Value |
   |---|---|
   | `SMS_PROVIDER` | `semaphore` |
   | `SEMAPHORE_API_KEY` | your API key |
   | `SEMAPHORE_SENDER` | your approved sender name (or leave empty) |

5. Save (Render redeploys), then test: drive with the monitor and get drowsy, or run the simulator.

**Twilio** (any country) works too: `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (your Twilio number). A Twilio trial only texts numbers you have
verified in the Twilio console.

**Local testing:** `SMS_PROVIDER=console` writes the text to the server log instead of sending it.

Code: `backend/src/services/sms.js` (providers, phone numbers) and
`backend/src/services/smsAlerts.js` (when to text, message text).
