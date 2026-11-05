"""Launcher bot pengeluaran: baca .env, cegah dobel, lalu jalankan bot."""
import os
import socket
import sys
from pathlib import Path

BASE = Path(__file__).parent


def load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


_lock_socket = None


def acquire_lock(port: int = 20129) -> bool:
    """Hold a localhost socket as a lock so only one bot instance polls."""
    global _lock_socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        s.listen(1)
    except OSError:
        return False
    _lock_socket = s  # keep socket referenced for process lifetime
    return True


def main():
    load_dotenv(BASE / ".env")
    if not os.environ.get("BOT_TOKEN"):
        print("BOT_TOKEN tidak ada di .env — tidak bisa jalankan bot.")
        sys.exit(1)
    if not acquire_lock():
        print("Bot sudah berjalan (lock aktif).")
        sys.exit(0)
    import bot
    bot.main()


if __name__ == "__main__":
    main()
