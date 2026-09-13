"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type User = { id: string; name: string; email: string; role?: string };

export function AppShell({ children, initialUser }: { children: React.ReactNode; initialUser: User }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const isAdmin = initialUser?.role === "admin";

  const navItems = [
    { href: "/boards", label: "Boards", active: pathname.startsWith("/boards") },
    { href: "/notifications", label: "Notifications", active: pathname.startsWith("/notifications") },
  ];
  if (isAdmin) {
    navItems.push({ href: "/admin/users", label: "Admin", active: pathname.startsWith("/admin") });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-40 flex items-center gap-4 px-4 py-3"
        style={{ background: "var(--card)", borderBottom: "1px solid var(--card-border)" }}
      >
        <Link href="/boards" className="font-bold text-lg" style={{ color: "var(--accent)" }}>
          FlowBoard
        </Link>

        <nav className="flex items-center gap-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 text-sm rounded-lg"
              style={
                item.active
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--muted)" }
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/settings/notifications"
            className="text-sm px-2 py-1.5 rounded-lg"
            style={{ color: "var(--muted)" }}
            title="Notification settings"
          >
            ⚙️
          </Link>
          <Link
            href="/change-password"
            className="text-sm px-2 py-1.5 rounded-lg hidden sm:inline"
            style={{ color: "var(--muted)" }}
            title="Change password"
          >
            {initialUser?.name ?? initialUser?.email}
          </Link>
          <button onClick={signOut} className="btn btn-ghost text-sm">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
