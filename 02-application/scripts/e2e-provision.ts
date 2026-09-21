/**
 * E2E provisioning helper — creates throwaway accounts in a FlowBoard database
 * so `03-history/e2e-live.py` has something to log in as.
 *
 * WHY THIS EXISTS
 * ---------------
 * The E2E harness mutates whatever database it points at, and production is the
 * only environment with the real Worker + Neon stack. So the accounts it uses
 * must be disposable and obviously fake. This script creates exactly two:
 * an admin and a plain user, with randomly generated passwords.
 *
 * It writes credentials to a `0600` JSON file and never prints them. This
 * repository is PUBLIC — the passwords must not reach stdout, a commit, or a
 * chat message.
 *
 * USAGE
 * -----
 *   DATABASE_URL_UNPOOLED='postgres://...' node --experimental-strip-types \
 *     scripts/e2e-provision.ts /tmp/e2e-creds.json
 *
 * Then feed the file into the Python harness via environment variables. See
 * `01-documents/runbooks/deployment.md` ("Menjalankan E2E terhadap produksi").
 *
 * CLEANUP
 * -------
 * `node scripts/e2e-provision.ts --delete /tmp/e2e-creds.json` removes both
 * accounts (boards/tasks cascade). Run it after every E2E session.
 *
 * GOTCHAS (both cost an hour of debugging — do not "simplify" them away)
 * ---------------------------------------------------------------------
 * 1. The schema is `public`, and its columns are **snake_case**
 *    (`email_verified`, `must_change_password`, `user_id`, `account_id`,
 *    `provider_id`, `created_at`, `updated_at`). This database ALSO contains a
 *    `neon_auth` schema with camelCase tables — that is a leftover from a
 *    Managed Better Auth experiment and is NOT used by the running app.
 *    Writing to the wrong one produces users who cannot log in.
 *
 * 2. The password hash MUST come from `@better-auth/utils/password`'s
 *    `hashPassword`. Reimplementing it with `crypto.scryptSync` looks
 *    equivalent and is not: better-auth passes a **16-byte salt as a hex
 *    string**, so passing the raw Buffer yields a hash that never verifies.
 *    Symptom: `401 INVALID_EMAIL_OR_PASSWORD` for a password you just set.
 */
import { Client } from "pg";
import { hashPassword } from "@better-auth/utils/password";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** The only accounts this script will ever touch. */
const ACCOUNTS = [
  { email: "e2e-admin@flowboard.test", name: "E2E Admin", role: "admin" },
  { email: "e2e-user@flowboard.test", name: "E2E User", role: "user" },
] as const;

/** Rejects anything not in ACCOUNTS, so a bad argument cannot delete real users. */
function assertManaged(email: string) {
  if (!ACCOUNTS.some((a) => a.email === email)) {
    throw new Error(
      `Refusing to touch ${email}: not an E2E fixture account. ` +
        `This script must never modify real users.`
    );
  }
}

/** URL-safe password with no quotes or shell metacharacters. */
function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(length))
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

function connectionString(): string {
  const url =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL ??
    process.env.NEON_PRODUCTION_URL;
  if (!url) {
    throw new Error(
      "No database URL. Set DATABASE_URL_UNPOOLED (preferred — plain sessions " +
        "against a pooled endpoint can bounce between backends)."
    );
  }
  return url;
}

async function create(db: Client, out: Record<string, unknown>) {
  for (const account of ACCOUNTS) {
    assertManaged(account.email);

    // Cascades remove boards, tasks, sessions, and the credential account.
    await db.query(`DELETE FROM "user" WHERE email = $1`, [account.email]);

    const password = generatePassword();
    const { rows } = await db.query(
      `INSERT INTO "user"
         (id, email, name, email_verified, role, timezone, must_change_password, banned,
          created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, 'Asia/Makassar', false, false,
               now()::timestamptz, now()::timestamptz)
       RETURNING id`,
      [randomUUID(), account.email, account.name, account.role]
    );
    const userId: string = rows[0].id;

    await db.query(
      `INSERT INTO account
         (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES ($1, $2, $3, 'credential', $4,
               now()::timestamptz, now()::timestamptz)`,
      [randomUUID(), userId, userId, await hashPassword(password)]
    );

    out[account.email] = { id: userId, password, role: account.role };
    // Deliberately no password in the log line.
    console.log(`provisioned ${account.email} (role=${account.role})`);
  }
}

async function remove(path: string) {
  const creds = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const db = new Client({ connectionString: connectionString() });
  await db.connect();
  try {
    for (const email of Object.keys(creds)) {
      assertManaged(email);
      await db.query(`DELETE FROM "user" WHERE email = $1`, [email]);
      console.log(`deleted ${email}`);
    }
  } finally {
    await db.end();
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--delete") {
    const path = args[1];
    if (!path) throw new Error("Usage: --delete <creds.json>");
    await remove(path);
    return;
  }

  const outPath = args[0] ?? "/tmp/e2e-creds.json";
  const db = new Client({ connectionString: connectionString() });
  await db.connect();
  try {
    const out: Record<string, unknown> = {};
    await create(db, out);
    writeFileSync(outPath, JSON.stringify(out, null, 2), { mode: 0o600 });
    console.log(`\ncredentials written to ${outPath} (mode 0600, never printed)`);
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
