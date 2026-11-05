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

async function authUser(request, env) {
  const keyBytes = await secretKey(env);
  if (!keyBytes) return { err: 500 };
  const chatId = await verifyUser(getCookie(request, 'dash_user'), keyBytes);
  if (!chatId) return { err: 401 };
  return { chatId };
}
const jsonErr = (st, e) => new Response(JSON.stringify({ ok: false, err: e }), { status: st, headers: { 'content-type': 'application/json' } });
const jsonOk = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { headers: { 'content-type': 'application/json' } });

export async function handleAdd(request, env) {
  const a = await authUser(request, env);
  if (a.err) return jsonErr(a.err, a.err === 401 ? 'auth' : '');
  let b = {};
  try { b = await request.json(); } catch { return jsonErr(400, 'bad'); }
  const nominal = parseInt(String(b.nominal || '').replace(/[^\d]/g, ''), 10);
  const tipe = b.tipe === 'masuk' ? 'masuk' : 'keluar';
  const kategori = String(b.kategori || '').trim().toLowerCase().slice(0, 40);
  if (!Number.isInteger(nominal) || nominal <= 0 || !kategori) return jsonErr(400, 'invalid');
  const tanggal = b.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal)) ? String(b.tanggal) : monthWIB();
  const catatan = String(b.catatan || '').trim().slice(0, 120);
  await env.DB.prepare('INSERT INTO pengeluaran (chat_id, tanggal, kategori, nominal, catatan, tipe) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(a.chatId, tanggal, kategori, nominal, catatan, tipe).run();
  return jsonOk();
}

export async function handleEdit(request, env) {
  const a = await authUser(request, env);
  if (a.err) return jsonErr(a.err, a.err === 401 ? 'auth' : '');
  let b = {};
  try { b = await request.json(); } catch { return jsonErr(400, 'bad'); }
  const id = parseInt(b.id, 10);
  if (!Number.isInteger(id)) return jsonErr(400, 'bad');
  const sets = []; const vals = [];
  if (b.nominal !== undefined) {
    const n = parseInt(String(b.nominal).replace(/[^\d]/g, ''), 10);
    if (!Number.isInteger(n) || n <= 0) return jsonErr(400, 'invalid');
    sets.push('nominal=?'); vals.push(n);
  }
  if (b.kategori !== undefined) {
    const k = String(b.kategori).trim().toLowerCase().slice(0, 40);
    if (!k) return jsonErr(400, 'invalid');
    sets.push('kategori=?'); vals.push(k);
  }
  if (b.catatan !== undefined) {
    sets.push('catatan=?'); vals.push(String(b.catatan).trim().slice(0, 120));
  }
  if (b.tipe !== undefined) {
    const tp = b.tipe === 'masuk' ? 'masuk' : 'keluar';
    sets.push('tipe=?'); vals.push(tp);
  }
  if (b.tanggal !== undefined) {
    const t = String(b.tanggal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return jsonErr(400, 'invalid');
    sets.push('tanggal=?'); vals.push(t);
  }
  if (!sets.length) return jsonErr(400, 'bad');
  vals.push(id, a.chatId);
  await env.DB.prepare(`UPDATE pengeluaran SET ${sets.join(', ')} WHERE id=? AND chat_id=?`).bind(...vals).run();
  return jsonOk();
}

export async function handleDelete(request, env) {
  const a = await authUser(request, env);
  if (a.err) return jsonErr(a.err, a.err === 401 ? 'auth' : '');
  let b = {};
  try { b = await request.json(); } catch { return jsonErr(400, 'bad'); }
  const id = parseInt(b.id, 10);
  if (!Number.isInteger(id)) return jsonErr(400, 'bad');
  await env.DB.prepare('DELETE FROM pengeluaran WHERE id=? AND chat_id=?').bind(id, a.chatId).run();
  return jsonOk();
}

export async function handleBudget(request, env) {
  const a = await authUser(request, env);
  if (a.err) return jsonErr(a.err, a.err === 401 ? 'auth' : '');
  let b = {};
  try { b = await request.json(); } catch { return jsonErr(400, 'bad'); }
  const nominal = parseInt(String(b.nominal || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isInteger(nominal) || nominal < 0) return jsonErr(400, 'invalid');
  const bulan = bulanWIB();
  await env.DB.prepare(
    'INSERT INTO budget (chat_id, bulan, nominal) VALUES (?, ?, ?) ON CONFLICT(chat_id, bulan) DO UPDATE SET nominal = excluded.nominal'
  ).bind(a.chatId, bulan, nominal).run();
  return jsonOk();
}

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
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
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
    <button class="nv" data-v="tx">🧾 Transaksi</button>
    <button class="nv" data-v="cat">📂 Kategori</button>
    <button class="nv" data-v="bud">💰 Budget</button>
    <button class="nv" data-v="set">⚙️ Settings</button>
    <a class="nv" href="?view=tahun">📅 Rekap Tahunan</a>
    <div class="side-foot">chat {CHAT}</div>
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
          <button class="btn primary" onclick="openAdd()">＋ Tambah</button>
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
          <div class="chartbox"><canvas id="daily"></canvas></div>
          <div class="budrow" style="margin-top:12px"><span class="mut">vs bulan lalu</span><b>{DELTA}</b></div>
        </div>
        <div class="panel">
          <h2>Kategori Pengeluaran</h2>
          <canvas id="cat" height="180"></canvas>
          <div style="margin-top:12px">{CATLIST}</div>
        </div>
      </div>
      <div class="panel">
        <div class="hdr" style="margin-bottom:8px">
          <h2>Transaksi Terbaru</h2>
          <button class="btn small" onclick="goView('tx')">Lihat semua →</button>
        </div>
        <div class="filters">
          <input class="inp" type="text" id="dq" placeholder="Cari kategori / catatan…">
          <select class="inp" id="dc"><option value="">Semua kategori</option>{CATOPTIONS}</select>
          <select class="inp" id="dt"><option value="">Semua jenis</option><option value="keluar">Keluar</option><option value="masuk">Masuk</option></select>
        </div>
        <table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Catatan</th><th style="text-align:right">Nominal</th></tr></thead><tbody id="dxbody">{TROWS}</tbody></table>
        <div class="empty hidden" id="dxempty">Tidak ada transaksi bulan ini.</div>
      </div>
    </section>

    <!-- ============ TRANSAKSI ============ -->
    <section id="v-tx" class="view">
      <div class="hdr">
        <div><h1>🧾 Transaksi</h1><div class="sub">{BULAN} · {COUNT} catatan</div></div>
        <div class="actions">
          <button class="btn" onclick="exportCsv()">⬇ CSV</button>
          <button class="btn primary" onclick="openAdd()">＋ Tambah</button>
        </div>
      </div>
      <div class="panel">
        <div class="filters">
          <input class="inp" type="text" id="fq" placeholder="Cari kategori / catatan…">
          <select class="inp" id="fc"><option value="">Semua kategori</option>{CATOPTIONS}</select>
          <select class="inp" id="ft"><option value="">Semua jenis</option><option value="keluar">Keluar</option><option value="masuk">Masuk</option></select>
          <input class="inp" type="date" id="fd1"><input class="inp" type="date" id="fd2">
          <button class="btn small" onclick="resetF()">Reset</button>
        </div>
        <table><thead><tr>
          <th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Catatan</th>
          <th style="text-align:right">Nominal</th><th style="text-align:right">Aksi</th>
        </tr></thead><tbody id="txbody">{TROWS}</tbody></table>
        <div class="empty hidden" id="txempty">Tidak ada transaksi yang cocok.</div>
      </div>
    </section>

    <!-- ============ KATEGORI ============ -->
    <section id="v-cat" class="view">
      <div class="hdr"><div><h1>📂 Kategori</h1><div class="sub">Analisa pengeluaran · {BULAN}</div></div></div>
      <div class="panel">{CATROWS}</div>
    </section>

    <!-- ============ BUDGET ============ -->
    <section id="v-bud" class="view">
      <div class="hdr"><div><h1>💰 Budget Bulanan</h1><div class="sub">{BULAN}</div></div></div>
      <div class="panel bud" style="max-width:560px">
        {BUDGET_BODY}
        <div class="field" style="margin-top:18px">
          <label>Set budget bulan ini (Rp)</label>
          <div class="row">
            <input class="inp" type="number" id="budIn" min="0" placeholder="contoh: 1000000" style="flex:1">
            <button class="btn primary" onclick="saveBudget()">Simpan</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ SETTINGS ============ -->
    <section id="v-set" class="view">
      <div class="hdr"><div><h1>⚙️ Settings</h1></div></div>
      <div class="panel" style="max-width:560px">
        <div class="field"><label>Akun (chat ID)</label><div class="mut">{CHAT}</div></div>
        <div class="field"><label>Rekap Tahunan</label><div><a class="btn" href="?view=tahun">Buka Rekap Tahunan</a></div></div>
        <div class="field" style="margin-top:18px"><button class="btn danger" onclick="location.href='/logout'">Keluar</button></div>
      </div>
    </section>

  </main>
</div>

<!-- quick add / edit modal -->
<div class="ov" id="ovAdd"><div class="modal">
  <h3 id="addTitle">Tambah transaksi</h3>
  <div class="seg" id="segAdd">
    <button type="button" data-tp="keluar" class="on">Keluar</button>
    <button type="button" data-tp="masuk">Masuk</button>
  </div>
  <div class="field" style="margin-top:12px"><label>Nominal (Rp)</label><input class="inp" type="number" id="qNom" min="1" placeholder="50000" style="width:100%"></div>
  <div class="field"><label>Kategori</label><input class="inp" id="qKat" list="cats" placeholder="makan" style="width:100%"></div>
  <datalist id="cats">{CATS}</datalist>
  <div class="field"><label>Tanggal (opsional)</label><input class="inp" type="date" id="qDate" style="width:100%"></div>
  <div class="field"><label>Catatan (opsional)</label><input class="inp" id="qCat" placeholder="nasi padang" style="width:100%"></div>
  <button class="btn primary cbtn" id="qSave">Simpan</button>
  <button class="btn cbtn" onclick="closeAdd()">Batal</button>
</div></div>

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
const st={q:'',c:'',t:'',d1:'',d2:''};
function filtList(){
  return TX.filter(x=>{
    if(st.q && !(x.k+' '+x.c).toLowerCase().includes(st.q)) return false;
    if(st.c && x.k!==st.c) return false;
    if(st.t && x.tp!==st.t) return false;
    if(st.d1 && x.t<st.d1) return false;
    if(st.d2 && x.t>st.d2) return false;
    return true;
  });
}
function rowHtml(x){
  const chip=x.tp==='masuk' ? '<span class="chip i">Masuk</span>' : '<span class="chip k">Keluar</span>';
  const cls=x.tp==='masuk' ? 'amt inc' : 'amt';
  const act='<button class="btn small" onclick="editTx('+x.id+')">Edit</button> <button class="btn small danger" onclick="delTx('+x.id+')">Hapus</button>';
  return '<tr><td class="mut">'+escH(x.t.slice(5).replace('-','/'))+'</td><td>'+chip+'</td><td>'+escH(x.k)+'</td><td class="mut">'+escH(x.c)+'</td><td class="'+cls+'">'+fmtRp(x.v)+'</td><td style="text-align:right">'+act+'</td></tr>';
}
function renderTx(){ const list=filtList(); document.getElementById('txbody').innerHTML=list.map(rowHtml).join(''); document.getElementById('txempty').classList.toggle('hidden', list.length>0); }
function renderDashTx(){
  const list=filtList().slice(0,20);
  document.getElementById('dxbody').innerHTML=list.map(x=>{
    const chip=x.tp==='masuk' ? '<span class="chip i">Masuk</span>' : '<span class="chip k">Keluar</span>';
    const cls=x.tp==='masuk' ? 'amt inc' : 'amt';
    return '<tr><td class="mut">'+escH(x.t.slice(5).replace('-','/'))+'</td><td>'+chip+'</td><td>'+escH(x.k)+'</td><td class="mut">'+escH(x.c)+'</td><td class="'+cls+'">'+fmtRp(x.v)+'</td></tr>';
  }).join('');
  document.getElementById('dxempty').classList.toggle('hidden', list.length>0);
}
document.getElementById('fq').oninput=e=>{st.q=e.target.value.toLowerCase();renderTx();};
document.getElementById('fc').onchange=e=>{st.c=e.target.value;renderTx();};
document.getElementById('ft').onchange=e=>{st.t=e.target.value;renderTx();};
document.getElementById('fd1').onchange=e=>{st.d1=e.target.value;renderTx();};
document.getElementById('fd2').onchange=e=>{st.d2=e.target.value;renderTx();};
document.getElementById('dq').oninput=e=>{st.q=e.target.value.toLowerCase();renderDashTx();};
document.getElementById('dc').onchange=e=>{st.c=e.target.value;renderDashTx();};
document.getElementById('dt').onchange=e=>{st.t=e.target.value;renderDashTx();};
function resetF(){st.q=st.c=st.t=st.d1=st.d2='';document.getElementById('fq').value='';document.getElementById('fc').value='';document.getElementById('ft').value='';document.getElementById('fd1').value='';document.getElementById('fd2').value='';renderTx();}
window.resetF=resetF;
renderTx(); renderDashTx();

/* ---------- CSV export ---------- */
function exportCsv(){
  const rows=[['tanggal','jenis','kategori','catatan','nominal']];
  const list = document.getElementById('v-tx').classList.contains('active') ? filtList() : TX;
  list.forEach(x=>rows.push([x.t, x.tp, x.k, x.c, x.v]));
  const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='pengeluaran_'+OV.bulan.replace(/ /g,'_')+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
window.exportCsv=exportCsv;

/* ---------- chart harian ---------- */
let dailyChart, catChart;
function drawCharts(){
  const r=document.querySelector('#segDay button.on');
  const range = r ? Number(r.dataset.r) : 0;
  const dset={}; DAILY.forEach(d=>dset[d.d]=d.v);
  const inSet={}; INC.forEach(d=>inSet[d.d]=d.v);
  let days=[...new Set([...Object.keys(dset), ...Object.keys(inSet)])].sort();
  if(range>0 && days.length>range){ days=days.slice(-range); }
  const labels=days.map(d=>d.slice(5));
  const vals=days.map(d=>dset[d]||0);
  const incVals=days.map(d=>inSet[d]||0);
  if(dailyChart) dailyChart.destroy();
  dailyChart=new Chart(document.getElementById('daily'),{
    data:{ labels, datasets:[
      {type:'bar',label:'Keluar',data:vals,backgroundColor:'#F87171',borderRadius:6,barPercentage:0.6},
      {type:'line',label:'Masuk',data:incVals,borderColor:'#22C55E',backgroundColor:'#22C55E',tension:.35,pointRadius:3}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#9B96AA',boxWidth:10,font:{size:12}}}},
      scales:{x:{ticks:{color:'#9B96AA',maxRotation:0},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:'#9B96AA'},grid:{color:'rgba(255,255,255,.05)'}}}}
  });
  if(catChart) catChart.destroy();
  catChart=new Chart(document.getElementById('cat'),{
    type:'doughnut',
    data:{labels:CATS.map(c=>c.k),datasets:[{data:CATS.map(c=>c.v),backgroundColor:COL.slice(0,CATS.length),borderColor:'#181622',borderWidth:2}]},
    options:{plugins:{legend:{position:'bottom',labels:{color:'#9B96AA',boxWidth:10,font:{size:12}}}}}
  });
}
document.querySelectorAll('#segDay button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#segDay button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); drawCharts();
});
drawCharts();

/* ---------- quick add / edit ---------- */
let qType='keluar', editId=null;
document.querySelectorAll('#segAdd button').forEach(b=>b.onclick=()=>{ qType=b.dataset.tp; document.querySelectorAll('#segAdd button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); });
function openAdd(){
  editId=null; qType='keluar';
  document.getElementById('addTitle').textContent='Tambah transaksi';
  document.querySelectorAll('#segAdd button').forEach(x=>x.classList.toggle('on', x.dataset.tp==='keluar'));
  document.getElementById('qNom').value=''; document.getElementById('qKat').value='';
  document.getElementById('qDate').value=''; document.getElementById('qCat').value='';
  document.getElementById('ovAdd').classList.add('open');
}
function openEdit(id){
  const x=TX.find(t=>t.id===id); if(!x) return;
  editId=id; qType=x.tp;
  document.getElementById('addTitle').textContent='Edit transaksi #'+id;
  document.querySelectorAll('#segAdd button').forEach(b=>b.classList.toggle('on', b.dataset.tp===x.tp));
  document.getElementById('qNom').value=x.v; document.getElementById('qKat').value=x.k;
  document.getElementById('qDate').value=x.t; document.getElementById('qCat').value=x.c;
  document.getElementById('ovAdd').classList.add('open');
}
function closeAdd(){ document.getElementById('ovAdd').classList.remove('open'); }
function qSave(){
  const body={tipe:qType, nominal:document.getElementById('qNom').value, kategori:document.getElementById('qKat').value, catatan:document.getElementById('qCat').value, tanggal:document.getElementById('qDate').value};
  const url = editId ? '/api/edit' : '/api/add';
  if(editId) body.id=editId;
  fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    .then(r=>r.json()).then(j=>{ if(j.ok) location.reload(); else alert('Gagal menyimpan.'); });
}
document.getElementById('qSave').onclick=qSave;
window.openAdd=openAdd; window.openEdit=openEdit; window.closeAdd=closeAdd;
function delTx(id){
  if(!confirm('Hapus transaksi ini?')) return;
  fetch('/api/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})})
    .then(r=>r.json()).then(j=>{ if(j.ok) location.reload(); else alert('Gagal menghapus.'); });
}
window.delTx=delTx; window.editTx=openEdit;

/* ---------- budget ---------- */
function saveBudget(){
  const n=document.getElementById('budIn').value;
  fetch('/api/budget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nominal:n})})
    .then(r=>r.json()).then(j=>{ if(j.ok) location.reload(); else alert('Gagal set budget.'); });
}
window.saveBudget=saveBudget;
</script>
</body></html>`;

function html(url, bulan, chatId, d) {
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

  const tRows = d.tx.map((x) => {
    const chip = x.tp === 'masuk' ? '<span class="chip i">Masuk</span>' : '<span class="chip k">Keluar</span>';
    const cls = x.tp === 'masuk' ? 'amt inc' : 'amt';
    const act = '<button class="btn small" onclick="editTx(' + x.id + ')">Edit</button> <button class="btn small danger" onclick="delTx(' + x.id + ')">Hapus</button>';
    return `<tr><td class="mut">${esc(x.t.slice(5).replace('-', '/'))}</td><td>${chip}</td><td>${esc(x.k)}</td><td class="mut">${esc(x.c)}</td><td class="${cls}">Rp ${nf(x.v)}</td><td style="text-align:right">${act}</td></tr>`;
  }).join('');
  const catOptions = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');
  const catS = d.catArr.map((c) => `<option value="${esc(c.k)}">`).join('');

  return new Response(LAYOUT
    .split('{CHAT}').join(String(chatId))
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
    .split('{TXJSON}').join(JSON.stringify(d.tx))
    .split('{OVJSON}').join(JSON.stringify(ov))
    .split('{DAILYJSON}').join(JSON.stringify(d.dayExpArr))
    .split('{INCOMEJSON}').join(JSON.stringify(d.dayIncArr))
    .split('{CATJSON}').join(JSON.stringify(catData))
    .split('{COLORSJSON}').join(JSON.stringify(COLORS)),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
