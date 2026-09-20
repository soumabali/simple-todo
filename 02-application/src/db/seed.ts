/**
 * Seed script: creates the first admin account + default notification settings.
 * Run: `npm run db:seed`  (uses DATABASE_URL)
 *
 * This repository is PUBLIC, so there is no default password: a `?? <literal>`
 * fallback would publish a working credential for every deployment that forgot
 * to override it. The caller must supply SEED_ADMIN_PASSWORD.
 *
 * The password is never printed. `npm run db:seed` output is easy to paste into
 * an issue or a chat message, and the value is the account's real password.
 *
 * must_change_password defaults to false for the very first admin so there is a
 * way in; subsequent users created via the admin UI get true.
 */
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { notificationSettings } from "@/db/schema";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@flowboard.local";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";

/** Mirrors better-auth's own floor (src/lib/auth.ts minPasswordLength). */
const MIN_PASSWORD_LENGTH = 8;

function readPassword(): string {
  const value = process.env.SEED_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is not set. This repo is public, so there is no default " +
        "password. Pass one explicitly, e.g.\n" +
        "  SEED_ADMIN_PASSWORD='<a strong password>' npm run db:seed\n" +
        "It is used once, to create the first admin, and is never printed."
    );
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters ` +
        `(got ${value.length}).`
    );
  }
  return value;
}

async function main() {
  const db = getDb();
  // Read before touching the database: fail fast rather than half-seed an admin.
  const ADMIN_PASSWORD = readPassword();

  const existing = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.email, ADMIN_EMAIL),
  });

  let admin = existing;
  if (!existing) {
    const ctx = await auth.$context;
    const created = (await ctx.internalAdapter.createUser(
      {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        emailVerified: true,
        role: "admin",
        timezone: "Asia/Makassar",
        mustChangePassword: false,
        banned: false,
      } as any,
      { method: "admin" }
    )) as any;
    // Store the password hash (scrypt) via a credential account, matching
    // what better-auth's sign-up route does (providerId "credential",
    // accountId = user id).
    const hash = await ctx.password.hash(ADMIN_PASSWORD);
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });
    admin = created;
    console.log(`✅ Created admin: ${ADMIN_EMAIL}`);
  } else {
    console.log(`ℹ️  Admin already exists: ${ADMIN_EMAIL}`);
  }

  if (admin) {
    const ns = await db.query.notificationSettings.findFirst({
      where: (n, { eq: e }) => e(n.userId, admin.id),
    });
    if (!ns) {
      await db.insert(notificationSettings).values({ userId: admin.id });
      console.log("✅ Created default notification settings");
    }
  }

  console.log(`\nAdmin account ready: ${ADMIN_EMAIL}`);
  console.log("(the password is the SEED_ADMIN_PASSWORD you supplied; it is never printed)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
