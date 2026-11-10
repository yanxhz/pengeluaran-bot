import { handleDashboard, handleCheckLogin, handleLogout, handleWebRegister, handleWebLogin, handleWebDemo, handleAddTx, handleDeleteTx, handleUpdateTx, handleSetBudget, handleGetTxAll, handleExportCsv, handleExportXlsx, handleBackup, handleRenameKategori, handleDeleteAll, handleSetKategoriTipe } from './dashboard.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        return handleDashboard(request, env);
      }
      if (url.pathname === '/api/login/check') {
        return handleCheckLogin(request, env);
      }
      if (url.pathname === '/logout') {
        return handleLogout();
      }
      if (url.pathname === '/api/tx/all') {
        return handleGetTxAll(request, env);
      }
      if (url.pathname === '/api/csv') {
        return handleExportXlsx(request, env);
      }
      if (url.pathname === '/api/backup') {
        return handleBackup(request, env);
      }
      return new Response('not found', { status: 404 });
    }
    if (url.pathname === '/api/login/check') {
      return handleCheckLogin(request, env);
    }
    if (url.pathname === '/api/web/register') {
      return handleWebRegister(request, env);
    }
    if (url.pathname === '/api/web/login') {
      return handleWebLogin(request, env);
    }
    if (url.pathname === '/api/web/demo') {
      return handleWebDemo(request, env);
    }
    if (url.pathname === '/api/tx') {
      return handleAddTx(request, env);
    }
    if (url.pathname === '/api/tx/delete') {
      return handleDeleteTx(request, env);
    }
    if (url.pathname === '/api/tx/update') {
      return handleUpdateTx(request, env);
    }
    if (url.pathname === '/api/budget') {
      return handleSetBudget(request, env);
    }
    if (url.pathname === '/api/kategori/rename') {
      return handleRenameKategori(request, env);
    }
    if (url.pathname === '/api/tx/deleteall') {
      return handleDeleteAll(request, env);
    }
    if (url.pathname === '/api/kategori/tipe') {
      return handleSetKategoriTipe(request, env);
    }
    if (url.pathname === '/api/tx/all') {
      return handleGetTxAll(request, env);
    }
    if (url.pathname === '/api/csv') {
      return handleExportXlsx(request, env);
    }
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('not found', { status: 404 });
    }
    try {
      const update = await request.json();
      await handleUpdate(update, env);
    } catch (e) {
      // abaikan; jangan biarkan error memutus set webhook
    }
    return new Response('ok');
  },
};

/* ---------- helpers Telegram ---------- */
const API = (token) => `https://api.telegram.org/bot${token}`;

async function sendMsg(env, chatId, text) {
  await fetch(`${API(env.TELEGRAM_TOKEN)}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

/* ---------- tanggal (WIB = UTC+7) ---------- */
function wibDate(ts) {
  return new Date((ts + 7 * 3600) * 1000).toISOString().slice(0, 10);
}
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtTanggal(tgl) {
  const [y, m, d] = tgl.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${HARI[dt.getUTCDay()]}, ${d} ${BULAN[m - 1]} ${y}`;
}
const nf = (n) => n.toLocaleString('id-ID');

/* ---------- parsing input Indonesia ---------- */
function parseTanggal(sisa, dateTs) {
  let offset = 0;
  if (/kemarin lusa/i.test(sisa)) { offset = -2; sisa = sisa.replace(/kemarin lusa/ig, '').trim(); }
  else if (/kemarin/i.test(sisa)) { offset = -1; sisa = sisa.replace(/kemarin/ig, '').trim(); }
  const m = sisa.match(/tgl\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m) {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    let y = m[3] ? parseInt(m[3], 10) : null;
    const now = new Date((dateTs + 7 * 3600) * 1000);
    let year = y || now.getUTCFullYear();
    if (y !== null && y < 100) year = 2000 + y;
    return { sisa: sisa.replace(m[0], '').trim(), tanggal: `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }
  const dt = new Date((dateTs + offset * 86400 + 7 * 3600) * 1000);
  return { sisa, tanggal: dt.toISOString().slice(0, 10) };
}

function parsePesan(text, dateTs) {
  const cleaned = text.replace(/,/g, '.');
  const m = cleaned.match(/(\d[\d.]*|\d+)/);
  if (!m) return null;
  const nominal = parseInt(m[1].replace(/\./g, ''), 10);
  if (!(nominal > 0)) return null;
  const idx = cleaned.indexOf(m[1]);
  let sebelum = cleaned.slice(0, idx);
  let sesudah = cleaned.slice(idx + m[1].length);
  const parsedTgl = parseTanggal(sesudah, dateTs);
  sesudah = parsedTgl.sisa.trim();
  let kategori, catatan;
  if (!sebelum.trim()) {
    // nominal duluan: semua sisanya jadi kategori
    kategori = sesudah.toLowerCase().replace(/^[ :;,]+|[ :;,]+$/g, '');
    catatan = '';
  } else {
    kategori = sebelum.toLowerCase().replace(/^[ :;,]+|[ :;,]+$/g, '');
    catatan = sesudah;
  }
  if (!kategori) return null;
  return { nominal, kategori, catatan, tanggal: parsedTgl.tanggal };
}

/* ---------- format daftar ---------- */
function fmtList(rows) {
  if (!rows.length) return 'Belum ada pengeluaran.';
  const lines = rows.map((r) => {
    const cat = r.catatan ? ` — ${r.catatan}` : '';
    return `${r.kategori}: Rp ${nf(r.nominal)}${cat}`;
  });
  const total = rows.reduce((s, r) => s + r.nominal, 0);
  lines.push(`\nTotal: Rp ${nf(total)}`);
  return lines.join('\n');
}
const HELP =
  'Halo! Aku bot pencatat pengeluaran 📒\n\n' +
  '📝 Cara catat:\n' +
  '  makan 15000 — catat pengeluaran (hari ini)\n' +
  '  +gaji 5000000 — catat PEMASUKAN (mis. gaji/bonus)\n' +
  '  makan siang 15000 — kategori bisa lebih dari 1 kata\n' +
  '  makan 15000 kemarin — catat buat tanggal kemarin\n' +
  '  makan 15000 tgl 27/10 — catat buat tanggal tertentu\n' +
  '  15000 transport — boleh nominal duluan\n\n' +
  '📊 Rekap:\n' +
  '  /hari_ini — pengeluaran hari ini\n' +
  '  /kemarin — pengeluaran kemarin\n' +
  '  /total — rekap per hari (bulan berjalan)\n' +
  '  /kategori — rekap per kategori\n' +
  '    bonus: /total 11 2026 atau /kategori 11 2026 buat lihat bulan/tahun tertentu\n\n' +
  '💰 Budget & data:\n' +
  '  /budget — lihat budget bulan ini\n' +
  '  /budget 1000000 — set budget bulan ini\n' +
  '  /export — kirim data (CSV) ke chat ini\n\n' +
  '✏️ Kelola catatan:\n' +
  '  /hapus — hapus catatan (pilih nomor)\n' +
  '  /edit — ubah catatan (pilih nomor)\n' +
  '  /hapus_semua — hapus SEMUA (dengan konfirmasi)\n\n' +
  '📊 Dashboard web:\n' +
  '  Buka https://pengeluaran-bot.pengeluaran-bot.workers.dev/dashboard\n' +
  '  Login pakai Telegram — lihat grafik & rekap pengeluaran kamu\n\n' +
  '  /bantuan — tampilkan bantuan ini';

/* ---------- menu interaktif (10 catatan terakhir) ---------- */
async function menuTerakhir(env, chatId) {
  const rows = await env.DB
    .prepare('SELECT id, tanggal, kategori, nominal, catatan FROM pengeluaran WHERE chat_id = ? ORDER BY id DESC LIMIT 10')
    .bind(chatId)
    .all();
  const list = rows.results || [];
  const lines = list.map((r, i) =>
    `${i + 1}. ${r.kategori}: Rp ${nf(r.nominal)}` + (r.catatan ? ` — ${r.catatan}` : '') + ` (${r.tanggal})`
  );
  return { list, lines };
}

/* ---------- resolve bulan/tahun dari argumen (mis. /total 11, /total 11 2025, /total 2025) ---------- */
function targetBulan(args, bulan) {
  let y = Number(bulan.slice(0, 4));
  let m = Number(bulan.slice(5, 7));
  if (args.length) {
    const a0 = parseInt(args[0], 10);
    if (Number.isInteger(a0)) {
      if (a0 >= 1 && a0 <= 12) m = a0;
      else if (a0 >= 1000 && a0 <= 9999) y = a0;
    }
  }
  if (args.length > 1) {
    const a1 = parseInt(args[1], 10);
    if (Number.isInteger(a1) && a1 >= 1000 && a1 <= 9999) y = a1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ---------- budget bulanan ---------- */
async function getBudget(env, chatId, tb) {
  return await env.DB.prepare('SELECT nominal FROM budget WHERE chat_id = ? AND bulan = ?').bind(chatId, tb).first();
}
function fmtBudgetLine(b, spent) {
  if (!b) return '';
  const sisa = b.nominal - spent;
  const status = sisa >= 0 ? `Sisa: Rp ${nf(sisa)}` : `⚠️ Lebih Rp ${nf(-sisa)}`;
  return `\n\n💰 Budget ${b.bulan}: Rp ${nf(b.nominal)}\nTerpakai: Rp ${nf(spent)}\n${status}`;
}

/* ---------- export CSV ---------- */
async function exportCsv(env, chatId) {
  const rows = await env.DB.prepare('SELECT * FROM pengeluaran WHERE chat_id = ? ORDER BY tanggal, id').bind(chatId).all();
  const hasil = rows.results || [];
  let csv = 'tanggal,kategori,nominal,catatan\n';
  const es = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  for (const r of hasil) {
    csv += `${es(r.tanggal)},${es(r.kategori)},${r.nominal},${es(r.catatan)}\n`;
  }
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([csv], { type: 'text/csv' }), 'pengeluaran.csv');
  await fetch(`${API(env.TELEGRAM_TOKEN)}/sendDocument`, { method: 'POST', body: form });
}

/* ---------- handler utama ---------- */
async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // ---- Login dashboard via kode deep-link (di_xxx) ----
  // Diproses di sini (di luar gate registrasi nama) supaya user baru pun bisa login dulu.
  const diM = text.match(/^\/start\s+(di_[0-9a-f]{8,16})$/i);
  if (diM) {
    const code = diM[1].replace(/^di_/, '');
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS login_req (code TEXT PRIMARY KEY, created INTEGER NOT NULL, chat_id INTEGER)'
    ).run();
    await env.DB.prepare('UPDATE login_req SET chat_id = ? WHERE code = ?').bind(chatId, code).run();
    const regDi = await env.DB.prepare('SELECT nama FROM pengguna WHERE chat_id = ?').bind(chatId).first();
    await sendMsg(env, chatId, regDi
      ? '✅ Kode login diterima. Buka lagi halaman dashboard.'
      : '✅ Kode diterima. Ketik nama kamu dulu ya (cth: Kael), buat daftar.');
    return;
  }

  // ---- Pendaftaran nama (sekali saja per chat) ----
  const reg = await env.DB.prepare('SELECT nama FROM pengguna WHERE chat_id = ?').bind(chatId).first();
  if (!reg) {
    const stRow = await env.DB.prepare('SELECT pending FROM state WHERE chat_id = ?').bind(chatId).first();
    if (stRow && stRow.pending === 10) {
      const nama = text.trim().slice(0, 50);
      if (!nama || text.startsWith('/')) {
        await sendMsg(env, chatId, 'Ketik nama kamu dulu ya (cth: Kael).');
        return;
      }
      await env.DB.prepare('INSERT INTO pengguna (chat_id, nama) VALUES (?, ?)').bind(chatId, nama).run();
      await env.DB.prepare('UPDATE state SET pending = 0 WHERE chat_id = ?').bind(chatId).run();
      await sendMsg(env, chatId, `Siap! Halo ${nama} 👋 Ketik /bantuan buat mulai.`);
      return;
    }
    await env.DB.prepare('INSERT OR REPLACE INTO state (chat_id, pending) VALUES (?, 10)').bind(chatId).run();
    await sendMsg(env, chatId, 'Halo! Sebelum pakai, ketik nama kamu dulu ya (cth: Kael).');
    return;
  }

  if (text.startsWith('/')) {
    await handleCommand(chatId, text, msg, env);
    return;
  }

  // state interaktif (hapus/edit)
  const row = await env.DB.prepare('SELECT pending, target_id FROM state WHERE chat_id = ?').bind(chatId).first();
  if (row && row.pending) {
    if (row.pending === 1) {
      // konfirmasi /hapus_semua
      await env.DB.prepare('UPDATE state SET pending = 0 WHERE chat_id = ?').bind(chatId).run();
      const t = text.toLowerCase();
      if (['iya', 'ya', 'yakin', 'deh', 'siap'].includes(t)) {
        const res = await env.DB.prepare('DELETE FROM pengeluaran WHERE chat_id = ?').bind(chatId).run();
        await sendMsg(env, chatId, `🗑️ Semua ${res.meta.changes ?? 0} catatan dihapus.`);
      } else {
        await sendMsg(env, chatId, 'Dibatalkan. Nggak ada yang kehapus.');
      }
      return;
    }

    if (row.pending === 2) {
      // pilih nomor untuk dihapus
      await env.DB.prepare('UPDATE state SET pending = 0 WHERE chat_id = ?').bind(chatId).run();
      if (text === '0' || text.toLowerCase() === 'batal') {
        await sendMsg(env, chatId, 'Dibatalkan.');
        return;
      }
      const { list } = await menuTerakhir(env, chatId);
      const n = parseInt(text, 10);
      const target = list[n - 1];
      if (!target) {
        await sendMsg(env, chatId, 'Nomor tidak valid. Ketik /hapus buat lihat menu lagi.');
        return;
      }
      const res = await env.DB.prepare('DELETE FROM pengeluaran WHERE id = ? AND chat_id = ?').bind(target.id, chatId).run();
      await sendMsg(env, chatId, `🗑️ ${target.kategori}: Rp ${nf(target.nominal)} dihapus.`);
      return;
    }

    if (row.pending === 3) {
      // pilih nomor untuk diedit -> simpan target_id
      if (text === '0' || text.toLowerCase() === 'batal') {
        await env.DB.prepare('UPDATE state SET pending = 0, target_id = NULL WHERE chat_id = ?').bind(chatId).run();
        await sendMsg(env, chatId, 'Dibatalkan.');
        return;
      }
      const { list } = await menuTerakhir(env, chatId);
      const n = parseInt(text, 10);
      const target = list[n - 1];
      if (!target) {
        await sendMsg(env, chatId, 'Nomor tidak valid. Ketik /edit buat lihat menu lagi.');
        return;
      }
      await env.DB.prepare('UPDATE state SET pending = 4, target_id = ? WHERE chat_id = ?').bind(target.id, chatId).run();
      await sendMsg(env, chatId, `✏️ Edit catatan: ${target.kategori}: Rp ${nf(target.nominal)}.\nKetik salah satu:\n  nominal 25000\n  kategori makan\n  catatan nasi padang`);
      return;
    }

    if (row.pending === 4) {
      // terima nilai edit
      const m = text.match(/^(nominal|kategori|catatan)\s+(.+)$/i);
      if (!m) {
        await sendMsg(env, chatId, 'Format salah. Ketik misal: nominal 25000 / kategori makan / catatan nasi padang');
        return;
      }
      const field = m[1].toLowerCase();
      const val = m[2].trim();
      const tid = row.target_id;
      if (field === 'nominal') {
        const nominal = parseInt(val.replace(/\./g, '').replace(/[^\d]/g, ''), 10);
        if (!(nominal > 0)) {
          await sendMsg(env, chatId, 'Nominal harus angka lebih dari 0.');
          return;
        }
        await env.DB.prepare('UPDATE pengeluaran SET nominal = ? WHERE id = ? AND chat_id = ?').bind(nominal, tid, chatId).run();
        await sendMsg(env, chatId, `✅ Nominal diubah jadi Rp ${nf(nominal)}.`);
      } else if (field === 'kategori') {
        await env.DB.prepare('UPDATE pengeluaran SET kategori = ? WHERE id = ? AND chat_id = ?').bind(val.toLowerCase(), tid, chatId).run();
        await sendMsg(env, chatId, `✅ Kategori diubah jadi "${val}".`);
      } else {
        await env.DB.prepare('UPDATE pengeluaran SET catatan = ? WHERE id = ? AND chat_id = ?').bind(val, tid, chatId).run();
        await sendMsg(env, chatId, `✅ Catatan diubah jadi "${val}".`);
      }
      await env.DB.prepare('UPDATE state SET pending = 0, target_id = NULL WHERE chat_id = ?').bind(chatId).run();
      return;
    }
  }

  let rawIn = text;
  let tipe = 'keluar';
  if (rawIn.charAt(0) === '+') { tipe = 'masuk'; rawIn = rawIn.slice(1).trim(); }
  const parsed = parsePesan(rawIn, msg.date);
  if (!parsed) {
    await sendMsg(env, chatId, "Aku gak paham. Contoh: 'makan 15000' atau '+gaji 5000000'. Ketik /bantuan.");
    return;
  }
  const res = await env.DB
    .prepare('INSERT INTO pengeluaran (chat_id, tanggal, kategori, nominal, catatan, tipe) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(chatId, parsed.tanggal, parsed.kategori, parsed.nominal, parsed.catatan, tipe)
    .run();
  const emoji = tipe === 'masuk' ? '📥 Masuk' : '✅ Keluar';
  const catatan = parsed.catatan ? `\n  Catatan: ${parsed.catatan}` : '';
  const infoTgl = parsed.tanggal !== wibDate(msg.date) ? `\n  📅 ${fmtTanggal(parsed.tanggal)}` : '';
  await sendMsg(env, chatId, `${emoji} tercatat:\n  ${parsed.kategori}: Rp ${nf(parsed.nominal)}${catatan}${infoTgl}`);
}

async function handleCommand(chatId, text, msg, env) {
  const [cmd, ...args] = text.split(/\s+/);
  const tanggal = wibDate(msg.date);
  const bulan = tanggal.slice(0, 7);

  switch (cmd) {
    case '/start':
    case '/bantuan': {
      const u = await env.DB.prepare('SELECT nama FROM pengguna WHERE chat_id = ?').bind(chatId).first();
      const nama = u && u.nama ? u.nama : 'Pengguna';
      await sendMsg(env, chatId, `Halo ${nama}! 👋\n\n` + HELP);
      break;
    }

    case '/hari_ini': {
      const rows = await env.DB.prepare('SELECT * FROM pengeluaran WHERE chat_id = ? AND tanggal = ? ORDER BY id').bind(chatId, tanggal).all();
      if (!rows.results.length) {
        await sendMsg(env, chatId, `Belum ada pengeluaran hari ini (${fmtTanggal(tanggal)}).`);
      } else {
        await sendMsg(env, chatId, `📅 ${fmtTanggal(tanggal)}\n\n${fmtList(rows.results)}`);
      }
      break;
    }

    case '/kemarin': {
      const k = wibDate(msg.date - 86400);
      const rows = await env.DB.prepare('SELECT * FROM pengeluaran WHERE chat_id = ? AND tanggal = ? ORDER BY id').bind(chatId, k).all();
      if (!rows.results.length) {
        await sendMsg(env, chatId, `Tidak ada pengeluaran kemarin (${fmtTanggal(k)}).`);
      } else {
        await sendMsg(env, chatId, `📅 ${fmtTanggal(k)}\n\n${fmtList(rows.results)}`);
      }
      break;
    }

    case '/kategori': {
      const tb = targetBulan(args, bulan);
      const rows = await env.DB
        .prepare('SELECT kategori, SUM(nominal) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ? GROUP BY kategori ORDER BY total DESC')
        .bind(chatId, tb)
        .all();
      if (!rows.results.length) {
        await sendMsg(env, chatId, `Belum ada data untuk ${tb}.`);
        break;
      }
      const total = rows.results.reduce((s, r) => s + r.total, 0);
      const lines = rows.results.map((r) => `  ${r.kategori}: Rp ${nf(r.total)} (${r.n}x)`);
      await sendMsg(env, chatId, `📊 Rekap per kategori — ${tb}\n\n${lines.join('\n')}\n\nTotal ${tb}: Rp ${nf(total)}`);
      break;
    }

    case '/total': {
      const tb = targetBulan(args, bulan);
      const rows = await env.DB
        .prepare('SELECT tanggal, SUM(nominal) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ? GROUP BY tanggal ORDER BY tanggal')
        .bind(chatId, tb)
        .all();
      if (!rows.results.length) {
        await sendMsg(env, chatId, `Belum ada data untuk ${tb}.`);
        break;
      }
      const total = rows.results.reduce((s, r) => s + r.total, 0);
      const lines = rows.results.map((r) => `  ${fmtTanggal(r.tanggal)}: Rp ${nf(r.total)} (${r.n}x)`);
      const b = await getBudget(env, chatId, tb);
      await sendMsg(env, chatId, `📊 Rekap per hari — ${tb}\n\n${lines.join('\n')}\n\nTotal ${tb}: Rp ${nf(total)}` + fmtBudgetLine(b, total));
      break;
    }

    case '/budget': {
      const tb = targetBulan(args, bulan);
      if (args.length && /^\d+$/.test(args[0])) {
        const nominal = parseInt(args[0], 10);
        if (!(nominal > 0)) {
          await sendMsg(env, chatId, 'Nominal harus angka lebih dari 0.');
          break;
        }
        const tbSet = targetBulan(args.slice(1), bulan);
        await env.DB.prepare('INSERT INTO budget (chat_id, bulan, nominal) VALUES (?, ?, ?) ON CONFLICT(chat_id, bulan) DO UPDATE SET nominal = excluded.nominal').bind(chatId, tbSet, nominal).run();
        await sendMsg(env, chatId, `💰 Budget ${tbSet} diset: Rp ${nf(nominal)}.`);
        break;
      }
      const b = await getBudget(env, chatId, tb);
      if (!b) {
        await sendMsg(env, chatId, `Belum ada budget untuk ${tb}. Ketik /budget <nominal> buat pasang.`);
        break;
      }
      const spentRes = await env.DB.prepare('SELECT COALESCE(SUM(nominal),0) AS tot FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ?').bind(chatId, tb).first();
      const spent = Number(spentRes ? spentRes.tot : 0);
      await sendMsg(env, chatId, `💰 Budget ${tb}: Rp ${nf(b.nominal)}\nTerpakai: Rp ${nf(spent)}\n` + (b.nominal - spent >= 0 ? `Sisa: Rp ${nf(b.nominal - spent)}` : `⚠️ Lebih Rp ${nf(spent - b.nominal)}`));
      break;
    }

    case '/export': {
      await exportCsv(env, chatId);
      break;
    }

    case '/hapus': {
      const idArg = parseInt(args[0], 10);
      if (Number.isInteger(idArg)) {
        // /hapus <id> tetap didukung
        const res = await env.DB.prepare('DELETE FROM pengeluaran WHERE id = ? AND chat_id = ?').bind(idArg, chatId).run();
        if (res.meta.changes) {
          await sendMsg(env, chatId, '🗑️ Catatan dihapus.');
        } else {
          await sendMsg(env, chatId, 'Tidak ada catatan yang cocok.');
        }
        break;
      }
      const { list, lines } = await menuTerakhir(env, chatId);
      if (!list.length) {
        await sendMsg(env, chatId, 'Belum ada catatan buat dihapus.');
        break;
      }
      await env.DB.prepare('INSERT OR REPLACE INTO state (chat_id, pending) VALUES (?, 2)').bind(chatId).run();
      await sendMsg(env, chatId, '🗑️ Pilih nomor buat dihapus:\n' + lines.join('\n') + '\n\n0. Batal');
      break;
    }

    case '/edit': {
      const idArg = parseInt(args[0], 10);
      if (Number.isInteger(idArg)) {
        // /edit <id> langsung set target
        const exist = await env.DB.prepare('SELECT id FROM pengeluaran WHERE id = ? AND chat_id = ?').bind(idArg, chatId).first();
        if (!exist) {
          await sendMsg(env, chatId, 'Tidak ada catatan yang cocok.');
          break;
        }
        await env.DB.prepare('INSERT OR REPLACE INTO state (chat_id, pending, target_id) VALUES (?, 4, ?)').bind(chatId, idArg).run();
        await sendMsg(env, chatId, '✏️ Edit catatan.\nKetik salah satu:\n  nominal 25000\n  kategori makan\n  catatan nasi padang');
        break;
      }
      const { list, lines } = await menuTerakhir(env, chatId);
      if (!list.length) {
        await sendMsg(env, chatId, 'Belum ada catatan buat diedit.');
        break;
      }
      await env.DB.prepare('INSERT OR REPLACE INTO state (chat_id, pending) VALUES (?, 3)').bind(chatId).run();
      await sendMsg(env, chatId, '✏️ Pilih nomor buat diedit:\n' + lines.join('\n') + '\n\n0. Batal');
      break;
    }

    case '/hapus_semua': {
      await env.DB.prepare('INSERT OR REPLACE INTO state (chat_id, pending) VALUES (?, 1)').bind(chatId).run();
      await sendMsg(env, chatId, '⚠️ Yakin mau hapus SEMUA pengeluaran?\nKetik **iya** buat konfirmasi, atau ketik apa aja buat batal.');
      break;
    }

    default:
      await sendMsg(env, chatId, "Perintah tidak dikenal. Ketik /bantuan.");
  }
}
