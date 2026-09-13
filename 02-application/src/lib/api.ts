"use client";

/** Thin JSON fetch helper for the internal /api routes. */
export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? "Request failed";
    throw new Error(msg);
  }
  return data;
}
