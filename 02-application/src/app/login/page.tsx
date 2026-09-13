"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        // Generic failure message (PRD F-1.1).
        setError("Email or password is incorrect");
        return;
      }
      router.push("/boards");
      router.refresh();
    } catch {
      setError("Email or password is incorrect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            FlowBoard
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Kanban, Gantt & reminders
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full justify-center" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: "var(--muted)" }}>
          Accounts are created by an administrator.
        </p>
      </div>
    </main>
  );
}
