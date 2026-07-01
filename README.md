# Couple Ledger — put it online in ~15 minutes

This gets your shared expense tracker live on the internet so you and your wife can
both use it from your phones, with everything synced. You will **not** write any
code — you'll copy two values into two boxes. Everything is free on the tiers below.

You'll use two free services:

- **Neon** — the database that stores your entries.
- **Vercel** — hosts the app and connects it to the database.

---

## What's in this folder

```
couple-ledger/
├─ index.html        the app (the whole tracker)
├─ api/ledger.js     the tiny server that talks to the database
├─ package.json      lists the one dependency
├─ .gitignore
└─ README.md         this guide
```

Keep the folder exactly as-is. The names and structure matter.

---

## Step 1 — Create the database (Neon)

1. Go to **https://neon.tech** and sign up (Google/GitHub login is fine).
2. Click **Create project**. Accept the defaults and create it.
3. On the project dashboard, find **Connection string** (sometimes under "Connect").
4. Copy the string that starts with `postgresql://...`. **Keep this somewhere handy** —
   you'll paste it into Vercel in Step 3. Treat it like a password.

That's the entire database step. You don't need to create any tables — the app
does that automatically the first time it runs.

---

## Step 2 — Put the code on GitHub

Vercel deploys from a GitHub repository. You can do this entirely in the browser.

1. Go to **https://github.com** and sign up / log in.
2. Click the **+** (top-right) → **New repository**. Name it `couple-ledger`,
   keep it **Private**, click **Create repository**.
3. On the new repo page, click **uploading an existing file** (a link in the
   "Quick setup" box). If you don't see it: **Add file → Upload files**.
4. Drag **everything inside this folder** into the upload box — including the
   `api` folder. Then click **Commit changes**.

> Tip: upload the *contents* of the folder, not the folder itself, so `index.html`
> sits at the top level of the repo (not inside `couple-ledger/couple-ledger/`).

---

## Step 3 — Deploy on Vercel

1. Go to **https://vercel.com** and sign up with your **GitHub** account.
2. Click **Add New… → Project**, then **Import** your `couple-ledger` repo.
3. Before clicking Deploy, open **Environment Variables** and add these two:

   | Name           | Value                                                        |
   |----------------|--------------------------------------------------------------|
   | `DATABASE_URL` | the `postgresql://...` string you copied from Neon in Step 1 |
   | `APP_PASSWORD` | a password you both will use to open the ledger (pick any)   |

   Add each one (Name, then Value, then **Add**).
4. Click **Deploy** and wait a minute.
5. When it's done, Vercel gives you a link like `https://couple-ledger-xxxx.vercel.app`.
   **That's your app.**

---

## Step 4 — Use it

1. Open the Vercel link on your phone.
2. Enter the **APP_PASSWORD** you chose. It's remembered on that device, so you
   only type it once per phone.
3. Send the **same link and password** to your wife. She enters it on her phone,
   and you're both looking at the same ledger — entries one of you adds show up
   for the other on next open/refresh.
4. On your phone: open the link in the browser menu and choose **Add to Home
   Screen** for an app-like icon.

Open **Settings** (gear icon, top-right) to set both your names, pick a colour
each, and choose your currency (₹ by default).

---

## Good to know

- **It works offline.** Entries are cached on the device, so a brief signal drop
  won't lose anything — it syncs to the database when you're back online.
- **Backups.** In Settings, "Export JSON" saves a copy of everything. "Import"
  restores it. Worth doing occasionally.
- **Changing the password.** In Vercel: your project → **Settings → Environment
  Variables** → edit `APP_PASSWORD` → then **Deployments → … → Redeploy**. Each
  phone will ask for the new password once.
- **Cost.** Neon and Vercel both have free tiers that comfortably cover a
  two-person tracker. No card needed to start.

## How private is this?

Only someone who knows **both** the URL and the password can read or change the
ledger — the password is checked on the server and never appears in the page.
That's plenty for a personal household tracker. It is not bank-grade security
(one shared password, no individual logins), so don't store card numbers or
anything you'd consider sensitive beyond household amounts.

## If something looks wrong

- **Stuck on "Checking…" or "Can't reach the server":** usually a missing/typo'd
  environment variable. Recheck `DATABASE_URL` and `APP_PASSWORD` in Vercel, then
  redeploy (Deployments → … → Redeploy).
- **"Wrong password":** the value you typed doesn't match `APP_PASSWORD` exactly
  (watch for spaces).
- **Entries not syncing between phones:** make sure both used the *same* Vercel
  link and password, and refresh the page.
