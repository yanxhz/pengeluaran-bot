"""
Bot Telegram pencatat pengeluaran harian.

Cara pakai:
  1. Isi TOKEN dari @BotFather (lihat README).
  2. Jalankan: python bot.py

Setelah bot jalan, chat Bot di Telegram:
  - "makan 15000"        -> catat pengeluaran (kategori = makan, nominal = 15000)
  - "15000 transport"     -> juga bisa, nominal dulu
  - /hari_ini             -> lihat pengeluaran hari ini
  - /kemarin              -> lihat kemarin
  - /kategori             -> rekap per kategori (bulan ini)
  - /total                -> rekap per hari (bulan ini)
  - /hapus <id>           -> hapus catatan berdasarkan id
  - /bantuan              -> daftar perintah
"""

import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters

# ---------- Konfigurasi ----------
TOKEN = os.environ.get("BOT_TOKEN", "ISI_TOKEN_DISINI")
DB_PATH = Path(os.environ.get("BOT_DB", str(Path(__file__).parent / "pengeluaran.db")))

# ---------- Database ----------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pengeluaran (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tanggal TEXT NOT NULL,
                kategori TEXT NOT NULL,
                nominal INTEGER NOT NULL,
                catatan TEXT DEFAULT ''
            )
            """
        )
        conn.commit()


def tambah_pengeluaran(tanggal, kategori, nominal, catatan=""):
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO pengeluaran (tanggal, kategori, nominal, catatan) VALUES (?, ?, ?, ?)",
            (tanggal, kategori.lower().strip(), int(nominal), catatan.strip()),
        )
        conn.commit()
        return cur.lastrowid


def list_hari(tanggal):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM pengeluaran WHERE tanggal = ? ORDER BY id",
            (tanggal,),
        ).fetchall()
    return rows


def total_hari(tanggal):
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(nominal), 0) AS total, COUNT(*) AS n FROM pengeluaran WHERE tanggal = ?",
            (tanggal,),
        ).fetchone()
    return row["total"], row["n"]


def rekap_per_kategori(bulan):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT kategori, SUM(nominal) AS total, COUNT(*) AS n
            FROM pengeluaran
            WHERE substr(tanggal, 1, 7) = ?
            GROUP BY kategori
            ORDER BY total DESC
            """,
            (bulan,),
        ).fetchall()
    return rows


def rekap_per_hari(bulan):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT tanggal, SUM(nominal) AS total, COUNT(*) AS n
            FROM pengeluaran
            WHERE substr(tanggal, 1, 7) = ?
            GROUP BY tanggal
            ORDER BY tanggal
            """,
            (bulan,),
        ).fetchall()
    return rows


def hapus_by_id(exp_id):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM pengeluaran WHERE id = ?", (exp_id,))
        conn.commit()
        return cur.rowcount


def hapus_semua():
    with get_db() as conn:
        cur = conn.execute("DELETE FROM pengeluaran")
        conn.commit()
        return cur.rowcount


# ---------- Parsing pesan ----------
def parse_pesan(teks):
    """Coba baca pesan jadi (nominal, kategori, catatan).

    Format yang didukung:
      - 'makan 15000'
      - '15000 makan'
      - 'makan 15000 nasi padang'
      - '15000 makan nasi'
    """
    # Bersihkan nominal dari titik (contoh: 15.000 -> 15000)
    teks2 = teks
    # Ambil angka (boleh pakai titik sebagai pemisah ribuan)
    import re

    # Cari pola nominal: angka dengan opsional titik, minimal 3 digit
    m = re.search(r"(\d[\d.]*|\d+)", teks.replace(",", "."))
    if not m:
        return None

    raw = m.group(1)
    nominal = int(raw.replace(".", "").replace(",", ""))
    if nominal <= 0:
        return None

    # Sisa teks jadi kategori + catatan
    sisa = teks.replace(m.group(1), "", 1).strip()
    if not sisa:
        return None

    # Kata pertama = kategori, sisanya = catatan
    bagian = sisa.split(maxsplit=1)
    kategori = bagian[0].lower().strip(" :,;")
    catatan = bagian[1].strip() if len(bagian) > 1 else ""
    return nominal, kategori, catatan


# ---------- Format tanggal ----------
def format_tanggal(tgl):
    return date.fromisoformat(tgl).strftime("%A, %d %b %Y")


# ---------- Helper reply ----------
def fmt_list(rows):
    if not rows:
        return "Belum ada pengeluaran."
    garis = []
    total = 0
    for r in rows:
        total += r["nominal"]
        tambahan = f" — {r['catatan']}" if r["catatan"] else ""
        garis.append(f"{r['id']}. {r['kategori']}: Rp {r['nominal']:,}{tambahan}")
    garis.append(f"\nTotal: Rp {total:,}")
    return "\n".join(garis)


# ---------- Handler ----------
async def start(update: Update, context):
    await update.message.reply_text(
        "Halo! Aku bot pencatat pengeluaran.\n\n"
        "Catat pengeluaran cukup ketik, contoh:\n"
        "  makan 15000\n"
        "  15000 transport\n\n"
        "Perintah:\n"
        "  /hari_ini — pengeluaran hari ini\n"
        "  /kemarin — pengeluaran kemarin\n"
        "  /kategori — rekap per kategori (bulan ini)\n"
        "  /total — rekap per hari (bulan ini)\n"
        "  /hapus <id> — hapus catatan\n"
        "  /hapus_semua — hapus SEMUA catatan (dengan konfirmasi)\n"
        "  /bantuan — bantuan ini"
    )


async def bantuan(update: Update, context):
    await update.message.reply_text(
        "Cara pakai:\n"
        "  'makan 15000' -> catat pengeluaran\n\n"
        "Perintah:\n"
        "  /hari_ini\n"
        "  /kemarin\n"
        "  /kategori\n"
        "  /total\n"
        "  /hapus <id>\n"
        "  /bantuan"
    )


async def catat(update: Update, context):
    # Cek konfirmasi hapus semua dulu
    if context.user_data.pop("pending_hapus_semua", False):
        teks = update.message.text.strip().lower()
        if teks in ("iya", "ya", "yakin", "deh", "siap"):
            n = hapus_semua()
            await update.message.reply_text(f"🗑️ Semua {n} catatan pengeluaran dihapus.")
        else:
            await update.message.reply_text("Dibatalkan. Nggak ada yang kehapus.")
        return

    teks = update.message.text.strip()
    hasil = parse_pesan(teks)
    if not hasil:
        await update.message.reply_text(
            "Aku gak paham. Contoh: 'makan 15000' atau '15000 transport'.\n"
            "Ketik /bantuan untuk bantuan."
        )
        return

    nominal, kategori, catatan = hasil
    tanggal = date.today().isoformat()
    exp_id = tambah_pengeluaran(tanggal, kategori, nominal, catatan)
    await update.message.reply_text(
        f"✅ Tercatat (id {exp_id}):\n"
        f"  {kategori}: Rp {nominal:,}\n"
        f"{'  Catatan: ' + catatan if catatan else ''}"
    )


async def hari_ini(update: Update, context):
    tanggal = date.today().isoformat()
    rows = list_hari(tanggal)
    total, n = total_hari(tanggal)
    if not rows:
        await update.message.reply_text(f"Belum ada pengeluaran hari ini ({format_tanggal(tanggal)}).")
        return
    await update.message.reply_text(
        f"📅 {format_tanggal(tanggal)}\n\n{fmt_list(rows)}"
    )


async def kemarin(update: Update, context):
    tanggal = (date.today() - timedelta(days=1)).isoformat()
    rows = list_hari(tanggal)
    if not rows:
        await update.message.reply_text(f"Tidak ada pengeluaran kemarin ({format_tanggal(tanggal)}).")
        return
    await update.message.reply_text(f"📅 {format_tanggal(tanggal)}\n\n{fmt_list(rows)}")


async def kategori(update: Update, context):
    bulan = date.today().strftime("%Y-%m")
    rows = rekap_per_kategori(bulan)
    if not rows:
        await update.message.reply_text(f"Belum ada data untuk bulan ini ({bulan}).")
        return
    total = sum(r["total"] for r in rows)
    teks = f"📊 Rekap per kategori — {bulan}\n\n"
    teks += "\n".join(f"  {r['kategori']}: Rp {r['total']:,} ({r['n']}x)" for r in rows)
    teks += f"\n\nTotal bulan ini: Rp {total:,}"
    await update.message.reply_text(teks)


async def total(update: Update, context):
    bulan = date.today().strftime("%Y-%m")
    rows = rekap_per_hari(bulan)
    if not rows:
        await update.message.reply_text(f"Belum ada data untuk bulan ini ({bulan}).")
        return
    total = sum(r["total"] for r in rows)
    teks = f"📊 Rekap per hari — {bulan}\n\n"
    teks += "\n".join(f"  {format_tanggal(r['tanggal'])}: Rp {r['total']:,} ({r['n']}x)" for r in rows)
    teks += f"\n\nTotal bulan ini: Rp {total:,}"
    await update.message.reply_text(teks)


async def hapus(update: Update, context):
    if not context.args:
        await update.message.reply_text("Pakai format: /hapus <id>")
        return
    try:
        exp_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("Id harus angka. Contoh: /hapus 3")
        return
    if hapus_by_id(exp_id):
        await update.message.reply_text(f"🗑️ Catatan id {exp_id} dihapus.")
    else:
        await update.message.reply_text(f"Tidak ada catatan dengan id {exp_id}.")


async def hapus_semua_handler(update: Update, context):
    context.user_data["pending_hapus_semua"] = True
    await update.message.reply_text(
        "⚠️ Yakin mau hapus SEMUA pengeluaran?\n"
        "Ketik **iya** buat konfirmasi, atau ketik apa aja buat batal."
    )


def main():
    init_db()

    app = Application.builder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("bantuan", bantuan))
    app.add_handler(CommandHandler("hari_ini", hari_ini))
    app.add_handler(CommandHandler("kemarin", kemarin))
    app.add_handler(CommandHandler("kategori", kategori))
    app.add_handler(CommandHandler("total", total))
    app.add_handler(CommandHandler("hapus", hapus))
    app.add_handler(CommandHandler("hapus_semua", hapus_semua_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, catat))

    print(f"Bot mulai... (database: {DB_PATH})")
    app.run_polling()


if __name__ == "__main__":
    main()
