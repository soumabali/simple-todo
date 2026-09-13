"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // At least 8 chars incl. a letter and a digit (PRD F-1.2).
    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(next)) {
      setError("Password must be at least 8 characters with a letter and a digit");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (res.error) {
        setError(res.error.message ?? "Could not change password");
        return;
      }
      router.push("/boards");
      router.refresh();
    } catch {
      setError("Could not change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-bold mb-6">Change password</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1" htmlFor="current">Current password</label>
            <input id="current" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label className="block text-sm mb-1" htmlFor="next">New password</label>
            <input id="next" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </div>
          <div>
            <label className="block text-sm mb-1" htmlFor="confirm">Confirm new password</label>
            <input id="confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          {error && <div className="text-sm" style={{ color: "var(--danger)" }}>{error}</div>}
          <button type="submit" className="btn btn-primary w-full justify-center" disabled={loading}>
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
