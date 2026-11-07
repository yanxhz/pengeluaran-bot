# 🐷 Bot & Web Pengeluaran Harian

Bot Telegram + dashboard web untuk mencatat pengeluaran harian. Bisa jalan **lokal** (Python + SQLite) maupun **di Cloudflare** (Workers + D1) — gratis, 24/7, tanpa kartu kredit.

---

## ✨ Fitur

**Bot Telegram**
- Catat pengeluaran cepat: `makan 15000`, `15000 transport`, atau `makan 15000 nasi padang`.
- Rekap: `/hari_ini`, `/kemarin`, `/kategori` (per kategori), `/total` (per hari), `/bantuan`.
- Kelola: `/hapus <id>`, `/hapus_semua` (dengan konfirmasi).

**Web Dashboard** (Cloudflare)
- Ringkasan: saldo, pemasukan, pengeluaran, sisa budget, jumlah transaksi.
- Grafik harian, donat kategori, tren 5 bulan, breakdown pemasukan, kebutuhan vs keinginan.
- Rekap tahunan interaktif (count-up angka), filter transaksi, export CSV, backup.
- UI polish: count-up angka, donat pop-in, quick-add bar, toast sukses, cross-fade antar-tab, scroll-preserve setelah aksi, dark mode, PWA (bisa di-install).

---

## 🧱 Arsitektur

```
pengeluaran-bot/
├── bot.py                     # Bot Telegram lokal (Python)
├── start_bot.py               # Launcher: baca .env, cegah jalan dobel
├── pengeluaran.db             # Database lokal (SQLite) — TIDAK di-commit
├── cloudflare/                # Versi live: Cloudflare Workers + D1
│   ├── src/index.js           # Entry worker (route webhook + API)
│   ├── src/dashboard.js       # Render dashboard web + handler API
│   ├── schema.sql             # Skema database D1
│   ├── wrangler.toml          # Konfigurasi deploy
│   └── public/                # Aset PWA (manifest, service worker, ikon)
└── deploy/                    # Contoh systemd/service untuk bot lokal
```

**Data**: bot lokal pakai SQLite (`pengeluaran.db`); versi cloud pakai **D1 remote** di Cloudflare. Keduanya tidak pernah masuk ke git.

---

## 🤖 Menjalankan Bot Lokal

1. Buat bot di Telegram via [@BotFather](https://t.me/BotFather) → `/newbot`, simpan token.
2. Simpan token di file `.env` (sudah di-ignore git):

   ```
   BOT_TOKEN=123456:ABC-DEF...
   ```

3. Jalankan:

   ```bash
   python start_bot.py
   ```

   (Windows: `.venv\Scripts\pythonw.exe start_bot.py` untuk tanpa console / auto-start saat login.)

---

## ☁️ Deploy ke Cloudflare (Live)

1. Login & buat database D1:

   ```bash
   cd cloudflare
   wrangler login
   wrangler d1 create pengeluaran       # salin database_id ke wrangler.toml
   wrangler d1 execute pengeluaran --remote --file=schema.sql
   ```

2. Set token bot sebagai **secret** (aman, tidak masuk git):

   ```bash
   wrangler secret put TELEGRAM_TOKEN
   ```

3. Deploy worker:

   ```bash
   wrangler deploy
   ```

4. Arahkan webhook Telegram ke URL live:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pengeluaran-bot.pengeluaran-bot.workers.dev/webhook"
   ```

5. Tes di Telegram: `/start`, `makan 15000`, `/total`.

## 🛠️ Uji Lokal (sebelum deploy)

```bash
cd cloudflare
wrangler d1 execute pengeluaran --local --file=schema.sql
wrangler dev --local --port 8791
# buka http://127.0.0.1:8791/dashboard (login via mode demo / akun web)
```

---

## 🕵️ Keamanan

- Token bot & kredensial TIDAK pernah di-commit: tersimpan di `.env` / `.dev.vars` (lokal) dan Cloudflare **secret** (produksi).
- `pengeluaran.db` dan `*.db` di-ignore git — sumber kebenaran = D1 remote.
- `.gitignore` juga mengecualikan hasil build/debug (`cloudflare/tmp/`, `diag*.py`, `livetest*.py`, `*_live.html`).

---

## 📦 Teknologi

Python · SQLite · Cloudflare Workers · D1 · HTML/CSS/JS murni (tanpa framework) · PWA.

## 📄 Lisensi

Proyek pribadi. Silakan dipakai sebagai referensi.
