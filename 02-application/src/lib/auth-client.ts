"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client-side auth. The server routes call auth.api.* directly.
 * Note: baseURL is only needed when the app is served from a different origin
 * than the API; same-origin defaults are fine for the Next.js app.
 */
export const authClient = createAuthClient();

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  banned: boolean;
  timezone: string;
  mustChangePassword: boolean;
};
