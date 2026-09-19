import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

/**
 * Self-hosted better-auth (PRD §6.3 Option B).
 *
 * Role / ban / timezone / must-change-password are declared as additionalFields
 * on the `user` table AND already exist as columns in src/db/schema.ts.
 */
export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  emailAndPassword: {
    enabled: true,
    // v1 non-goal: self sign-up is disabled (PRD §1)
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Reject an account that is deactivated/banned with a clear message.
    // (better-auth already hashes with scrypt by default — Web Crypto safe.)
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // rolling: refresh if older than 1 day
    cookieCache: {
      // Disabled: the cache stores the user object (incl. mustChangePassword)
      // in a cookie for up to 5 minutes, so after a password change the stale
      // "true" keeps redirecting the user to /change-password (BUG-7).
      // The DB read is cheap and the 5-min reminder cron keeps Neon warm.
      enabled: false,
      maxAge: 60 * 5,
    },
  },

  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      banned: { type: "boolean", defaultValue: false, input: false },
      banReason: { type: "string", required: false, input: false },
      banExpires: { type: "date", required: false, input: false },
      timezone: { type: "string", defaultValue: "Asia/Makassar" },
      mustChangePassword: { type: "boolean", defaultValue: false, input: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },

  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Reject sign-in for deactivated accounts (defence in depth;
          // the login route also checks this to return a tailored message).
          const db = getDb();
          const u = await db.query.user.findFirst({
            where: (users, { eq }) => eq(users.id, session.userId),
          });
          if (u?.banned) {
            throw new Error("ACCOUNT_DEACTIVATED");
          }
          return { data: session };
        },
        after: async (session) => {
          // Record the last login time (PRD §6.3 / admin "last login" column).
          const db = getDb();
          await db
            .update(schema.user)
            .set({ lastLoginAt: new Date() })
            .where(eq(schema.user.id, session.userId))
            .catch(() => {});
        },
      },
    },
    account: {
      update: {
        after: async (account: any, context: any) => {
          // Clear mustChangePassword after a SELF-SERVICE password change so
          // the forced-change redirect loop stops (BUG-7).
          // `context` is null for admin-initiated resets (our route handler
          // calls internalAdapter.updatePassword directly, outside a
          // better-auth endpoint) — in that case we keep the flag set.
          if (!context) return;
          const userId = account?.userId;
          if (!userId) return;
          const db = getDb();
          await db
            .update(schema.user)
            .set({ mustChangePassword: false })
            .where(eq(schema.user.id, userId))
            .catch(() => {});
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
