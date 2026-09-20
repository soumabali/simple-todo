# Public REST API (v1)

API publik memungkinkan sistem lain — script, workflow (n8n), atau asisten seperti
**Hermes** — membaca dan mengelola todo milik satu akun, tanpa perlu cookie sesi
browser.

Autentikasi memakai **API key per user**. Setiap key hanya bisa mengakses data
akun yang membuatnya; tidak ada cara key milik user A membaca board/task user B.

- **Base URL produksi:** `https://todo.nexigo.my.id/api/v1`
- **Base URL lokal:** `http://localhost:3000/api/v1`
- **Format:** JSON (`Content-Type: application/json`)
- **Tanggal:** selalu `YYYY-MM-DD` (string), mengikuti zona waktu user

---

## 1. Membuat API key

Masuk ke aplikasi → **API** (menu di sidebar) → `/settings/api-keys`.

1. Isi **Label** — mis. `Hermes agent`, `n8n workflow`
2. Pilih **Permissions**:
   - `rw` — *Read & write*, CRUD penuh (list, buat, ubah, hapus)
   - `r` — *Read only*, hanya baca (list + inspeksi)
3. **Expires in** (opsional) — jumlah hari; kosong berarti tidak pernah kedaluwarsa
4. Klik **Generate key**

Key ditampilkan **satu kali saja** dengan format:

```
fbk_<64 karakter heksadesimal>
```

Simpan di tempat aman (secret manager / variabel lingkungan). Server hanya
menyimpan **hash SHA-256**, jadi key yang hilang tidak dapat ditampilkan lagi —
kalau hilang, revoke lalu buat yang baru.

### Manajemen key (butuh sesi login, bukan API key)

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| `GET` | `/api/api-keys` | Daftar key milik user (tanpa nilai key) |
| `POST` | `/api/api-keys` | Buat key baru — body `{ name, scopes: ["read","write"], expiresInDays? }` |
| `DELETE` | `/api/api-keys?id=<keyId>` | Revoke key |

---

## 2. Autentikasi request

Kirim key lewat salah satu header berikut:

```
Authorization: Bearer fbk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```
x-api-key: fbk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Request tanpa key, key salah, key kedaluwarsa, atau key yang sudah di-revoke
akan menerima **401**.

Key dengan scope `read` yang mencoba operasi tulis menerima **403**.

### Rate limit

**120 request per menit per key.** Melebihi batas menerima **429** beserta header
`Retry-After`. Setiap response juga membawa `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, dan `X-RateLimit-Reset`.

---

## 3. Format response

Sukses — data dibungkus objek:

```json
{ "todos": [ ... ], "meta": { "count": 3, "today": "2026-09-20", "limit": 100 } }
```

Error — selalu bentuk yang sama:

```json
{ "error": { "code": "BAD_REQUEST", "message": "title is required" } }
```

Kode error yang mungkin muncul:

- `UNAUTHORIZED` (401) — key tidak ada / tidak valid / sudah di-revoke
- `FORBIDDEN` (403) — scope tidak mencukupi
- `NOT_FOUND` (404) — resource tidak ada **atau** bukan milik user pemilik key
- `BAD_REQUEST` (400) — body/parameter tidak valid
- `RATE_LIMITED` (429) — melebihi 120 request/menit
- `INTERNAL` (500) — kesalahan server

---

## 4. Objek Todo

```json
{
  "id": "55d085df-...",
  "boardId": "6dbb8633-...",
  "boardName": "API Test Board",
  "title": "DUE TODAY report",
  "description": null,
  "status": "pending",
  "statusId": "e52f3c78-...",
  "statusName": "Todo",
  "priority": 0,
  "progress": 0,
  "dueDate": "2026-09-20",
  "startDate": null,
  "completedAt": null,
  "isCompleted": false,
  "isOverdue": false,
  "daysUntilDue": 0,
  "labels": [],
  "createdAt": "2026-09-19T16:00:00.000Z",
  "updatedAt": "2026-09-19T16:00:00.000Z"
}
```

`status` bernilai `pending` | `doing` | `done`. `isOverdue` bernilai `true` hanya
bila task belum selesai dan `dueDate` sudah lewat (dihitung di zona waktu user).

---

## 5. Endpoint

### `GET /me` — verifikasi key

```bash
curl -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  https://todo.nexigo.my.id/api/v1/me
```

```json
{
  "user": { "id": "...", "name": "API Key E2E", "email": "you@example.com", "timezone": "Asia/Makassar" },
  "apiKey": { "id": "...", "name": "Hermes agent", "scopes": ["read", "write"], "expiresAt": null }
}
```

Cocok dipakai sebagai *health check* integrasi.

---

### `GET /boards` — daftar board + kolom

```json
{
  "boards": [
    {
      "id": "6dbb8633-...",
      "name": "API Test Board",
      "color": "indigo",
      "taskCount": 7,
      "openCount": 6,
      "overdueCount": 1,
      "statuses": [
        { "id": "e52f3c78-...", "name": "Todo",  "position": 0, "isDone": false },
        { "id": "926714ae-...", "name": "Doing", "position": 1, "isDone": false },
        { "id": "a8650d0e-...", "name": "Done",  "position": 2, "isDone": true  }
      ]
    }
  ]
}
```

Pakai `statuses[].id` untuk memindahkan task antar kolom (lihat `PATCH /todos/:id`).

---

### `GET /todos` — daftar todo

Parameter (semua opsional):

- `boardId` — batasi ke satu board
- `statusId` — batasi ke satu kolom
- `state` — `open` *(default)* | `done` | `all`
- `due` — `overdue` | `today` | `week` (7 hari ke depan) | `soon`
- `within` — jumlah hari untuk `due=soon` (default `7`)
- `q` — cari di judul/deskripsi (case-insensitive)
- `limit` — maksimum item (default `100`, maksimum `500`)

```bash
# todo yang akan jatuh tempo / sudah lewat
curl -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  "https://todo.nexigo.my.id/api/v1/todos?due=overdue"
```

```bash
# cari task berisi "invoice" di board tertentu
curl -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  "https://todo.nexigo.my.id/api/v1/todos?q=invoice&boardId=6dbb8633-...&state=all"
```

Response menyertakan `meta.today` (tanggal hari ini menurut timezone user) supaya
klien tidak perlu menghitung sendiri.

---

### `POST /todos` — buat todo

Field wajib: `boardId`, `title`. Opsional: `description`, `dueDate`,
`startDate`, `priority`, `statusId`, `labels`.

```bash
curl -X POST https://todo.nexigo.my.id/api/v1/todos \
  -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"boardId":"6dbb8633-...","title":"Review laporan","dueDate":"2026-09-25","priority":1}'
```

→ **201** dengan `{ "todo": { ... } }`. `boardId` yang bukan milik user
menghasilkan **404** (bukan 403 — agar keberadaan board user lain tidak bocor).

---

### `GET /todos/:id` — detail satu todo

→ **200** `{ "todo": { ... } }`, atau **404** bila tidak ada / bukan milik user.

---

### `PATCH /todos/:id` — ubah todo

Field yang dapat diubah: `title`, `description`, `dueDate`, `startDate`,
`priority`, `statusId`, `progress`, `completed`, `labels`.

Perilaku penting:

- `statusId` — pindah ke kolom tertentu (harus satu board, kalau tidak → 404)
- `completed: true` — pindah otomatis ke kolom bertanda *done* (dan
  `completedAt` diisi, `progress` jadi 100)
- `completed: false` — **reopen**: task dipindah keluar dari kolom *done* ke
  kolom terbuka pertama, `completedAt` dikosongkan, `progress` jadi 0

```bash
# tandai selesai
curl -X PATCH https://todo.nexigo.my.id/api/v1/todos/55d085df-... \
  -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  -H 'Content-Type: application/json' -d '{"completed":true}'
```

Mengubah `dueDate` otomatis menjadwalkan ulang reminder task tersebut.

#### Reminder per todo

`PATCH /todos/:id` juga menerima empat field reminder per task, jadi integrasi
tidak perlu menyentuh endpoint sesi:

- `dueTime` — `"HH:mm"` atau `null`. Menentukan jam deadline; tanpa ini reminder
  `due_soon` jatuh pada `defaultTime` di setelan notifikasi (bawaan `08:00`).
- `remindOnStart` — boolean, kirim reminder saat `startDate` tiba.
- `remindLeadMinutes` — bilangan bulat ≥ 0 atau `null`. `null` berarti ikut
  setelan board; `0` berarti tepat pada deadline (bukan "belum diatur").
- `remindersMuted` — boolean, matikan seluruh reminder untuk task ini.

```bash
# deadline 25 Sep 14:00, ingatkan 90 menit sebelumnya
curl -X PATCH https://todo.nexigo.my.id/api/v1/todos/55d085df-... \
  -H "Authorization: Bearer ***" \
  -H 'Content-Type: application/json' \
  -d '{"dueTime":"14:00","remindLeadMinutes":90}'
```

Field yang tidak disertakan tidak diubah — mengirim `{"remindersMuted":true}`
tidak akan menghapus `remindLeadMinutes` yang sudah diatur. Mengirim `null`
secara eksplisit yang menghapus override.

---

### `DELETE /todos/:id` — hapus todo

→ **200** `{ "deleted": "<id>" }`. Reminder task ikut terhapus.

---

### `GET /todos/expiring` — todo yang akan kedaluwarsa

Pengganti praktis untuk "cek todo yang akan expired". Mengembalikan tiga
kelompok dalam satu panggilan:

- `overdue` — belum selesai dan `dueDate` sudah lewat
- `today` — jatuh tempo hari ini (menurut timezone user)
- `soon` — jatuh tempo dalam `within` hari ke depan (default `7`)

```bash
curl -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  "https://todo.nexigo.my.id/api/v1/todos/expiring?within=14"
```

```json
{
  "overdue": [ { "title": "OVERDUE invoice", "daysUntilDue": -3, "boardName": "API Test Board", ... } ],
  "today":   [ { "title": "DUE TODAY report", "daysUntilDue": 0, ... } ],
  "soon":    [ { "title": "SOON client call", "daysUntilDue": 2, ... } ],
  "meta": { "today": "2026-09-20", "within": 14, "counts": { "overdue": 1, "today": 1, "soon": 2 } }
}
```

---

### `GET /reminders` — agenda reminder

`view` — `upcoming` *(default)* | `inbox` | `kinds`

- `upcoming` — reminder yang akan datang untuk todo milik user, urut waktu
- `inbox` — reminder yang sudah terkirim / menunggu dibaca
- `kinds` — **katalog** jenis reminder + setelan notifikasi user (bukan daftar baris)

Parameter tambahan: `within` (hari, default `7`), `limit`, dan `unread=true`
(untuk `view=inbox`, hanya yang belum dibaca).

```json
{
  "reminders": [
    {
      "id": 41,
      "kind": "due_soon",
      "status": "pending",
      "scheduledFor": "2026-09-24T00:45:00.000Z",
      "sentAt": null,
      "readAt": null,
      "read": false,
      "boardId": "6dbb8633-...",
      "boardName": "API Test Board",
      "todo": { "id": "55d085df-...", "title": "SOON client call", "dueDate": "2026-09-26", "...": "..." }
    }
  ],
  "meta": { "count": 1, "view": "upcoming", "today": "2026-09-20", "timezone": "Asia/Makassar", "within": 7 }
}
```

Untuk `view=kinds`, respons berisi katalog (tanpa baris queue):

```json
{
  "kinds": [
    { "kind": "start_soon", "label": "Starting soon", "enabled": true, "leadMinutes": 0 },
    { "kind": "due_soon",   "label": "Due soon",      "enabled": true, "leadMinutes": 1440 },
    { "kind": "due_today",  "label": "Due today",     "enabled": true, "leadMinutes": null },
    { "kind": "overdue",    "label": "Overdue",       "enabled": true, "leadMinutes": null }
  ],
  "settings": { "pushEnabled": true, "defaultTime": "08:00", "quietStart": "22:00", "quietEnd": "07:00" },
  "meta": { "count": 4, "view": "kinds", "today": "2026-09-20", "timezone": "Asia/Makassar" }
}
```

Jenis reminder: `start_soon` (H-3 sebelum tanggal mulai), `due_soon` (sebelum
jatuh tempo, sesuai lead time user), `due_today` (pagi di hari jatuh tempo), dan
`overdue` (pagi setelah jatuh tempo, terkirim sekali). Semuanya dihitung dalam
zona waktu user.

---

### `POST /reminders` — tandai reminder dibaca

```bash
curl -X POST https://todo.nexigo.my.id/api/v1/reminders \
  -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"ids":["<reminderId>"]}'
```

Body: `{ "ids": ["..."] }` untuk reminder tertentu, atau `{ "all": true }` untuk
semua reminder user. Hanya reminder milik user pemilik key yang diproses.

---

## 6. CORS dan preflight

Setiap endpoint mendukung `OPTIONS` (preflight) dan mengembalikan header CORS,
sehingga API dapat dipanggil langsung dari browser atau dari server mana pun.

---

## 7. Contoh integrasi Hermes

Simpan key sebagai secret, lalu panggil API dari terminal:

```bash
export FLOWBOARD_API_KEY="fbk_..."

# 1. Apa yang harus saya kerjakan hari ini?
curl -s -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  "https://todo.nexigo.my.id/api/v1/todos?due=today" | jq '.todos[].title'

# 2. Apa yang sudah lewat / hampir lewat?
curl -s -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  "https://todo.nexigo.my.id/api/v1/todos/expiring?within=3" \
  | jq '{overdue: [.overdue[].title], today: [.today[].title], soon: [.soon[].title]}'

# 3. Tambah todo baru
curl -s -X POST -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"boardId":"'"$BOARD"'","title":"Follow up klien","dueDate":"2026-09-24"}' \
  "https://todo.nexigo.my.id/api/v1/todos"

# 4. Tandai selesai
curl -s -X PATCH -H "Authorization: Bearer $FLOWBOARD_API_KEY" \
  -H 'Content-Type: application/json' -d '{"completed":true}' \
  "https://todo.nexigo.my.id/api/v1/todos/$TASK_ID"
```

Pola aman untuk agen: gunakan key **read-only** untuk tugas pelaporan/ringkasan,
dan key `rw` terpisah hanya bila agen memang perlu mengubah data.

---

## 8. Catatan keamanan

- Server menyimpan **hash SHA-256** saja; nilai key tidak pernah bisa dibaca kembali.
- Key terikat pada satu user — isolasi data ditegakkan di setiap query.
- Revoke berlaku **segera**; request berikutnya dengan key itu menerima 401.
- `lastUsedAt` dicatat setiap kali key dipakai, sehingga key yang tidak terpakai
  dapat diidentifikasi dan di-revoke.
- Masa berlaku opsional (`expiresInDays`) untuk key sementara.
