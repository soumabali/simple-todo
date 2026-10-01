import { describe, it, expect } from "vitest";
import { embedCookieAttributes } from "@/lib/security-headers";

/**
 * Atribut cookie embed dibaca dari `EMBED_ALLOWED_ANCESTORS` saat RUNTIME di
 * Worker (beda dari header, yang di-compile saat build). Kalau variabelnya
 * tidak terkirim ke Worker, cookie jatuh ke default `SameSite=Lax` -- dan
 * browser TIDAK mengirim ulang cookie Lax di dalam iframe lintas situs, jadi
 * halaman tampil tapi login tidak pernah bertahan.
 *
 * Diuji di browser sungguhan (Chrome + Firefox 155): `Lax` tidak dikirim
 * ulang, `None` dan `None+Partitioned` dikirim ulang. Tes ini menjaga sisi
 * konfigurasinya, karena bugnya persis "env tidak sampai", bukan logika salah.
 */
describe("embedCookieAttributes", () => {
  it("tanpa allowlist: tidak mengubah apa pun (tetap default ketat)", () => {
    for (const raw of [undefined, null, "", "   ", "'none'"]) {
      expect(embedCookieAttributes(raw as never)).toEqual({});
    }
  });

  it("dengan allowlist: SameSite=None + Secure + Partitioned", () => {
    expect(embedCookieAttributes("file:")).toEqual({
      sameSite: "None",
      secure: true,
      partitioned: true,
    });
  });

  it("Partitioned wajib menyertai SameSite=None", () => {
    // Tanpa Partitioned, cookie menjadi pengenal bersama di semua situs yang
    // meng-embed kita. better-auth memasangkannya, dan itu harus dipertahankan.
    const attrs = embedCookieAttributes("https://dashboard.example.com");
    expect(attrs.sameSite).toBe("None");
    expect(attrs.secure).toBe(true);
    expect(attrs.partitioned).toBe(true);
  });

  it("wildcard tetap ditolak, bukan diterjemahkan jadi embed terbuka", () => {
    expect(() => embedCookieAttributes("*")).toThrow(/wildcard/i);
  });
});
