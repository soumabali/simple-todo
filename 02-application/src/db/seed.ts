/**
 * Seed script: creates the first admin account + default notification settings.
 * Run: `npm run db:seed`  (uses DATABASE_URL)
 *
 * Admin credentials are printed once. must_change_password defaults to false
 * for the very first admin so there is a way in; subsequent users created via
 * the admin UI get must_change_password = true.
 */
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { notificationSettings } from "@/db/schema";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@flowboard.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";

async function main() {
  const db = getDb();

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

  console.log(`\nAdmin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log("(change these via SEED_ADMIN_* env vars before first run)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
