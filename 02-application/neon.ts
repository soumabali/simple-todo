import { defineConfig } from "@neon/config/v1";

/**
 * Neon policy — config as code (PRD §2.7).
 *
 * `neon deploy` reconciles the project/branch against this declaration.
 *
 * NOTE on auth: we are on the SELF-HOSTED better-auth path (PRD §6.3 Option B)
 * until the Phase 0 workerd spike resolves. Managed Better Auth is therefore
 * disabled here (`auth: false`). If the spike passes and we adopt Managed
 * Better Auth, flip this to `auth: true` and run `neon deploy` BEFORE the
 * Drizzle migration that creates FK references to `neon_auth."user"` (§12.7).
 */
export default defineConfig({
  // Services present on every branch.
  auth: false,

  // Prepared for v1.1 (attachments & avatars) — unused in v1 (§2.7.3).
  preview: {
    buckets: {
      storage: { access: "private" },
    },
    functions: {
      api: { name: "api", source: "./hello.ts" },
    },
  },

  // Per-branch policy (§2.7.5).
  branch: (branch) => {
    if (branch.isDefault) {
      return { protected: true }; // production cannot be applied to casually
    }
    return { parent: "production", ttl: "7d" }; // preview branches auto-expire
  },
});
