' Auto-start bot pengeluaran (jalan otomatis saat login Windows).
' Jalankan telus pythonw (tanpa console window).
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = "C:\Users\USER\pengeluaran-bot"
ws.Run """C:\Users\USER\pengeluaran-bot\.venv\Scripts\pythonw.exe"" start_bot.py", 0, False
