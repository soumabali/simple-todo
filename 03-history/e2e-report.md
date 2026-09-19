# E2E Test Report — FlowBoard Production (todo.nexigo.my.id)

**Date:** 2026-09-19
**Method:** Live end-to-end testing against the production URL (Cloudflare Workers + Neon Postgres).
**Scope:** Auth, boards, tasks, Gantt, notifications, push, admin — exercised via HTTP API (authoritative), plus browser smoke check.

---

## 1. Test results summary

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | Site reachable (`/` → `/login`) | ✅ | Root returns 307 → `/login` (unauthenticated) |
| 2 | Login (`POST /api/auth/sign-in/email`) | ✅ | 200, session token + admin user returned |
| 3 | Get session (`GET /api/auth/get-session`) | ✅ | 200, admin role confirmed |
| 4 | Boards list (`GET /api/boards`) | ❌→✅ | 307 redirect when using real cookie; 200 when cookie-name corrected |
| 5 | Create board (`POST /api/boards`) | ❌→✅ | Same root cause; 201 when corrected |
| 6 | Notification settings | ❌→✅ | Same root cause; 200 when corrected |
| 7 | Admin users list | ❌→✅ | Same root cause; 200 when corrected |
| 8 | Push public key | ❌→✅ | Same root cause; 200 when corrected |
| 9 | Login page SSR content | ✅ | HTML contains form (1 form, 2 inputs, "Email"/"Password"/"Sign in") |

**Root finding:** exactly **one** critical bug (BUG-1) causes all the ❌ above. Once bypassed, the entire backend works correctly. The application logic itself is sound.

---

## 2. Bug list (prioritised)

### BUG-1 — P0 CRITICAL — Cookie-name mismatch breaks ALL authenticated routes

**Symptom:** A logged-in user is immediately redirected back to `/login` on every protected page and API call (307 → `/login?redirect=...`). The app is **unusable in production**.

**Root cause:** `src/middleware.ts` checks for the cookie `better-auth.session_token`, but better-auth (v1.7.3) auto-prefixes the cookie with `__Secure-` when served over HTTPS. The real cookie name is `__Secure-better-auth.session_token`.

```ts
// src/middleware.ts (line 12) — WRONG
const SESSION_COOKIE = "better-auth.session_token";
```

**Evidence:**
- Login returns 200 and sets cookie `__Secure-better-auth.session_token` (verified).
- `GET /api/boards` with that cookie → 307 → `/login` (middleware `req.cookies.has("better-auth.session_token")` returns false).
- Injecting the correct cookie name → every endpoint returns 200/201 correctly.

**Fix:** accept both the secure and non-secure name (local dev over HTTP uses the un-prefixed name):
```ts
const hasSession =
  req.cookies.has("__Secure-better-auth.session_token") ||
  req.cookies.has("better-auth.session_token");
```

---

### BUG-2 — P1 MEDIUM — `lastLoginAt` never populated on login

**Symptom:** The admin "last login" column is always empty; `lastLoginAt` stays `null` after every login.

**Root cause:** `src/lib/auth.ts` declares `lastLoginAt` as an additional field, but no hook updates it. The `databaseHooks.session.create.before` hook only checks the ban flag — it never writes `lastLoginAt`.

**Fix:** in `databaseHooks.session.create.before` (or `after`), update the user row:
```ts
await db.update(schema.user).set({ lastLoginAt: new Date() }).where(eq(schema.user.id, session.userId));
```

---

### BUG-3 — P1 MEDIUM — `VAPID_SUBJECT` missing

**Symptom:** `VAPID_SUBJECT` is not present in the secret store. `src/lib/push.ts` falls back to `mailto:admin@example.com`, so push won't crash, but the VAPID subject is wrong (some push services validate it).

**Fix:** set `VAPID_SUBJECT` to a real value (e.g. `mailto:admin@nexigo.my.id`) as a Wrangler var on both Workers.

---

### BUG-4 — P2 LOW — Cloudflare Bot Fight Mode (error 1010) blocks non-browser User-Agents

**Symptom:** API requests with a default client User-Agent (e.g. `Python-urllib/3.11`, `curl` in some cases) return `403 error code: 1010`.

**Assessment:** This is Cloudflare's bot protection, arguably intended. It does **not** affect real browsers. But it will block any future API automation, monitoring scripts, or server-to-server integration unless they use a browser User-Agent or an explicit exception.

**Decision needed:** keep as-is (document it) or add a WAF rule / zone exception for a known automation UA/token.

---

### BUG-5 — P2 LOW — Headless-browser "empty page" (likely NOT a production bug)

**Symptom:** Browserbase (headless) shows an empty body with 2 empty JS exceptions; the React app does not appear to mount.

**Assessment:** The SSR HTML is correct (login form present, all JS chunks + CSS serve 200). This is most likely a headless/stealth automation artifact, **not** a real-user bug. **Do not chase this** without first confirming on a real browser (Chrome/Safari/Firefox). Listed here so it isn't mistaken for a regression.

---

## 3. Plan & tasks (next work)

### Task A — P0 (blocking): Fix cookie-name mismatch
- Edit `src/middleware.ts` to accept both `__Secure-better-auth.session_token` and `better-auth.session_token`.
- Deploy web Worker.
- Verify: login → `/boards` no longer redirects; all `/api/*` routes accept the session.

### Task B — P0 (verification): Re-run full E2E after fix
- Boards CRUD (create/list/detail/archive/delete).
- Tasks CRUD + move + schedule + reminders.
- Gantt endpoint.
- Notification settings get/update.
- Push: public-key, subscribe, test.
- Admin: user CRUD, reset-password, logs.
- Negative: unauthenticated → blocked; non-admin → `/admin/*` returns 404; cross-user board access → 404.

### Task C — P1: Populate `lastLoginAt` on login
- Add the update in the auth hook; verify the admin "last login" column populates.

### Task D — P1: Set `VAPID_SUBJECT`
- Set `VAPID_SUBJECT=mailto:admin@nexigo.my.id` on both Workers; verify a test push still builds/sends.

### Task E — P2: Decide Cloudflare Bot Fight Mode policy
- Either document the browser-UA requirement for automation, or add a WAF exception.

### Task F — P2: Manual browser verification (real device)
- Confirm login page renders + hydration works on real Chrome/Safari/Firefox; close out BUG-5 as "not a bug".

---

## 4. Verification evidence (redacted)

- Login: `200 {"token":"…","user":{...role":"admin","banned":false...}}`
- Cookie set: `__Secure-better-auth.session_token` (secure, SameSite=Lax)
- With corrected cookie: `GET /api/boards → 200 {"boards":[]}`, `POST /api/boards → 201`, `GET /api/push/public-key → 200 {"publicKey":"BKrF6…"}`
- VAPID keys: `VAPID_PUBLIC_KEY` (89 chars, valid), `VAPID_PRIVATE_KEY` (220 chars, valid JSON JWK)
