import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/simple_todo",
  },
  // Tables are declared singular/snake_case to match the better-auth adapter.
  casing: "snake_case",
} satisfies Config;
