import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
      enabled: true,
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
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
