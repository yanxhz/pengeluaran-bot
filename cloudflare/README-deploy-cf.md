# Deploy bot pengeluaran ke Cloudflare Workers + D1 (GRATIS, tanpa kartu)

Jalan 24/7 di edge Cloudflare, gratis, nggak butuh kartu kredit.
Gantikan bot lokal: begit cloud hidup, bot di laptop boleh dimatiin.

## Prasyarat
- Akun Cloudflare (cukup email — GRATIS): https://dash.cloudflare.com/sign-up
- Node.js + npm: https://nodejs.org (pilih LTS, install).

## Langkah
Buka terminal di folder ini (cloudflare):

1. Install wrangler + login:
       npm install -g wrangler
       wrangler login          # buka browser, izinkan

2. Bikin database D1:
       wrangler d1 create pengeluaran
   Output-nya ada `database_id`. Copy id itu ke wrangler.toml
   (ganti `<ISI_ID_DARI: wrangler d1 create pengeluaran>`).

3. Bikin tabel:
       wrangler d1 execute pengeluaran --remote --file=schema.sql

4. Set token bot (aman, tersimpan sebagai secret):
       wrangler secret put TELEGRAM_TOKEN
   Paste token bot (8987129580:AAE_hgM9LeAyKZybCgWjtEBZJRAKGjPh6K8)
   (kalau mau simpel, bisa langsung isi [vars] di wrangler.toml,
    tapi secret lebih aman).

5. Deploy worker:
       wrangler deploy
   Dapat URL: https://pengeluaran-bot.<subdomain>.workers.dev

6. Arahin webhook Telegram ke URL itu:
       curl -s "https://api.telegram.org/bot8987129580:AAE_hgM9LeAyKZybCgWjtEBZJRAKGjPh6K8/setWebhook?url=https://pengeluaran-bot.<subdomain>.workers.dev/webhook"

7. Tes: chat @kel_catatan_pengeluaran_bot di Telegram
   (ketik /start, /hari_ini, "makan 15000", /kategori, dst).

## Uji lokal (opsional, sebelum deploy)
       wrangler d1 execute pengeluaran --local --file=schema.sql
       wrangler dev
   Terus kirim POST manual ke http://localhost:8787/webhook dengan body update Telegram.

## Catatan
- Semua fitur sama dengan bot lokal: /start, /bantuan, /hari_ini,
  /kemarin, /kategori, /total, /hapus <id>, /hapus_semua (dengan
  konfirmasi), plus input bebas seperti "makan 15000".
- Data simpan di D1 (Cloudflare), bukan di laptop — aman walau laptop mati.
- Kalau mau cek data:  wrangler d1 execute pengeluaran --remote --command="SELECT * FROM pengeluaran"
- Kalau mau HAPUS bot lokal: stop pythonw & hapus shortcut di Startup
  (C:\Users\USER\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\pengeluaran-bot.vbs).
