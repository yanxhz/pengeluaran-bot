# Deploy bot pengeluaran ke Oracle Cloud Always Free

Target: VM Ubuntu (Always Free tier) — bot jalan 24/7 walau laptop mati.

## 1. Bikin VM (Oracle Cloud)
1. Daftar di https://www.oracle.com/cloud/free/ (perlu email + verifikasi kartu — TIDAK akan ditagih selama pakai tier Always Free).
2. Console -> Compute -> Instances -> Create instance.
   - Image: Ubuntu 22.04/24.04 (or Ubuntu).
   - Shape: pilih yang berlabel "Always Free eligible" (contoh VM.Standard.E2.1.Micro / Ampere A1).
   - SSH: simpan key pair (atau upload public key kamu).
3. Setelah jadi, catat public IP-nya.

## 2. SSH ke VM
    ssh ubuntu@<IP>

## 3. Upload kode
Dari laptop (folder C:\Users\USER\pengeluaran-bot\deploy):
    scp -r deploy/app deploy/requirements.txt ubuntu@<IP>:/home/ubuntu/

Lalu di VM:
    sudo mkdir -p /opt/pengeluaran-bot
    sudo mv /home/ubuntu/app/* /opt/pengeluaran-bot/
    sudo mv /home/ubuntu/requirements.txt /opt/pengeluaran-bot/
    sudo chown -R ubuntu:ubuntu /opt/pengeluaran-bot

## 4. Install python + deps
    sudo apt update
    sudo apt install -y python3-venv
    cd /opt/pengeluaran-bot
    python3 -m venv venv
    ./venv/bin/pip install -r requirements.txt

## 5. Jalankan sebagai service (auto-start saat VM nyala)
    sudo cp /opt/pengeluaran-bot/pengeluaran-bot.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now pengeluaran-bot
    sudo systemctl status pengeluaran-bot     # cek: aktif / running

Log:  sudo journalctl -u pengeluaran-bot -f

## 6. (Opsional) Impor data lama
Kalau mau bot cloud mulai dengan data yang sekarang ada:
    cat > /opt/pengeluaran-bot/import.py <<'EOF'
import sqlite3
sql = open("seed.sql", encoding="utf-8").read()
con = sqlite3.connect("pengeluaran.db")
con.executescript(sql); con.commit(); print("ok")
EOF
    python3 - <<'EOF'
import sqlite3
con = sqlite3.connect("pengeluaran.db")
cur = con.cursor()
cur.execute("SELECT id,tanggal,kategori,nominal,catatan FROM pengeluaran ORDER BY id")
with open("seed.sql","w") as f:
    for (i,t,k,n,c) in cur.fetchall():
        f.write("INSERT INTO pengeluaran (id,tanggal,kategori,nominal,catatan) VALUES (%d,'%s','%s',%d,'%s');\n" % (i,t,k,n,c.replace("'","''")))
EOF

Catatan:
- Token sudah ada di .env (sudah dibawa di folder deploy/app).
- Bot di laptop boleh dimatikan; yang di VM yang melayani.
- Kalau mau hapus bot lokal, cukup stop pythonw-nya & hapus shortcut Startup.
