# "Continue with Google" setup

Parents can sign in or create an account with their Google (Gmail) account on the website.
The browser gets a signed **ID token** from Google and sends it to `POST /api/auth/google`;
the server checks Google's signature, that the token was issued for our client id, and that
Google has verified the e-mail. No Google password or access token ever reaches our server.

| Case | What happens |
|---|---|
| New e-mail | Account created, e-mail already verified (no OTP needed), no password |
| Existing verified account with that e-mail | Google is linked; the password keeps working too |
| Existing **never-verified** registration | Google proves ownership: account verified, the unproven password is removed |
| Google-only account tries the password form | "This account uses Google sign-in…"; *Forgot password?* can add a password |

The button only appears when the server has `GOOGLE_CLIENT_ID` set (the website asks
`GET /api/auth/config`), so nothing breaks before setup.

## 1. Create the OAuth client (free, ~5 minutes)

1. Open <https://console.cloud.google.com/> and create a project, e.g. **Guardian Drive**.
2. **Google Auth Platform → Branding** (older consoles: *APIs & Services → OAuth consent screen*):
   app name *Guardian Drive*, your support e-mail, developer contact e-mail. Save.
3. **Audience**: *External*. Click **Publish app** so any Gmail account can sign in.
   (While in *Testing*, only the test users you list can.) The basic scopes we use
   (`openid`, `email`, `profile`) need no Google review.
4. **Clients → Create client → Web application**, name *Guardian Drive web*.
   **Authorized JavaScript origins**:
   ```
   https://guardian-drive-ph.web.app
   https://guardian-drive-ph.firebaseapp.com
   http://localhost:5173
   http://localhost
   ```
   No redirect URIs are needed. Create, then copy the **Client ID**
   (`1234…-abc….apps.googleusercontent.com`). The client **secret** is not used: ignore it.

## 2. Give the client id to the server

Render → *guardian-drive-api* → **Environment** → add
`GOOGLE_CLIENT_ID = <the Client ID>` → save and redeploy.
For local development put the same line in `backend/.env`.

The client id is public (it is visible in every Google button), so it is fine in the browser.

## 3. Check

Open the website, close and reopen the tab: an **OR / Continue with Google** button appears
under *Sign in*. If it doesn't: the server has no `GOOGLE_CLIENT_ID`, or Render hasn't redeployed.
If Google shows *"origin is not allowed"*: the site's address is missing from step 1.4
(changes can take a few minutes to apply).

## Android app

The APK currently signs in with e-mail + password (+ *Forgot password?*). Google sign-in in the
app needs an extra **Android** OAuth client registered with the package name
`app.guardiandrive.parent` and the release keystore's SHA-1, plus the
`google_sign_in` plugin; it can be added later and will reuse the same server endpoint.

## Anti-spam limits (all sign-in and code endpoints)

| Limit | Value |
|---|---|
| Code e-mails per account (verify / reset, each) | 1 per 60 s, 5 per hour |
| Code requests per network (IP) | 10 per hour |
| Code requests per e-mail address | 10 per day |
| Sign-in / code-entry attempts per IP + account | 10 per 15 min (50 per IP) |
| Google sign-in attempts per IP | 30 per 15 min |
| E-mails sent by the server per day (all users) | `EMAIL_DAILY_LIMIT`, default 250 (Brevo free: 300) |
| Wrong codes | 5 per code, then a new code is needed |

Over a limit the API answers `429` with `Retry-After`, and the apps show the message.
Counters live in memory, so they reset when Render restarts the server.
