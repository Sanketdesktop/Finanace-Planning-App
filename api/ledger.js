// api/ledger.js — the only server file.
// GET  -> returns your saved ledger { tx, settings }
// PUT  -> saves the whole ledger { tx, settings }
// Every request must carry the shared password in the "x-ledger-pass" header,
// which is checked here against the APP_PASSWORD you set in Vercel. The password
// is never sent to the browser, so it stays private to the two of you.

import { neon } from "@neondatabase/serverless";

const PASSWORD = process.env.APP_PASSWORD;
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

async function ensureTable() {
  // Single-row table; the whole ledger lives in one jsonb blob under id = 1.
  await sql`CREATE TABLE IF NOT EXISTS ledger (
    id         integer PRIMARY KEY,
    data       jsonb      NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
}

export default async function handler(req, res) {
  res.setHeader("content-type", "application/json");

  if (!sql || !PASSWORD) {
    return res.status(500).json({
      error: "Server not configured. Set DATABASE_URL and APP_PASSWORD in Vercel."
    });
  }

  // --- password check -------------------------------------------------------
  const pass = req.headers["x-ledger-pass"];
  if (!pass || pass !== PASSWORD) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    await ensureTable();

    if (req.method === "GET") {
      const rows = await sql`SELECT data FROM ledger WHERE id = 1`;
      const data = rows.length ? rows[0].data : {};
      return res.status(200).json({ tx: data.tx || [], settings: data.settings || null });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const payload = {
        tx: Array.isArray(body.tx) ? body.tx : [],
        settings: body.settings || null
      };
      const json = JSON.stringify(payload);
      await sql`
        INSERT INTO ledger (id, data, updated_at)
        VALUES (1, ${json}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("ledger error:", err);
    return res.status(500).json({ error: "database error" });
  }
}
