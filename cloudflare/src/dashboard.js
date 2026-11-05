// Dashboard personal expense tracker (dark fintech) — multiuser login via deep-link kode.
// Baca D1 `pengeluaran` (tipe: masuk/keluar) + `budget`. Semua angka dari data nyata.

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n).toLocaleString('id-ID');
const bufToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function wibNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function bulanWIB(off = 0) {
  const d = wibNow();
  d.setUTCMonth(d.getUTCMonth() + off);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function fmtBulan(str) {
  const [y, m] = str.split('-').map(Number);
  return `${BULAN[m - 1]} ${y}`;
}
function daysInMonth(str) {
  const [y, m] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function greetingWIB() {
  const h = wibNow().getUTCHours();
  if (h < 11) return 'Selamat Pagi';
  if (h < 15) return 'Selamat Siang';
  if (h < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}
function todayLabelWIB() {
  const d = wibNow();
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return `${HARI[dt.getUTCDay()]}, ${dt.getUTCDate()} ${BULAN[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/* ---------- kriptografi (Web Crypto) ---------- */
async function digestBytes(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}
async function hmacHex(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return bufToHex(sig);
}
let _secret = null;
async function secretKey(env) {
  if (!_secret) {
    const tk = env.TELEGRAM_TOKEN;
    if (!tk) return null;
    _secret = new Uint8Array(await digestBytes(tk));
  }
  return _secret;
}

function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
async function signUser(userId, keyBytes) {
  const aud = Math.floor(Date.now() / 1000) + 30 * 86400;
  const h = await hmacHex(keyBytes, `${userId}.${aud}`);
  return `${userId}.${aud}.${h}`;
}
async function verifyUser(cookie, keyBytes) {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [userId, aud, h] = parts;
  if (Number(aud) < Math.floor(Date.now() / 1000)) return null;
  if ((await hmacHex(keyBytes, `${userId}.${aud}`)) !== h) return null;
  const id = parseInt(userId, 10);
  return Number.isInteger(id) ? id : null;
}

/* ---------- tabel kode login ---------- */
let _tbl = null;
async function ensureLoginTable(env) {
  if (_tbl) return true;
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS login_req (code TEXT PRIMARY KEY, created INTEGER NOT NULL, chat_id INTEGER)'
    ).run();
    _tbl = true;
    return true;
  } catch { return false; }
}
function genCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function saveCode(env, code) {
  await ensureLoginTable(env);
  await env.DB.prepare(
    'INSERT INTO login_req (code, created, chat_id) VALUES (?, ?, NULL) ON CONFLICT(code) DO UPDATE SET created = excluded.created'
  ).bind(code, Date.now()).run();
}
async function takeCode(env, code) {
  await ensureLoginTable(env);
  const row = await env.DB.prepare('SELECT chat_id, created FROM login_req WHERE code = ?').bind(code).first();
  if (!row || !row.chat_id) return null;
  if (Date.now() - Number(row.created) > 10 * 60 * 1000) return null;
  return Number(row.chat_id);
}

/* ---------- halaman login ---------- */
function loginPage(code, botUsername) {
  const link = `https://t.me/${botUsername}?start=di_${code}`;
  const body = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk — Catatan Pengeluaran</title>
<style>
 :root{--bg:#0C0B12;--card:#181622;--line:rgba(160,32,240,.18);--tx:#F5F3FA;--mut:#9B96AA;--p:#A020F0}
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:radial-gradient(1100px 480px at 70% -10%, rgba(160,32,240,.20), transparent 60%), var(--bg);
 color:var(--tx);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{background:var(--card);border:1px solid var(--line);padding:40px;border-radius:22px;width:380px;
 box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center}
 h1{font-size:21px;margin:0 0 6px}
 p{color:var(--mut);font-size:13.5px;margin:0 0 26px;line-height:1.6}
 .big{display:inline-block;background:linear-gradient(135deg,#A020F0,#7B2FF7);color:#fff;font-weight:800;
 padding:14px 26px;border-radius:14px;text-decoration:none;font-size:15px;box-shadow:0 10px 30px rgba(160,32,240,.35)}
 .big:hover{filter:brightness(1.08)}
 .status{margin-top:18px;color:var(--mut);font-size:13px}
 .ok{color:#22C55E;font-weight:700}
</style></head><body>
<div class="card"><h1>🔒 Catatan Pengeluaran</h1>
<p>Klik tombol di bawah, buka di Telegram, lalu tekan <b>Start</b>. Setelah itu kembali ke halaman ini.</p>
<a class="big" href="${link}" target="_blank">Masuk dengan Telegram</a>
<div class="status" id="st">Menunggu kamu menekan Start di Telegram…</div>
</div>
<script>
const CODE = ${JSON.stringify(code)};
(function poll(){
  fetch('/api/login/check?code='+CODE, {credentials:'same-origin'})
    .then(r=>r.json()).then(j=>{
      if(j.ok){ document.getElementById('st').innerHTML='<span class="ok">✓ Berhasil. Mengarahkan…</span>'; setTimeout(()=>location.href='/dashboard',600); }
      else setTimeout(poll,2000);
    }).catch(()=>setTimeout(poll,3000));
})();
</script>
</body></html>`;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/* ---------- route utama ---------- */
export async function handleDashboard(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) return new Response('TELEGRAM_TOKEN belum diset.', { status: 500 });
  const uid = await verifyUser(getCookie(request, 'dash_user'), keyBytes);
  if (!uid) {
    const code = genCode();
    await saveCode(env, code);
    let un = 'kel_catatan_pengeluaran_bot';
    try {
      const r = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getMe`)).json();
      if (r.ok && r.result.username) un = r.result.username;
    } catch {}
    return loginPage(code, un);
  }
  const bulan = /^\d{4}-\d{2}$/.test(url.searchParams.get('bulan') || '')
    ? url.searchParams.get('bulan') : bulanWIB();
  const d = await getMonthData(env, uid, bulan);
  return html(url, bulan, uid, d);
}

export async function handleCheckLogin(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  const chatId = await takeCode(env, url.searchParams.get('code') || '');
  if (!chatId) return new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } });
  const cookie = await signUser(chatId, keyBytes);
  return new Response('{"ok":true}', {
    headers: { 'content-type': 'application/json', 'Set-Cookie': `dash_user=${cookie}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax` },
  });
}

export async function handleAdd(request, env) {
  const keyBytes = await secretKey(env);
  if (!keyBytes) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  const chatId = await verifyUser(getCookie(request, 'dash_user'), keyBytes);
  if (!chatId) return new Response('{"ok":false,"err":"auth"}', { status: 401, headers: { 'content-type': 'application/json' } });
  let b = {};
  try { b = await request.json(); } catch { return new Response('{"ok":false,"err":"bad"}', { status: 400, headers: { 'content-type': 'application/json' } }); }
  const nominal = parseInt(String(b.nominal || '').replace(/[^\d]/g, ''), 10);
  const tipe = b.tipe === 'masuk' ? 'masuk' : 'keluar';
  const kategori = String(b.kategori || '').trim().toLowerCase().slice(0, 40);
  if (!Number.isInteger(nominal) || nominal <= 0 || !kategori) {
    return new Response('{"ok":false,"err":"invalid"}', { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const tanggal = wibNow().toISOString().slice(0, 10);
  const catatan = String(b.catatan || '').trim().slice(0, 120);
  await env.DB.prepare('INSERT INTO pengeluaran (chat_id, tanggal, kategori, nominal, catatan, tipe) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(chatId, tanggal, kategori, nominal, catatan, tipe).run();
  return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
}

export async function handleLogout() {
  return new Response('', {
    status: 302,
    headers: { Location: '/dashboard', 'Set-Cookie': 'dash_user=; Path=/; Max-Age=0; HttpOnly' },
  });
}

/* ---------- data (semua nyata) ---------- */
async function getMonthData(env, chatId, bulan) {
  const [bal, mExp, mInc, budget, dayExp, dayInc, catL, recent, prev, maxTx] = await Promise.all([
    env.DB.prepare(
      "SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN nominal ELSE 0 END),0) AS inc, COALESCE(SUM(CASE WHEN tipe='keluar' THEN nominal ELSE 0 END),0) AS exp FROM pengeluaran WHERE chat_id = ?")
      .bind(chatId).first(),
    env.DB.prepare("SELECT COALESCE(SUM(nominal),0) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=?")
      .bind(chatId, bulan).first(),
    env.DB.prepare("SELECT COALESCE(SUM(nominal),0) AS total FROM pengeluaran WHERE chat_id=? AND tipe='masuk' AND substr(tanggal,1,7)=?")
      .bind(chatId, bulan).first(),
    env.DB.prepare('SELECT nominal FROM budget WHERE chat_id=? AND bulan=?').bind(chatId, bulan).first(),
    env.DB.prepare("SELECT tanggal, SUM(nominal) AS total FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=? GROUP BY tanggal ORDER BY tanggal")
      .bind(chatId, bulan).all(),
    env.DB.prepare("SELECT tanggal, SUM(nominal) AS total FROM pengeluaran WHERE chat_id=? AND tipe='masuk' AND substr(tanggal,1,7)=? GROUP BY tanggal ORDER BY tanggal")
      .bind(chatId, bulan).all(),
    env.DB.prepare("SELECT kategori, SUM(nominal) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=? GROUP BY kategori ORDER BY total DESC")
      .bind(chatId, bulan).all(),
    env.DB.prepare("SELECT id, tanggal, kategori, nominal, catatan, tipe FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7)=? ORDER BY id DESC LIMIT 60")
      .bind(chatId, bulan).all(),
    env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN nominal ELSE 0 END),0) AS inc, COALESCE(SUM(CASE WHEN tipe='keluar' THEN nominal ELSE 0 END),0) AS exp FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7)=?")
      .bind(chatId, prevBulan(bulan)).first(),
    env.DB.prepare("SELECT MAX(nominal) AS m FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=?")
      .bind(chatId, bulan).first(),
  ]);

  const expenseTotal = Number(mExp ? mExp.total : 0);
  const incomeTotal = Number(mInc ? mInc.total : 0);
  const balance = Number(bal ? bal.inc - bal.exp : 0);
  const budgetNom = budget ? Number(budget.nominal) : null;
  const remainBudget = budgetNom !== null ? budgetNom - expenseTotal : null;

  const dayExpArr = (dayExp.results || []).map((r) => ({ d: r.tanggal, v: Number(r.total) }));
  const dayIncArr = (dayInc.results || []).map((r) => ({ d: r.tanggal, v: Number(r.total) }));
  const catArr = (catL.results || []).map((r) => ({ k: r.kategori, v: Number(r.total), n: Number(r.n) }));
  const tx = (recent.results || []).map((r) => ({
    id: r.id, t: r.tanggal, k: r.kategori, v: Number(r.nominal), c: r.catatan || '', tp: r.tipe,
  }));
  const prevExp = Number(prev ? prev.exp : 0);
  const prevInc = Number(prev ? prev.inc : 0);

  // analytics
  const days = dayExpArr.length;
  const avgDaily = days ? Math.round(expenseTotal / days) : 0;
  let maxDay = null;
  for (const d of dayExpArr) if (!maxDay || d.v > maxDay.v) maxDay = d;
  const topCat = catArr[0] || null;
  let maxTxRow = null;
  for (const x of tx) if (x.tp === 'keluar' && (!maxTxRow || x.v > maxTxRow.v)) maxTxRow = x;
  const isCur = bulan === bulanWIB();
  const dim = daysInMonth(bulan);
  const dayNow = wibNow().getUTCDate();
  const estEnd = isCur ? Math.round((expenseTotal / Math.max(1, dayNow)) * dim) : null;
  const expDelta = prevExp > 0 ? Math.round(((expenseTotal - prevExp) / prevExp) * 100) : null;
  const incDelta = prevInc > 0 ? Math.round(((incomeTotal - prevInc) / prevInc) * 100) : null;

  return {
    balance, incomeTotal, expenseTotal, expenseCount: Number(mExp ? mExp.n : 0),
    budgetNom, remainBudget, dayExpArr, dayIncArr, catArr, tx,
    prevExp, prevInc, avgDaily, maxDay, topCat, maxTxRow, estEnd, expDelta, incDelta, dim,
  };
}

/* ---------- template ---------- */
const COLORS = ['#A020F0', '#7B2FF7', '#F87171', '#22C55E', '#F59E0B', '#38BDF8',
  '#EC4899', '#8B5CF6', '#FACC15', '#2DD4BF', '#FB923C', '#A78BFA'];

const LAYOUT = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Pengeluaran</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
 :root{--bg:#0C0B12;--card:#181622;--elev:#211E2D;--line:rgba(255,255,255,.07);--pline:rgba(160,32,240,.25);
  --tx:#F5F3FA;--mut:#9B96AA;--p:#A020F0;--p2:#7B2FF7;--inc:#22C55E;--exp:#F87171}
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 520px at 75% -12%, rgba(160,32,240,.14), transparent 60%), var(--bg);color:var(--tx)}
 .wrap{max-width:1100px;margin:0 auto;padding:26px 18px 80px}
 header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:8px}
 .head-l{min-width:0}
 h1{font-size:21px;margin:0;font-weight:700}
 .sub{color:var(--mut);font-size:13px;margin-top:3px}
 .actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .btn{background:var(--card);border:1px solid var(--line);color:var(--tx);padding:9px 14px;border-radius:12px;
  text-decoration:none;font-size:13.5px;font-weight:600;cursor:pointer;transition:.15s}
 .btn:hover{border-color:var(--p);color:#fff}
 .btn.primary{background:linear-gradient(135deg,var(--p),var(--p2));border:0;color:#fff;box-shadow:0 8px 24px rgba(160,32,240,.3)}
 .month{display:flex;align-items:center;gap:8px}
 .month span{min-width:128px;text-align:center;font-weight:700}
 .logout{color:var(--mut);font-size:13px;text-decoration:none}
 .logout:hover{color:var(--exp)}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:18px 0}
 .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;position:relative;overflow:hidden}
 .card .lbl{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}
 .card .val{font-size:24px;font-weight:800;margin-top:8px;letter-spacing:.3px}
 .card .val.inc{color:var(--inc)} .card .val.exp{color:var(--exp)} .card .val.p{color:var(--p)}
 .card .sub2{color:var(--mut);font-size:12.5px;margin-top:5px}
 .card .sub2 .up{color:var(--inc)} .card .sub2 .dn{color:var(--exp)}
 .grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
 .grid1{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
 @media (max-width:820px){.grid2,.grid1{grid-template-columns:1fr}}
 .panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:14px}
 .panel h2{font-size:12.5px;margin:0 0 14px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
 .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}
 .stat{background:var(--elev);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
 .stat .lbl{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.6px}
 .stat .val{font-size:16px;font-weight:700;margin-top:4px}
 .bud .bar{height:12px;background:var(--elev);border-radius:8px;overflow:hidden;margin:12px 0 8px;border:1px solid var(--line)}
 .bud .bar div{height:100%;background:linear-gradient(90deg,var(--p),var(--p2));border-radius:8px}
 .budrow{display:flex;justify-content:space-between;font-size:13px;color:var(--mut)}
 .cat{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
 .cat:last-child{border-bottom:0}
 .dot{width:10px;height:10px;border-radius:3px;flex:none}
 .cat .nm{flex:1} .cat .amt{font-weight:700} .cat .pct{color:var(--mut);font-size:12px;width:44px;text-align:right}
 .insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
 .ins{background:var(--elev);border:1px solid var(--line);border-radius:14px;padding:13px 14px}
 .ins .lbl{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.6px}
 .ins .val{font-size:15.5px;font-weight:700;margin-top:4px;color:var(--tx)}
 .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
 .inp{background:var(--elev);border:1px solid var(--line);color:var(--tx);border-radius:12px;padding:9px 12px;
  font-size:13.5px;color-scheme:dark}
 .filters .inp[type=text]{flex:1;min-width:160px}
 table{width:100%;border-collapse:collapse;font-size:13.5px}
 th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.8px}
 td.amt{text-align:right;font-weight:700}
 td.amt.inc{color:var(--inc)} td.amt.exp{color:var(--tx)}
 .chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700}
 .chip.k{background:rgba(160,32,240,.15);color:#c9a0f5}
 .chip.i{background:rgba(34,197,94,.14);color:var(--inc)}
 .empty{color:var(--mut);text-align:center;padding:20px;font-size:13.5px}
 .mut{color:var(--mut);font-size:13px}
 /* modal */
 .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:50;padding:16px}
 .ov.open{display:flex}
 .modal{background:var(--card);border:1px solid var(--pline);border-radius:20px;padding:24px;width:100%;max-width:400px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
 .modal h3{margin:0 0 16px;font-size:17px}
 .field{margin-bottom:12px}
 .field label{display:block;font-size:12px;color:var(--mut);margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}
 .row{display:flex;gap:10px}
 .row .field{flex:1}
 .seg{display:flex;background:var(--elev);border-radius:12px;padding:4px;gap:4px}
 .seg button{flex:1;border:0;background:transparent;color:var(--mut);padding:8px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer}
 .seg button.on{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff}
 .cbtn{width:100%;margin-top:6px}
 select.inp{width:100%}
 textarea.inp{width:100%;resize:vertical;font-family:inherit}
</style></head><body>
<div class="wrap">

<header>
  <div class="head-l"><h1>{GREET}</h1><div class="sub">{DATE} · {SUB}</div></div>
  <div class="actions">
    <div class="month">
      <a class="btn" href="?bulan={PREV}">←</a><span>{BULAN}</span><a class="btn" href="?bulan={NEXT}">→</a>
    </div>
    <button class="btn primary" onclick="openAdd()">＋ Tambah</button>
    <a class="logout" href="/logout">Keluar</a>
  </div>
</header>

<div class="cards">
  <div class="card"><div class="lbl">Saldo saat ini</div><div class="val {BALANCE_CLS}">{BALANCE}</div><div class="sub2">masuk − keluar (semua waktu)</div></div>
  <div class="card"><div class="lbl">Pemasukan bulan ini</div><div class="val inc">{INCOME}</div><div class="sub2">{INCOME_DELTA}</div></div>
  <div class="card"><div class="lbl">Pengeluaran bulan ini</div><div class="val exp">{EXPENSE}</div><div class="sub2">{EXPENSE_COUNT} transaksi · {EXPENSE_DELTA}</div></div>
  <div class="card"><div class="lbl">Sisa budget</div><div class="val {REMAIN_CLS}">{REMAIN}</div><div class="sub2">target {BUDGET_TARGET}</div></div>
</div>

<div class="grid2">
  <div class="panel">
    <h2>Analisa Pengeluaran · {BULAN}</h2>
    <canvas id="daily" height="120"></canvas>
    <div class="stats">
      <div class="stat"><div class="lbl">Rata-rata harian</div><div class="val">{AVG_DAILY}</div></div>
      <div class="stat"><div class="lbl">Hari terbesar</div><div class="val">{MAX_DAY_VAL}</div><div class="mut">{MAX_DAY_LBL}</div></div>
      <div class="stat"><div class="lbl">vs bulan lalu</div><div class="val">{EXP_ΔTA}</div><div class="mut">pengeluaran</div></div>
      <div class="stat"><div class="lbl">Proyeksi akhir bulan</div><div class="val">{EST_END}</div></div>
    </div>
  </div>

  <div class="panel">
    <h2>Kategori Pengeluaran</h2>
    <canvas id="cat" height="150"></canvas>
    <div style="margin-top:12px">{CATLIST}</div>
  </div>
</div>

<div class="grid1">
  <div class="panel bud">
    <h2>Budget Bulanan</h2>
    {BUDGET_BODY}
  </div>
  <div class="panel">
    <h2>Insight Pribadi</h2>
    <div class="insights">{INSIGHTS}</div>
  </div>
</div>

<div class="panel">
  <h2>Transaksi Terbaru · {BULAN}</h2>
  <div class="filters">
    <input class="inp" type="text" id="fq" placeholder="Cari kategori / catatan…">
    <select class="inp" id="fc"><option value="">Semua kategori</option>{CATOPTIONS}</select>
    <select class="inp" id="ft"><option value="">Semua jenis</option><option value="keluar">Keluar</option><option value="masuk">Masuk</option></select>
    <input class="inp" type="date" id="fd1"><input class="inp" type="date" id="fd2">
  </div>
  <table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Catatan</th><th style="text-align:right">Nominal</th></tr></thead><tbody id="txbody"></tbody></table>
  <div class="empty" id="txempty">Tidak ada transaksi bulan ini.</div>
</div>

</div>

<div class="ov" id="ov">
  <div class="modal">
    <h3>Tambah transaksi</h3>
    <div class="seg" id="seg">
      <button type="button" data-tp="keluar" class="on">Keluar</button>
      <button type="button" data-tp="masuk">Masuk</button>
    </div>
    <div class="field" style="margin-top:12px"><label>Nominal (Rp)</label><input class="inp" type="number" id="qNom" min="1" placeholder="50000" style="width:100%"></div>
    <div class="row">
      <div class="field"><label>Kategori</label><input class="inp" id="qKat" list="cats" placeholder="makan" style="width:100%"></div>
    </div>
    <datalist id="cats">{CATS}</datalist>
    <div class="field"><label>Catatan (opsional)</label><input class="inp" id="qCat" placeholder="nasi padang" style="width:100%"></div>
    <button class="btn primary cbtn" id="qSave">Simpan</button>
    <button class="btn cbtn" style="margin-top:8px" onclick="closeAdd()">Batal</button>
  </div>
</div>

<script>
const TX = {TXJSON};
const CATS = {CATJSON};
const COL = {COLORSJSON};
const TOMORROW = {TOMORROW};
const T0 = {T0};

// chart harian: batang pengeluaran + garis pemasukan
const DAILY = [DAILYJSON];
const INC = [INCOMEJSON];
const mergeD = [...new Set([...DAILY.map(x=>x.d), ...INC.map(x=>x.d)])].sort();
new Chart(document.getElementById('daily'), {
  data:{ labels: mergeD.map(d=>d.slice(5)),
    datasets:[
      { type:'bar', label:'Keluar', data: mergeD.map(d=>(DAILY.find(x=>x.d===d)||{}).v||0), backgroundColor:'#F87171', borderRadius:6, barPercentage:0.6 },
      { type:'line', label:'Masuk', data: mergeD.map(d=>(INC.find(x=>x.d===d)||{}).v||0), borderColor:'#22C55E', backgroundColor:'#22C55E', tension:.35, pointRadius:3 }
    ]},
  options:{ plugins:{legend:{labels:{color:'#9B96AA',boxWidth:10,font:{size:12}}}}, scales:{
    x:{ticks:{color:'#9B96AA',maxRotation:0},grid:{display:false}},
    y:{beginAtZero:true,ticks:{color:'#9B96AA'},grid:{color:'rgba(255,255,255,.05)'}} }}
});
new Chart(document.getElementById('cat'), {
  type:'doughnut',
  data:{ labels:CATS.map(c=>c.k), datasets:[{ data:CATS.map(c=>c.v), backgroundColor:COL.slice(0,CATS.length), borderColor:'#181622', borderWidth:2 }]},
  options:{ plugins:{ legend:{ position:'bottom', labels:{color:'#9B96AA',boxWidth:10,font:{size:12}} } }}
});

// filter transaksi
let selected={q:'',c:'',t:'',d1:'',d2:''};
function escH(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtRp(n){return 'Rp '+Number(n).toLocaleString('id-ID');}
function renderTx(){
  const list=TX.filter(t=>{
    if(selected.q && !(t.k+' '+t.c).toLowerCase().includes(selected.q)) return false;
    if(selected.c && t.k!==selected.c) return false;
    if(selected.t && t.tp!==selected.t) return false;
    if(selected.d1 && t.t<selected.d1) return false;
    if(selected.d2 && t.t>selected.d2) return false;
    return true;
  });
  const body=document.getElementById('txbody');
  body.innerHTML=list.map(t=>{
    const chip = t.tp==='masuk' ? '<span class="chip i">Masuk</span>' : '<span class="chip k">Keluar</span>';
    const cls = t.tp==='masuk' ? 'amt inc' : 'amt';
    return '<tr><td class="mut">'+escH(t.t.slice(5).replace('-','/'))+'</td><td>'+chip+'</td><td>'+escH(t.k)+'</td><td class="mut">'+escH(t.c)+'</td><td class="'+cls+'">'+fmtRp(t.v)+'</td></tr>';
  }).join('');
  document.getElementById('txempty').style.display = list.length ? 'none' : 'block';
}
document.getElementById('fq').oninput=e=>{selected.q=e.target.value.toLowerCase();renderTx();};
document.getElementById('fc').onchange=e=>{selected.c=e.target.value;renderTx();};
document.getElementById('ft').onchange=e=>{selected.t=e.target.value;renderTx();};
document.getElementById('fd1').onchange=e=>{selected.d1=e.target.value;renderTx();};
document.getElementById('fd2').onchange=e=>{selected.d2=e.target.value;renderTx();};
renderTx();

// quick add
let qType='keluar';
document.getElementById('seg').querySelectorAll('button').forEach(b=>{
  b.onclick=()=>{ qType=b.dataset.tp; document.querySelectorAll('#seg button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); };
});
function openAdd(){document.getElementById('ov').classList.add('open');}
function closeAdd(){document.getElementById('ov').classList.remove('open');}
document.getElementById('qSave').onclick=async()=>{
  const nominal=document.getElementById('qNom').value.trim();
  const kategori=document.getElementById('qKat').value.trim();
  const catatan=document.getElementById('qCat').value.trim();
  if(!nominal || !kategori){ alert('Isi nominal dan kategori'); return; }
  const r=await fetch('/api/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tipe:qType,nominal,kategori,catatan})});
  const j=await r.json();
  if(j.ok) location.reload(); else alert('Gagal menyimpan.');
};
window.openAdd=openAdd; window.closeAdd=closeAdd;
</script>
</body></html>`;

/* ---------- render ---------- */
function html(url, bulan, chatId, d) {
  const prev = prevBulan(bulan), next = nextBulan(bulan);
  const rp = (n) => 'Rp ' + nf(n);

  const balCls = d.balance >= 0 ? 'inc' : 'exp';
  const remainCls = d.remainBudget === null ? 'p' : (d.remainBudget >= 0 ? 'inc' : 'exp');

  const incDelta = d.incDelta === null ? '' : (d.incDelta >= 0 ? `<span class="up">▲ ${d.incDelta}%</span>` : `<span class="dn">▼ ${Math.abs(d.incDelta)}%</span>`);
  const expDelta = d.expDelta === null ? '' : (d.expDelta >= 0 ? `<span class="dn">▲ ${d.expDelta}%</span>` : `<span class="up">▼ ${Math.abs(d.expDelta)}%</span>`);

  const maxDayVal = d.maxDay ? rp(d.maxDay.v) : '—';
  const maxDayLbl = d.maxDay ? d.maxDay.d.slice(5).replace('-', '/') : 'belum ada data';
  const estEnd = d.estEnd === null ? (bulan === bulanWIB() ? '—' : '—') : rp(d.estEnd);

  // budget body
  let budgetBody;
  if (d.budgetNom === null) {
    budgetBody = `<div class="mut">Belum nyet budget bulan ini. Ketik <b>/budget &lt;nominal&gt;</b> di bot.</div>`;
  } else {
    const pct = Math.min(100, Math.round((d.expenseTotal / d.budgetNom) * 100));
    const remainTxt = d.remainBudget >= 0 ? `Sisa ${rp(d.remainBudget)}` : `Lebih ${rp(-d.remainBudget)}`;
    budgetBody = `<div class="budrow"><span>Target</span><b>${rp(d.budgetNom)}</b></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="budrow"><span>Terpakai ${rp(d.expenseTotal)}</span><span>${pct}%</span></div>
      <div class="budrow"><span style="color:${d.remainBudget>=0?'var(--inc)':'var(--exp)'}">${remainTxt}</span></div>`;
  }

  // categ list
  let catList = '';
  const catCol = COLORS.slice(0, d.catArr.length);
  d.catArr.forEach((c, i) => {
    const p = Math.round((c.v / (d.expenseTotal || 1)) * 100);
    catList += `<div class="cat"><span class="dot" style="background:${catCol[i]}"></span>
      <span class="nm">${esc(c.k)}</span><span class="amt">${rp(c.v)}</span>
      <span class="pct">${p}%</span></div>`;
  });
  if (!catList) catList = `<div class="mut">Belum ada pengeluaran bulan ini.</div>`;

  // insights
  let ins = '';
  ins += `<div class="ins"><div class="lbl">Kategori terbesar</div><div class="val">${d.topCat ? esc(d.topCat.k) : '—'}</div></div>`;
  ins += `<div class="ins"><div class="lbl">vs bulan lalu</div><div class="val">${d.expDelta === null ? '—' : d.expDelta >= 0 ? '▲ ' + d.expDelta + '%' : '▼ ' + Math.abs(d.expDelta) + '%'}</div></div>`;
  ins += `<div class="ins"><div class="lbl">Rata-rata harian</div><div class="val">${rp(d.avgDaily)}</div></div>`;
  ins += `<div class="ins"><div class="lbl">Transaksi terbesar</div><div class="val">${d.maxTxRow ? rp(d.maxTxRow.v) : '—'}</div><div class="mut">${d.maxTxRow ? esc(d.maxTxRow.k) : ''}</div></div>`;
  ins += `<div class="ins"><div class="lbl">Proyeksi akhir bulan</div><div class="val">${estEnd}</div></div>`;

  // tx / categories for select/datalist
  const catOptions = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');
  const catS = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');
  const t0 = bulan + '-01';
  const tomorrow = '2099-12-31';

  return new Response(LAYOUT
    .split('{GREET}').join(esc(greetingWIB()))
    .split('{DATE}').join(esc(todayLabelWIB()))
    .split('{SUB}').join(esc(`chat ${chatId}`))
    .split('{BULAN}').join(esc(fmtBulan(bulan)))
    .split('{PREV}').join(prev)
    .split('{NEXT}').join(next)
    .split('{BALANCE}').join(rp(d.balance))
    .split('{BALANCE_CLS}').join(balCls)
    .split('{INCOME}').join(rp(d.incomeTotal))
    .split('{INCOME_DELTA}').join(incDelta)
    .split('{EXPENSE}').join(rp(d.expenseTotal))
    .split('{EXPENSE_COUNT}').join(String(d.expenseCount))
    .split('{EXPENSE_DELTA}').join(expDelta)
    .split('{REMAIN}').join(d.remainBudget === null ? '—' : rp(d.remainBudget))
    .split('{REMAIN_CLS}').join(remainCls)
    .split('{BUDGET_TARGET}').join(d.budgetNom === null ? 'belum diset' : rp(d.budgetNom))
    .split('{AVG_DAILY}').join(rp(d.avgDaily))
    .split('{MAX_DAY_VAL}').join(maxDayVal)
    .split('{MAX_DAY_LBL}').join(esc(maxDayLbl))
    .split('{EXP_ΔTA}').join(d.expDelta === null ? '—' : (d.expDelta >= 0 ? '▲ ' + d.expDelta + '%' : '▼ ' + Math.abs(d.expDelta) + '%'))
    .split('{EST_END}').join(estEnd)
    .split('{CATLIST}').join(catList)
    .split('{INSIGHTS}').join(ins)
    .split('{BUDGET_BODY}').join(budgetBody)
    .split('{CATOPTIONS}').join(catOptions)
    .split('{CATS}').join(catS)
    .split('{TXJSON}').join(JSON.stringify(d.tx))
    .split('{CATJSON}').join(JSON.stringify(d.catArr.map((c) => ({ k: c.k, v: c.v }))))
    .split('{COLORSJSON}').join(JSON.stringify(catCol))
    .split('{DAILYJSON}').join(JSON.stringify(d.dayExpArr))
    .split('{INCOMEJSON}').join(JSON.stringify(d.dayIncArr))
    .split('{T0}').join(t0)
    .split('{TOMORROW}').join(tomorrow),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function prevBulan(b) {
  const [y, m] = b.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function nextBulan(b) {
  const [y, m] = b.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
