# Bot Telegram Pencatat Pengeluaran Harian

Bot sederhana buat catat pengeluaran harian lewat Telegram.

## Persiapan (sekali saja)

1. Buka Telegram, cari **BotFather** (username: `@BotFather`).
2. Ketik `/newbot`, ikuti instruksi, lalu beri nama.
3. BotFather akan kasih **token** (berbentuk `123456:ABC-DEF...`). Simpan.

## Menjalankan

Set token lalu jalankan:

    BOT_TOKEN="123456:ABC-DEF..." python bot.py

Di Windows PowerShell:

    $env:BOT_TOKEN="123456:ABC-DEF..."
    python bot.py

> Kalau gak mau pakai environment variable, edit file `bot.py`, ganti baris
> `TOKEN = os.environ.get("BOT_TOKEN", "ISI_TOKEN_DISINI")` dengan token kamu.

## Cara pakai di Telegram

Chat bot kamu:

| Input | Arti |
|---|---|
| `makan 15000` | catat pengeluaran makan 15000 |
| `15000 transport` | opsi format, nominal duluan |
| `makan 15000 nasi padang` | sertakan catatan |
| `/hari_ini` | pengeluaran hari ini |
| `/kemarin` | pengeluaran kemarin |
| `/kategori` | rekap per kategori (bulan ini) |
| `/total` | rekap per hari (bulan ini) |
| `/hapus 3` | hapus catatan id 3 |
| `/bantuan` | daftar perintah |

## Data

Tersimpan di `pengeluaran.db` (SQLite) di folder yang sama. Aman dihapus/
dicopy. Format:

| id | tanggal | kategori | nominal | catatan |
|----|---------|----------|---------|---------|
| 1 | 2026-10-27 | makan | 15000 | nasi padang |
