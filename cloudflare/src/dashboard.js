// Dashboard personal expense tracker — dark fintech, layout sidebar multi-view.
// Data 100% dari D1 (pengeluaran / budget). Auth Telegram deep-link kode.
// View: Dashboard, Transaksi (filter+edit+delete+CSV), Kategori, Budget, Settings.
// Halaman terpisah: ?view=tahun (rekap tahunan).

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BLN_PDK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n).toLocaleString('id-ID');
const bufToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function wibNow() { return new Date(Date.now() + 7 * 3600 * 1000); }
function monthWIB() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }
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
function yearWIB() { return wibNow().getUTCFullYear(); }
function prevYear(y) { return y - 1; }
function nextYear(y) { return y + 1; }
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

/* ---------- kriptografi (Web Crypto) ---------- */
async function digestBytes(text) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); }
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
 h1{font-size:21px;margin:0 0 6px} p{color:var(--mut);font-size:13.5px;margin:0 0 26px;line-height:1.6}
 .big{display:inline-block;background:linear-gradient(135deg,#A020F0,#7B2FF7);color:#fff;font-weight:800;
 padding:14px 26px;border-radius:14px;text-decoration:none;font-size:15px;box-shadow:0 10px 30px rgba(160,32,240,.35)}
 .big:hover{filter:brightness(1.08)}
 .status{margin-top:18px;color:var(--mut);font-size:13px}
 .big2{margin-top:16px;background:transparent;border:1px solid rgba(160,32,240,.4);color:var(--tx);
 padding:11px;border-radius:12px;font-size:13.5px;font-weight:700;cursor:pointer;width:100%}
 .big2:hover{border-color:var(--p)}
 .ok{color:#22C55E;font-weight:700}
</style></head><body>
<div class="card"><h1>🔒 Catatan Pengeluaran</h1>
<p>Klik tombol di bawah, buka di Telegram, lalu tekan <b>Start</b>. Setelah itu kembali ke halaman ini.</p>
<a class="big" href="${link}" target="_blank">Masuk dengan Telegram</a>
<div class="status" id="st">Menunggu kamu menekan Start di Telegram…</div>
<button class="big2" onclick="tryLogin()">✓ Saya sudah tekan Start</button>
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
function tryLogin(){
  fetch('/api/login/check?code='+CODE,{credentials:'same-origin'})
    .then(r=>r.json()).then(j=>{
      if(j.ok){ location.href='/dashboard'; }
      else { document.getElementById('st').textContent='Belum terdeteksi. Pastikan sudah tekan Start di Telegram, lalu coba lagi.'; }
    }).catch(()=>document.getElementById('st').textContent='Gagal hubungi server.');
}
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
  let tahun = parseInt(url.searchParams.get('tahun'), 10);
  if (!tahun || tahun < 2000 || tahun > 2100) tahun = yearWIB();
  const [d, yd] = await Promise.all([
    getMonthData(env, uid, bulan),
    getYearData(env, uid, String(tahun)),
  ]);
  if (url.searchParams.get('view') === 'tahun') {
    return renderYear(url, uid, String(tahun), yd);
  }
  const nrow = await env.DB.prepare('SELECT nama FROM pengguna WHERE chat_id=?').bind(uid).first();
  const uname = nrow && nrow.nama ? String(nrow.nama) : String(uid);
  return html(url, bulan, uid, d, uname);
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

async function authUser(request, env) {
  const keyBytes = await secretKey(env);
  if (!keyBytes) return { err: 500 };
  const chatId = await verifyUser(getCookie(request, 'dash_user'), keyBytes);
  if (!chatId) return { err: 401 };
  return { chatId };
}
const jsonErr = (st, e) => new Response(JSON.stringify({ ok: false, err: e }), { status: st, headers: { 'content-type': 'application/json' } });
const jsonOk = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { headers: { 'content-type': 'application/json' } });

export async function handleLogout() {
  return new Response('', {
    status: 302,
    headers: { Location: '/dashboard', 'Set-Cookie': 'dash_user=; Path=/; Max-Age=0; HttpOnly' },
  });
}

/* ---------- data (semua nyata) ---------- */
async function getMonthData(env, chatId, bulan) {
  const prev = prevBulan(bulan);
  const [bal, mExp, mInc, budget, dayExp, dayInc, catL, catPrev, recent, prevM, maxTx, today, txc] = await Promise.all([
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
    env.DB.prepare("SELECT kategori, SUM(nominal) AS total FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=? GROUP BY kategori")
      .bind(chatId, prev).all(),
    env.DB.prepare("SELECT id, tanggal, kategori, nominal, catatan, tipe FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7)=? ORDER BY id DESC LIMIT 300")
      .bind(chatId, bulan).all(),
    env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN nominal ELSE 0 END),0) AS inc, COALESCE(SUM(CASE WHEN tipe='keluar' THEN nominal ELSE 0 END),0) AS exp FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7)=?")
      .bind(chatId, prev).first(),
    env.DB.prepare("SELECT MAX(nominal) AS m FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND substr(tanggal,1,7)=?")
      .bind(chatId, bulan).first(),
    env.DB.prepare("SELECT COALESCE(SUM(nominal),0) AS total FROM pengeluaran WHERE chat_id=? AND tipe='keluar' AND tanggal=?")
      .bind(chatId, monthWIB()).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7)=?")
      .bind(chatId, bulan).first(),
  ]);

  const expenseTotal = Number(mExp ? mExp.total : 0);
  const incomeTotal = Number(mInc ? mInc.total : 0);
  const todayExp = Number(today ? today.total : 0);
  const txCount = Number(txc ? txc.n : 0);
  const balance = Number(bal ? bal.inc - bal.exp : 0);
  const budgetNom = budget ? Number(budget.nominal) : null;
  const remainBudget = budgetNom !== null ? budgetNom - expenseTotal : null;

  const dayExpArr = (dayExp.results || []).map((r) => ({ d: r.tanggal, v: Number(r.total) }));
  const dayIncArr = (dayInc.results || []).map((r) => ({ d: r.tanggal, v: Number(r.total) }));
  const catArr = (catL.results || []).map((r) => ({ k: r.kategori, v: Number(r.total), n: Number(r.n) }));
  const catPrevMap = {};
  (catPrev.results || []).forEach((r) => { catPrevMap[r.kategori] = Number(r.total); });
  const tx = (recent.results || []).map((r) => ({
    id: r.id, t: r.tanggal, k: r.kategori, v: Number(r.nominal), c: r.catatan || '', tp: r.tipe,
  }));
  const prevExp = Number(prevM ? prevM.exp : 0);
  const prevInc = Number(prevM ? prevM.inc : 0);

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
    balance, incomeTotal, expenseTotal, expenseCount: Number(mExp ? mExp.n : 0), todayExp, txCount,
    budgetNom, remainBudget, dayExpArr, dayIncArr, catArr, catPrevMap, tx,
    prevExp, prevInc, avgDaily, maxDay, topCat, maxTxRow, estEnd, expDelta, incDelta, dim,
  };
}

async function getYearData(env, chatId, year) {
  const like = year + '-%';
  const rows = await env.DB.prepare(
    "SELECT substr(tanggal,1,7) AS bln, COALESCE(SUM(CASE WHEN tipe='masuk' THEN nominal ELSE 0 END),0) AS inc, COALESCE(SUM(CASE WHEN tipe='keluar' THEN nominal ELSE 0 END),0) AS exp FROM pengeluaran WHERE chat_id=? AND substr(tanggal,1,7) LIKE ? GROUP BY bln ORDER BY bln")
    .bind(chatId, like).all();
  const map = {};
  (rows.results || []).forEach((r) => { map[r.bln] = { inc: Number(r.inc), exp: Number(r.exp) }; });
  const months = [];
  let totInc = 0, totExp = 0;
  for (let i = 0; i < 12; i++) {
    const bln = `${year}-${String(i + 1).padStart(2, '0')}`;
    const m = map[bln] || { inc: 0, exp: 0 };
    totInc += m.inc; totExp += m.exp;
    months.push({ label: BLN_PDK[i], bln, inc: m.inc, exp: m.exp });
  }
  return { months, totInc, totExp, year };
}

/* ---------- halaman rekap tahunan (terpisah) ---------- */
const YEAR_PAGE = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rekap Tahunan · {YEAR}</title>
<style>
 :root{--bg:#0C0B12;--card:#181622;--line:rgba(255,255,255,.07);--tx:#F5F3FA;--mut:#9B96AA;--exp:#F87171;--inc:#22C55E}
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 520px at 75% -12%, rgba(160,32,240,.14), transparent 60%), var(--bg);color:var(--tx)}
 .wrap{max-width:1100px;margin:0 auto;padding:26px 18px 80px}
 header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px}
 h1{font-size:21px;margin:0} .sub{color:var(--mut);font-size:13px;margin-top:3px}
 .actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .btn{background:var(--card);border:1px solid var(--line);color:var(--tx);padding:9px 14px;border-radius:12px;text-decoration:none;font-size:13.5px;font-weight:600}
 .btn:hover{border-color:#A020F0;color:#fff}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:18px 0}
 .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
 .card .lbl{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}
 .card .val{font-size:23px;font-weight:800;margin-top:8px}
 .card .val.exp{color:var(--exp)} .card .val.inc{color:var(--inc)}
 .mo{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
 .m{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}
 .m .nm{font-weight:700;font-size:14px}
 .m .amt{font-size:20px;font-weight:800;margin-top:6px;color:var(--exp)}
 .m .small{color:var(--mut);font-size:12px;margin-top:3px}
 .m.top{border-color:#A020F0;box-shadow:0 0 0 1px rgba(160,32,240,.25)}
 .mut{color:var(--mut);font-size:13px}
</style></head><body>
<div class="wrap">
<header>
  <div><h1>📅 Rekap Tahunan</h1><div class="sub">Detail pengeluaran per bulan · {YEAR}</div></div>
  <div class="actions">
    <a class="btn" href="?view=tahun&tahun={YPREV}">← {YPREV}</a>
    <span style="font-weight:700">{YEAR}</span>
    <a class="btn" href="?view=tahun&tahun={YNEXT}">{YNEXT} →</a>
    <a class="btn" href="/dashboard">← Dashboard</a>
  </div>
</header>
<div class="cards">
  <div class="card"><div class="lbl">Total pengeluaran</div><div class="val exp">{YTOTEXP}</div></div>
  <div class="card"><div class="lbl">Total pemasukan</div><div class="val inc">{YTOTINC}</div></div>
  <div class="card"><div class="lbl">Rata2 / bulan</div><div class="val exp">{YAVG}</div></div>
  <div class="card"><div class="lbl">Bulan tertinggi</div><div class="val exp">{YMAX}</div><div class="mut">{YMAXLBL}</div></div>
</div>
<div class="mo">{MONTHS}</div>
</div>
</body></html>`;

function renderYear(url, chatId, tahun, yd) {
  const prev = String(prevYear(Number(tahun)));
  const next = String(nextYear(Number(tahun)));
  let maxM = null;
  yd.months.forEach((m) => { if (!maxM || m.exp > maxM.exp) maxM = m; });
  const monthsHtml = yd.months.map((m) => {
    const net = m.inc - m.exp;
    const top = maxM && maxM.bln === m.bln ? ' top' : '';
    return `<div class="m${top}"><div class="nm">${esc(m.label)} ${tahun}</div>` +
      `<div class="amt">Rp ${nf(m.exp)}</div>` +
      `<div class="small">masuk Rp ${nf(m.inc)} · net Rp ${nf(net)}</div></div>`;
  }).join('');
  return new Response(YEAR_PAGE
    .split('{YEAR}').join(esc(tahun))
    .split('{YPREV}').join(prev)
    .split('{YNEXT}').join(next)
    .split('{YTOTEXP}').join('Rp ' + nf(yd.totExp))
    .split('{YTOTINC}').join('Rp ' + nf(yd.totInc))
    .split('{YAVG}').join('Rp ' + nf(Math.round(yd.totExp / 12)))
    .split('{YMAX}').join(maxM ? 'Rp ' + nf(maxM.exp) : '—')
    .split('{YMAXLBL}').join(maxM ? esc(maxM.label) + ' ' + tahun : '')
    .split('{MONTHS}').join(monthsHtml),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/* ============================================================
   SPA: layout sidebar + view (Dashboard / Transaksi / Kategori /
   Budget / Settings).
   ============================================================ */
const COLORS = ['#A020F0', '#7B2FF7', '#F87171', '#22C55E', '#F59E0B', '#38BDF8',
  '#EC4899', '#8B5CF6', '#FACC15', '#2DD4BF', '#FB923C', '#A78BFA'];

const LAYOUT = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Pengeluaran</title>
<style>
 :root{--bg:#0C0B12;--card:#181622;--elev:#211E2D;--line:rgba(255,255,255,.07);--pline:rgba(160,32,240,.25);
  --tx:#F5F3FA;--mut:#9B96AA;--p:#A020F0;--p2:#7B2FF7;--inc:#22C55E;--exp:#F87171}
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 520px at 75% -12%, rgba(160,32,240,.14), transparent 60%), var(--bg);color:var(--tx);height:100vh;overflow:hidden}
 .app{display:flex;height:100vh}
 .side{width:216px;flex:none;background:var(--card);border-right:1px solid var(--line);padding:20px 12px;display:flex;flex-direction:column;overflow-y:auto}
 .brand{font-weight:800;font-size:15px;padding:2px 10px 16px;letter-spacing:.3px}
 .brand span{background:linear-gradient(135deg,var(--p),var(--p2));-webkit-background-clip:text;background-clip:text;color:transparent}
 .nv{display:block;width:100%;text-align:left;background:transparent;border:0;color:var(--mut);font-weight:600;
  font-size:13.5px;padding:10px 12px;border-radius:10px;cursor:pointer;text-decoration:none;margin-bottom:2px;font-family:inherit}
 .nv:hover{background:var(--elev);color:var(--tx)}
 .nv.active{background:linear-gradient(135deg,rgba(160,32,240,.18),rgba(123,47,247,.10));color:#fff}
 .side-foot{margin-top:auto;padding:12px 10px 0;font-size:11.5px;color:var(--mut);border-top:1px solid var(--line)}
 .main{flex:1;overflow-y:auto;padding:24px 26px 80px}
 .view{display:none} .view.active{display:block}
 .hdr{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px}
 h1{font-size:20px;margin:0;font-weight:800}
 .sub{color:var(--mut);font-size:13px;margin-top:3px}
 .actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .btn{background:var(--card);border:1px solid var(--line);color:var(--tx);padding:9px 14px;border-radius:12px;
  text-decoration:none;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}
 .btn:hover{border-color:var(--p);color:#fff}
 .btn.primary{background:linear-gradient(135deg,var(--p),var(--p2));border:0;color:#fff;box-shadow:0 8px 24px rgba(160,32,240,.3)}
 .btn.danger{color:var(--exp);border-color:rgba(248,113,113,.3)}
 .btn.small{padding:5px 10px;font-size:12px;border-radius:9px}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:16px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;position:relative;overflow:hidden}
 .card .lbl{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}
 .card .val{font-size:24px;font-weight:800;margin-top:8px;letter-spacing:.3px}
 .val.inc{color:var(--inc)} .val.exp{color:var(--exp)} .val.p{color:var(--p)}
 .card .sub2{color:var(--mut);font-size:12.5px;margin-top:5px}
 .up{color:var(--inc)} .dn{color:var(--exp)}
 .grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
 @media (max-width:860px){.side{display:none}.grid2{grid-template-columns:1fr}}
 .panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:14px}
 .panel h2{font-size:12.5px;margin:0 0 14px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
 .seg{display:flex;background:var(--elev);border-radius:11px;padding:3px;gap:3px;margin-bottom:12px;width:max-content}
 .seg button{border:0;background:transparent;color:var(--mut);padding:7px 14px;border-radius:9px;font-weight:700;font-size:12.5px;cursor:pointer}
 .seg button.on{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff}
 .chartbox{position:relative;height:230px}
 .cat{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
 .cat:last-child{border-bottom:0}
 .dot{width:10px;height:10px;border-radius:3px;flex:none}
 .cat .nm{flex:1;font-weight:600} .cat .amt{font-weight:700} .cat .pct{color:var(--mut);font-size:12px;width:42px;text-align:right}
 .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
 .inp{background:var(--elev);border:1px solid var(--line);color:var(--tx);border-radius:12px;padding:9px 12px;
  font-size:13.5px;color-scheme:dark;font-family:inherit}
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
 .hidden{display:none}
 .mut{color:var(--mut);font-size:13px}
 .bud .bar{height:12px;background:var(--elev);border-radius:8px;overflow:hidden;margin:12px 0 8px;border:1px solid var(--line)}
 .bud .bar div{height:100%;background:linear-gradient(90deg,var(--p),var(--p2));border-radius:8px}
 .bud .bar.warn div{background:linear-gradient(90deg,#F59E0B,#F87171)}
 .budrow{display:flex;justify-content:space-between;font-size:13px;color:var(--mut);margin:3px 0}
 .warn{color:#F59E0B;font-weight:700} .over{color:var(--exp);font-weight:700}
 .catrow{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
 .catrow .name{width:130px;font-weight:700}
 .catrow .track{flex:1;height:10px;background:var(--elev);border-radius:6px;overflow:hidden}
 .catrow .track div{height:100%;border-radius:6px}
 .catrow .amt{width:140px;text-align:right;font-weight:700}
 .catrow .pct{width:58px;text-align:right;color:var(--mut);font-size:12.5px}
 .topcat{border:1px solid var(--pline);border-radius:14px}
 .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:50;padding:16px}
 .ov.open{display:flex}
 .modal{background:var(--card);border:1px solid var(--pline);border-radius:20px;padding:24px;width:100%;max-width:420px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
 .modal h3{margin:0 0 16px;font-size:17px}
 .field{margin-bottom:12px}
 .field label{display:block;font-size:12px;color:var(--mut);margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}
 .row{display:flex;gap:10px} .row .field{flex:1}
 .cbtn{width:100%;margin-top:6px}
 select.inp{width:100%}
</style></head><body>
<div class="app">
  <aside class="side">
    <div class="brand">💰 <span>Catatan Pengeluaran</span></div>
    <button class="nv active" data-v="dash">📊 Dashboard</button>
    <a class="nv" href="?view=tahun">📅 Rekap Tahunan</a>
    <div class="side-foot">{NAME}</div>
  </aside>

  <main class="main">

    <!-- ============ DASHBOARD ============ -->
    <section id="v-dash" class="view active">
      <div class="hdr">
        <div><h1>{GREET}</h1><div class="sub">{DATE} · {BULAN}</div></div>
        <div class="actions">
          <div class="actions" style="gap:6px">
            <a class="btn" href="?bulan={PREV}">←</a>
            <span style="font-weight:700">{BULAN}</span>
            <a class="btn" href="?bulan={NEXT}">→</a>
          </div>
        </div>
      </div>
      <div class="cards">
        <div class="card"><div class="lbl">Pengeluaran bulan ini</div><div class="val exp">{TOTAL}</div><div class="sub2">{DELTA}</div></div>
        <div class="card"><div class="lbl">Pengeluaran hari ini</div><div class="val exp">{TODAY}</div></div>
        <div class="card"><div class="lbl">Sisa budget</div><div class="val {REMAIN_CLS}">{REMAIN}</div><div class="sub2">target {BUDGET_TARGET}</div></div>
        <div class="card"><div class="lbl">Transaksi bulan ini</div><div class="val">{COUNT}</div><div class="sub2">masuk {INCOME}</div></div>
      </div>
      <div class="grid2">
        <div class="panel">
          <h2>Analisa Harian · {BULAN}</h2>
          <div class="seg" id="segDay">
            <button data-r="7">7 hari</button><button data-r="30">30 hari</button><button data-r="0" class="on">Bulan ini</button>
          </div>
          <div class="chartbox" id="daily">{DAILY_SVG}</div>
          <div class="budrow" style="margin-top:12px"><span class="mut">vs bulan lalu</span><b>{DELTA}</b></div>
        </div>
        <div class="panel">
          <h2>Kategori Pengeluaran</h2>
          <div id="cat" style="max-width:250px;margin:0 auto">{CAT_SVG}</div>
          <div style="margin-top:12px">{CATLIST}</div>
        </div>
      </div>
      <div class="panel">
        <div class="hdr" style="margin-bottom:8px">
          <h2>Transaksi Terbaru</h2>
        </div>
        <table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Catatan</th><th style="text-align:right">Nominal</th></tr></thead><tbody>{TROWS}</tbody></table>
        <div class="empty {DXEMPTY_CLS}" id="dxempty">Tidak ada transaksi bulan ini.</div>
      </div>
    </section>

  </main>
</div>


<script>
const TX = {TXJSON};
const OV = {OVJSON};
const DAILY = {DAILYJSON};
const INC = {INCOMEJSON};
const CATS = {CATJSON};
const COL = {COLORSJSON};

/* ---------- navigasi view ---------- */
function goView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nv[data-v]').forEach(b=>b.classList.remove('active'));
  const sec=document.getElementById('v-'+name); if(!sec) return;
  sec.classList.add('active');
  const btn=document.querySelector('.nv[data-v="'+name+'"]'); if(btn) btn.classList.add('active');
  if(name==='dash') drawCharts();
}
document.querySelectorAll('.nv[data-v]').forEach(b=>b.onclick=()=>goView(b.dataset.v));
window.goView=goView;

/* ---------- format ---------- */
function escH(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtRp(n){return 'Rp '+Number(n).toLocaleString('id-ID');}

/* ---------- transaksi: filter + render ---------- */
window.exportCsv=exportCsv;

/* ---------- chart harian ---------- */
function svgDaily(expDays, incDays){
  var W=760,H=230,padL=48,padB=28,padT=14,padR=12;
  var plotW=W-padL-padR, plotH=H-padT-padB;
  var days=[...new Set([...expDays.map(function(d){return d.d;}), ...incDays.map(function(d){return d.d;})])].sort();
  var vals=days.map(function(d){var f=null; expDays.forEach(function(x){ if(x.d===d) f=x;}); return f? f.v:0;});
  var incs=days.map(function(d){var f=null; incDays.forEach(function(x){ if(x.d===d) f=x;}); return f? f.v:0;});
  var maxV=Math.max(1, Math.max.apply(null, vals.concat(incs)));
  var n=days.length||1;
  var step=plotW/n;
  var bw=Math.max(2, Math.min(18, step*0.6));
  var bars='', pts=[];
  vals.forEach(function(v,i){ var x=padL+i*step+(step-bw)/2; var h=v/maxV*plotH; var y=padT+plotH-h;
    bars += '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="4" fill="url(#gExp)"><title>'+days[i]+' · Rp '+Number(v).toLocaleString('id-ID')+'</title></rect>';
    pts.push((padL+i*step+step/2).toFixed(1)+','+(padT+plotH-incs[i]/maxV*plotH).toFixed(1));
  });
  var hasInc=false; incs.forEach(function(v){ if(v>0) hasInc=true; });
  var incLine = hasInc ? '<polyline points="'+pts.join(' ')+'" fill="none" stroke="#22C55E" stroke-width="2" opacity=".85"/>' : '';
  var gl='';
  for(var g=0;g<=4;g++){ var gy=padT+plotH*g/4; var val=maxV*(1-g/4); gl += '<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="rgba(255,255,255,.06)"/><text x="'+(padL-8)+'" y="'+(gy+4)+'" text-anchor="end" font-size="10" fill="#9B96AA">'+(val>=1000? (val/1000)+'rb': Math.round(val))+'</text>'; }
  var xl=''; var every=Math.ceil(n/12);
  days.forEach(function(d,i){ if(i%every===0){ xl += '<text x="'+(padL+i*step+step/2)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#9B96AA">'+d.slice(5)+'</text>'; } });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img"><defs><linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F87171"/><stop offset="1" stop-color="rgba(248,113,113,.25)"/></linearGradient></defs>'+gl+bars+incLine+xl+'</svg>';
}
function svgCat(cats){
  var total=0; cats.forEach(function(c){ total+=c.v; }); if(!total) total=1;
  var R=62,C=100,circ=2*Math.PI*R;
  var off=0, segs='';
  cats.forEach(function(c,i){ var frac=c.v/total; var len=frac*circ;
    segs += '<circle cx="'+C+'" cy="'+C+'" r="'+R+'" fill="none" stroke="'+COL[i%COL.length]+'" stroke-width="26" stroke-dasharray="'+len.toFixed(2)+' '+(circ-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 '+C+' '+C+')"><title>'+escH(c.k)+' · Rp '+Number(c.v).toLocaleString('id-ID')+' ('+Math.round(frac*100)+'%)</title></circle>';
    off += len;
  });
  return '<svg viewBox="0 0 200 200" width="100%" style="max-width:220px" role="img">'+segs+'<text x="'+C+'" y="'+(C-2)+'" text-anchor="middle" font-size="20" font-weight="800" fill="#F5F3FA">'+Number(total).toLocaleString('id-ID')+'</text><text x="'+C+'" y="'+(C+16)+'" text-anchor="middle" font-size="10" fill="#9B96AA">total bulan ini</text></svg>';
}
function drawCharts(){
  const r=document.querySelector('#segDay button.on');
  const range = r ? Number(r.dataset.r) : 0;
  let expDays=DAILY, incDays=INC;
  if(range>0){ expDays=[...DAILY].slice(-range); incDays=[...INC].slice(-range); }
  const el=document.getElementById('daily'); if(el) el.innerHTML=svgDaily(expDays, incDays);
  const ec=document.getElementById('cat'); if(ec) ec.innerHTML=svgCat(CATS);
}
document.querySelectorAll('#segDay button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#segDay button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); drawCharts();
});
drawCharts();
drawCharts();
});
drawCharts();

window.saveBudget=saveBudget;
</script>
</body></html>`;

function svgDailyServer(expDays, incDays){
  var W=760,H=230,padL=48,padB=28,padT=14,padR=12;
  var plotW=W-padL-padR, plotH=H-padT-padB;
  var days=[...new Set([...expDays.map(function(d){return d.d;}), ...incDays.map(function(d){return d.d;})])].sort();
  var vals=days.map(function(d){var f=null; expDays.forEach(function(x){ if(x.d===d) f=x;}); return f? f.v:0;});
  var incs=days.map(function(d){var f=null; incDays.forEach(function(x){ if(x.d===d) f=x;}); return f? f.v:0;});
  var maxV=Math.max(1, Math.max.apply(null, vals.concat(incs)));
  var n=days.length||1;
  var step=plotW/n;
  var bw=Math.max(2, Math.min(18, step*0.6));
  var bars='', pts=[];
  vals.forEach(function(v,i){ var x=padL+i*step+(step-bw)/2; var h=v/maxV*plotH; var y=padT+plotH-h;
    bars += '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="4" fill="url(#gExp)"><title>'+esc(days[i])+' · Rp '+nf(v)+'</title></rect>';
    pts.push((padL+i*step+step/2).toFixed(1)+','+(padT+plotH-incs[i]/maxV*plotH).toFixed(1));
  });
  var hasInc=false; incs.forEach(function(v){ if(v>0) hasInc=true; });
  var incLine = hasInc ? '<polyline points="'+pts.join(' ')+'" fill="none" stroke="#22C55E" stroke-width="2" opacity=".85"/>' : '';
  var gl='';
  for(var g=0;g<=4;g++){ var gy=padT+plotH*g/4; var val=maxV*(1-g/4); gl += '<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="rgba(255,255,255,.06)"/><text x="'+(padL-8)+'" y="'+(gy+4)+'" text-anchor="end" font-size="10" fill="#9B96AA">'+(val>=1000? (val/1000)+'rb': Math.round(val))+'</text>'; }
  var xl=''; var every=Math.ceil(n/12);
  days.forEach(function(d,i){ if(i%every===0){ xl += '<text x="'+(padL+i*step+step/2)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#9B96AA">'+esc(d.slice(5))+'</text>'; } });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img"><defs><linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F87171"/><stop offset="1" stop-color="rgba(248,113,113,.25)"/></linearGradient></defs>'+gl+bars+incLine+xl+'</svg>';
}
function svgCatServer(cats){
  var total=0; cats.forEach(function(c){ total+=c.v; }); if(!total) total=1;
  var R=62,C=100,circ=2*Math.PI*R;
  var off=0, segs='';
  cats.forEach(function(c,i){ var frac=c.v/total; var len=frac*circ;
    segs += '<circle cx="'+C+'" cy="'+C+'" r="'+R+'" fill="none" stroke="'+COLORS[i%COLORS.length]+'" stroke-width="26" stroke-dasharray="'+len.toFixed(2)+' '+(circ-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 '+C+' '+C+')"><title>'+esc(c.k)+' · Rp '+nf(c.v)+' ('+Math.round(frac*100)+'%)</title></circle>';
    off += len;
  });
  return '<svg viewBox="0 0 200 200" width="100%" style="max-width:220px" role="img">'+segs+'<text x="'+C+'" y="'+(C-2)+'" text-anchor="middle" font-size="20" font-weight="800" fill="#F5F3FA">'+nf(total)+'</text><text x="'+C+'" y="'+(C+16)+'" text-anchor="middle" font-size="10" fill="#9B96AA">total bulan ini</text></svg>';
}
function html(url, bulan, chatId, d, uname) {
  const prev = prevBulan(bulan), next = nextBulan(bulan);
  const rp = (n) => 'Rp ' + nf(n);
  const remainCls = d.remainBudget === null ? 'p' : (d.remainBudget >= 0 ? 'inc' : 'exp');
  const expDelta = d.expDelta === null ? '—' : (d.expDelta >= 0 ? `<span class="dn">▲ ${d.expDelta}%</span>` : `<span class="up">▼ ${Math.abs(d.expDelta)}%</span>`);
  const incTxt = rp(d.incomeTotal);

  // kategori list (dashboard)
  let catList = '';
  d.catArr.forEach((c, i) => {
    const p = Math.round((c.v / (d.expenseTotal || 1)) * 100);
    catList += `<div class="cat"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>
      <span class="nm">${esc(c.k)}</span><span class="amt">${rp(c.v)}</span>
      <span class="pct">${p}%</span></div>`;
  });
  if (!catList) catList = `<div class="mut">Belum ada pengeluaran bulan ini.</div>`;

  // kategori rows (halaman kategori) + trend vs bulan lalu
  let catRows = '';
  if (!d.catArr.length) {
    catRows = `<div class="mut">Belum ada pengeluaran bulan ini.</div>`;
  } else {
    d.catArr.forEach((c, i) => {
      const p = Math.round((c.v / (d.expenseTotal || 1)) * 100);
      const pv = d.catPrevMap[c.k] || 0;
      const delta = pv > 0 ? Math.round(((c.v - pv) / pv) * 100) : null;
      const deltaTxt = delta === null ? 'baru' : (delta >= 0 ? `<span class="dn">▲ ${delta}%</span>` : `<span class="up">▼ ${Math.abs(delta)}%</span>`);
      const top = i === 0 ? ' topcat' : '';
      catRows += `<div class="catrow${top}">
        <span class="dot" style="width:12px;height:12px;border-radius:4px;background:${COLORS[i % COLORS.length]}"></span>
        <div class="name">${esc(c.k)}</div>
        <div class="track"><div style="width:${p}%;background:${COLORS[i % COLORS.length]}"></div></div>
        <div class="amt">${rp(c.v)}</div>
        <div class="pct">${p}%</div>
        <div class="mut" style="width:58px;text-align:right;font-size:12px">${deltaTxt}</div>
      </div>`;
    });
  }

  // budget body
  let budgetBody;
  if (d.budgetNom === null) {
    budgetBody = `<div class="mut">Belum set budget bulan ini. Atur lewat form di bawah (atau /budget di bot).</div>`;
  } else {
    const pct = Math.min(100, Math.round((d.expenseTotal / d.budgetNom) * 100));
    const warn = d.expenseTotal >= d.budgetNom * 0.8;
    const over = d.expenseTotal > d.budgetNom;
    const cls = over ? 'over' : (warn ? 'warn' : '');
    const remainTxt = d.remainBudget >= 0 ? `Sisa ${rp(d.remainBudget)}` : `Lebih ${rp(-d.remainBudget)}`;
    budgetBody = `
      <div class="budrow"><span>Target</span><b>${rp(d.budgetNom)}</b></div>
      <div class="budrow"><span>Terpakai</span><b>${rp(d.expenseTotal)}</b></div>
      <div class="bar ${warn ? 'warn' : ''}"><div style="width:${pct}%"></div></div>
      <div class="budrow"><span>${pct}% terpakai</span><span class="${cls}">${remainTxt}</span></div>
      ${over ? '<div class="over" style="margin-top:8px">⚠ Sudah melebihi budget bulan ini.</div>' : (warn ? '<div class="warn" style="margin-top:8px">⚠ Mendekati batas budget (≥80%).</div>' : '')}`;
  }

  const ov = { bulan: fmtBulan(bulan), total: d.expenseTotal, today: d.todayExp, remain: d.remainBudget,
    count: d.txCount, income: d.incomeTotal, delta: d.expDelta };
  const catData = d.catArr.map((c) => ({ k: c.k, v: c.v }));

  const tRows = d.tx.slice(0, 10).map((x) => {
    const chip = x.tp === 'masuk' ? '<span class="chip i">Masuk</span>' : '<span class="chip k">Keluar</span>';
    const cls = x.tp === 'masuk' ? 'amt inc' : 'amt';
    return `<tr><td class="mut">${esc(x.t.slice(5).replace('-', '/'))}</td><td>${chip}</td><td>${esc(x.k)}</td><td class="mut">${esc(x.c)}</td><td class="${cls}">Rp ${nf(x.v)}</td></tr>`;
  }).join('');
  const catOptions = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');
  const catS = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');

  return new Response(LAYOUT
    .split('{NAME}').join(esc(uname))
    .split('{GREET}').join(esc(greetingWIB()))
    .split('{DATE}').join(esc(todayLabelWIB()))
    .split('{BULAN}').join(esc(fmtBulan(bulan)))
    .split('{PREV}').join(prev)
    .split('{NEXT}').join(next)
    .split('{TOTAL}').join(rp(d.expenseTotal))
    .split('{TODAY}').join(rp(d.todayExp))
    .split('{REMAIN}').join(d.remainBudget === null ? '—' : rp(d.remainBudget))
    .split('{REMAIN_CLS}').join(remainCls)
    .split('{BUDGET_TARGET}').join(d.budgetNom === null ? 'belum diset' : rp(d.budgetNom))
    .split('{COUNT}').join(String(d.txCount))
    .split('{INCOME}').join(incTxt)
    .split('{DELTA}').join(expDelta)
    .split('{CATLIST}').join(catList)
    .split('{CATROWS}').join(catRows)
    .split('{BUDGET_BODY}').join(budgetBody)
    .split('{CATOPTIONS}').join(catOptions)
    .split('{CATS}').join(catS)
    .split('{TROWS}').join(tRows)
    .split('{DXEMPTY_CLS}').join(d.tx.length ? 'hidden' : '')
    .split('{TXJSON}').join(JSON.stringify(d.tx))
    .split('{OVJSON}').join(JSON.stringify(ov))
    .split('{DAILYJSON}').join(JSON.stringify(d.dayExpArr))
    .split('{INCOMEJSON}').join(JSON.stringify(d.dayIncArr))
    .split('{CATJSON}').join(JSON.stringify(catData))
    .split('{COLORSJSON}').join(JSON.stringify(COLORS))
    .split('{DAILY_SVG}').join(svgDailyServer(d.dayExpArr, d.dayIncArr))
    .split('{CAT_SVG}').join(svgCatServer(catData)),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
