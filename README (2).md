# Couple Ledger — now with Google sign-in

A shared household expense tracker. Each person signs in with Google; the two of
you share one ledger by exchanging a household code. Data lives in your own Neon
database and is served through one small Vercel function that verifies every
request against Google.

## What's in this folder

```
couple-ledger/
├─ index.html        the app (whole tracker + Google sign-in)
├─ api/ledger.js     the server: verifies Firebase tokens, per-space storage
├─ package.json      dependencies (@neondatabase/serverless, jose)
└─ README.md         this guide
```

## Step 1 — Database (Neon)

1. Create a project at https://neon.tech and copy the `postgresql://...`
   connection string. No tables needed — the app creates them on first run.

## Step 2 — Firebase (Google sign-in)

1. Go to https://console.firebase.google.com → **Add project** (Analytics optional).
2. **Build → Authentication → Get started → Sign-in method →** enable **Google**.
3. **Authentication → Settings → Authorized domains →** add your Vercel domain
   (e.g. `couple-ledger-xxxx.vercel.app`). `localhost` is there by default.
4. **Project settings (gear) → General → Your apps → Web (`</>`)** to register a
   web app. Copy the `firebaseConfig` values.
5. In **index.html**, find the `firebaseConfig` block near the bottom and paste in
   your real `apiKey`, `authDomain`, `projectId`, and `appId`. These are **not
   secrets** — Firebase web config is meant to ship in the page.

## Step 3 — GitHub

Upload the folder contents to a repo (keep `api/ledger.js` under `api/`).

## Step 4 — Vercel

Import the repo, then under **Environment Variables** add:

| Name                  | Value                                                        |
|-----------------------|--------------------------------------------------------------|
| `DATABASE_URL`        | the `postgresql://...` string from Neon                      |
| `FIREBASE_PROJECT_ID` | your Firebase **project ID** (same as in `firebaseConfig`)   |

There is **no `APP_PASSWORD` anymore** — remove it if it's still there. Deploy.
(If you change env vars later, redeploy: Deployments → ⋯ → Redeploy.)

## Step 5 — Use it

1. Open the app, tap **Continue with Google**, pick your account.
2. Open **Settings**. Your **household code** is shown there. Send it to your
   partner. They sign in with *their* Google account, open Settings, and enter
   your code under **Join your partner's ledger**. Now you both see the same data.
3. Settings also has **Leave shared ledger** (go back to your own) and **Sign out**.

## How auth works (short version)

The browser gets a Google-signed ID token from Firebase and sends it as
`Authorization: Bearer <token>` on every call. `api/ledger.js` verifies the token's
signature, issuer, audience, and expiry against Google's public keys before
touching the database — the client can never just claim to be someone. Each user
is pinned to one "space"; a space can have two members once a code is redeemed,
and the ledger row is keyed by space, so spaces are isolated from each other.

## Migrating existing data

If you were running the old shared-password version, the first person to sign in
inherits the old ledger automatically (the server copies the legacy single-row
blob into that first space). To be safe, open the old app first and use
**Settings → Export JSON**; you can **Import** it back afterwards if needed.

## Notes

- **Offline:** entries are cached on-device and sync when you're back online.
- **Privacy:** statement imports (CSV/PDF) are parsed entirely in the browser; the
  file is never uploaded. Only your final ledger blob is stored, in your own DB.
- **Not bank-grade:** fine for household amounts; don't store card numbers etc.
