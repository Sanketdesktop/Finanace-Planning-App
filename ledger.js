// api/ledger.js — the only server file. Firebase-authenticated, per-space ledger.
//
// Auth: every request must send "Authorization: Bearer <Firebase ID token>".
//   The token is a Google-signed JWT. We verify it here (signature + issuer +
//   audience + expiry) against Google's public certs — the client can NEVER just
//   claim a uid. No service-account secret is needed; only the public project id.
//
// Data model (multi-tenant):
//   spaces(space_id, invite_code)        one ledger per space; invite_code lets a
//                                        partner join and share the same ledger.
//   members(uid -> space_id)             each signed-in user points at one active space.
//   space_ledger(space_id -> data jsonb) the actual { tx, settings, events } blob.
//
// Routes (all require a valid token):
//   GET  /api/ledger              -> { tx, settings, events, account }
//   PUT  /api/ledger              -> save the whole ledger for the caller's space
//   POST /api/ledger?action=join  { code }  -> join a partner's space by invite code
//   POST /api/ledger?action=leave           -> return to your own private space

import { neon } from "@neondatabase/serverless";
import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// --- Firebase ID token verification ---------------------------------------
let certCache = { keys: null, exp: 0 };
async function getCerts() {
  if (certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error("cert fetch failed");
  const keys = await res.json();
  let ttl = 3600 * 1000;
  const m = (res.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  if (m) ttl = parseInt(m[1], 10) * 1000;
  certCache = { keys, exp: Date.now() + Math.max(ttl, 60000) };
  return keys;
}
async function verifyIdToken(token) {
  const { kid, alg } = decodeProtectedHeader(token);
  if (alg !== "RS256" || !kid) throw new Error("bad token header");
  let certs = await getCerts();
  let pem = certs[kid];
  if (!pem) { certCache.exp = 0; certs = await getCerts(); pem = certs[kid]; } // key rotated
  if (!pem) throw new Error("unknown signing key");
  const key = await importX509(pem, "RS256");
  const { payload } = await jwtVerify(token, key, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID
  });
  if (!payload.sub) throw new Error("no subject");
  return { uid: payload.sub, email: payload.email || null, name: payload.name || null };
}

// --- schema + space bootstrap ---------------------------------------------
async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS spaces (
    space_id   text PRIMARY KEY,
    invite_code text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS members (
    uid        text PRIMARY KEY,
    space_id   text NOT NULL,
    email      text,
    updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS space_ledger (
    space_id   text PRIMARY KEY,
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now())`;
}

function genCode() {
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
  let s = "";
  for (let i = 0; i < 7; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

async function getOrCreateSpace(uid, email) {
  const rows = await sql`SELECT space_id FROM members WHERE uid = ${uid}`;
  if (rows.length) {
    // keep email fresh, non-blocking correctness
    await sql`UPDATE members SET email = ${email}, updated_at = now() WHERE uid = ${uid}`;
    return rows[0].space_id;
  }
  const spaceId = uid; // stable + globally unique
  // Is this the very first space? If so, migrate any legacy single-blob ledger.
  let firstEver = false;
  try { firstEver = (await sql`SELECT count(*)::int AS n FROM spaces`)[0].n === 0; } catch (e) {}

  let code = genCode();
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await sql`INSERT INTO spaces (space_id, invite_code) VALUES (${spaceId}, ${code})`; break; }
    catch (e) { code = genCode(); if (attempt === 3) throw e; }
  }
  await sql`INSERT INTO members (uid, space_id, email) VALUES (${uid}, ${spaceId}, ${email})
            ON CONFLICT (uid) DO NOTHING`;

  if (firstEver) {
    try {
      const legacy = await sql`SELECT data FROM ledger WHERE id = 1`;
      if (legacy.length && legacy[0].data && (legacy[0].data.tx || legacy[0].data.settings)) {
        const json = JSON.stringify(legacy[0].data);
        await sql`INSERT INTO space_ledger (space_id, data) VALUES (${spaceId}, ${json}::jsonb)
                  ON CONFLICT (space_id) DO NOTHING`;
      }
    } catch (e) { /* no legacy table — fine */ }
  }
  return spaceId;
}

async function accountInfo(spaceId, email) {
  const s = await sql`SELECT invite_code FROM spaces WHERE space_id = ${spaceId}`;
  const c = await sql`SELECT count(*)::int AS n FROM members WHERE space_id = ${spaceId}`;
  return { email, code: s.length ? s[0].invite_code : null, members: c[0].n, shared: c[0].n > 1 };
}

// --- handler ---------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader("content-type", "application/json");

  if (!sql || !PROJECT_ID) {
    return res.status(500).json({
      error: "Server not configured. Set DATABASE_URL and FIREBASE_PROJECT_ID in Vercel."
    });
  }

  // ---- authenticate --------------------------------------------------------
  const authz = req.headers["authorization"] || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });

  let user;
  try { user = await verifyIdToken(token); }
  catch (err) { return res.status(401).json({ error: "invalid token" }); }

  try {
    await ensureTables();
    const spaceId = await getOrCreateSpace(user.uid, user.email);

    // ---- join / leave (change which space this user is attached to) --------
    if (req.method === "POST" && req.query && req.query.action === "join") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "no code" });
      const t = await sql`SELECT space_id FROM spaces WHERE invite_code = ${code}`;
      if (!t.length) return res.status(404).json({ error: "invalid code" });
      const target = t[0].space_id;
      await sql`UPDATE members SET space_id = ${target}, updated_at = now() WHERE uid = ${user.uid}`;
      return res.status(200).json({ ok: true, account: await accountInfo(target, user.email) });
    }
    if (req.method === "POST" && req.query && req.query.action === "leave") {
      // return to a private space of one's own
      let own = user.uid;
      const exists = await sql`SELECT space_id FROM spaces WHERE space_id = ${own}`;
      if (!exists.length) {
        let code = genCode();
        for (let a = 0; a < 4; a++) {
          try { await sql`INSERT INTO spaces (space_id, invite_code) VALUES (${own}, ${code})`; break; }
          catch (e) { code = genCode(); if (a === 3) throw e; }
        }
      }
      await sql`UPDATE members SET space_id = ${own}, updated_at = now() WHERE uid = ${user.uid}`;
      return res.status(200).json({ ok: true, account: await accountInfo(own, user.email) });
    }

    // ---- read --------------------------------------------------------------
    if (req.method === "GET") {
      const rows = await sql`SELECT data FROM space_ledger WHERE space_id = ${spaceId}`;
      const data = rows.length ? rows[0].data : {};
      return res.status(200).json({
        tx: data.tx || [],
        settings: data.settings || null,
        events: data.events || [],
        account: await accountInfo(spaceId, user.email)
      });
    }

    // ---- write -------------------------------------------------------------
    if (req.method === "PUT" || req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const payload = {
        tx: Array.isArray(body.tx) ? body.tx : [],
        settings: body.settings || null,
        events: Array.isArray(body.events) ? body.events : []
      };
      const json = JSON.stringify(payload);
      await sql`
        INSERT INTO space_ledger (space_id, data, updated_at)
        VALUES (${spaceId}, ${json}::jsonb, now())
        ON CONFLICT (space_id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("ledger error:", err);
    return res.status(500).json({ error: "database error" });
  }
}
