// Dashboard web multiuser untuk bot catatan pengeluaran.
// Login via deep-link kode (domain-independent).
// Gaya: dark navy + aksen ungu + hero gradien (referensi user).

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

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
function fmtTgl(str) {
  const [y, m, d] = str.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
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

/* ---------- cookie sesi per-user ---------- */
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
  const now = Math.floor(Date.now() / 1000);
  if (Number(aud) < now) return null;
  const expect = await hmacHex(keyBytes, `${userId}.${aud}`);
  if (expect !== h) return null;
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
  const row = await env.DB.prepare(
    'SELECT chat_id, created FROM login_req WHERE code = ?'
  ).bind(code).first();
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
 :root{--bg:#091428;--card:#141c35;--line:rgba(191,143,245,.16);--tx:#e6eaf3;--mut:#8f919f;--purp:#bf8ff5}
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:radial-gradient(1200px 500px at 70% -10%, rgba(191,143,245,.18), transparent 60%), var(--bg);
 color:var(--tx);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{background:var(--card);border:1px solid var(--line);padding:40px;border-radius:22px;width:380px;
 box-shadow:0 20px 60px rgba(0,0,0,.45);text-align:center}
 h1{font-size:21px;margin:0 0 6px;color:#cea2f7}
 p{color:var(--mut);font-size:13.5px;margin:0 0 26px;line-height:1.6}
 .big{display:inline-block;background:linear-gradient(135deg,#c08ff5,#9a6ff0);color:#0a0a1a;font-weight:800;
 padding:14px 26px;border-radius:14px;text-decoration:none;font-size:15px;box-shadow:0 10px 30px rgba(191,143,245,.35)}
 .big:hover{filter:brightness(1.08)}
 .status{margin-top:18px;color:var(--mut);font-size:13px}
 .ok{color:#22c55e;font-weight:700}
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
    .then(function(r){return r.json();})
    .then(function(j){
      if(j.ok){ document.getElementById('st').innerHTML='<span class="ok">✓ Berhasil. Mengarahkan…</span>'; setTimeout(function(){location.href='/dashboard';},600); }
      else { setTimeout(poll,2000); }
    })
    .catch(function(){ setTimeout(poll,3000); });
})();
</script>
</body></html>`;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/* ---------- route ---------- */
export async function handleDashboard(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) {
    return new Response('TELEGRAM_TOKEN belum diset di secret Worker.', { status: 500 });
  }
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
    ? url.searchParams.get('bulan')
    : bulanWIB();
  const data = await getMonthData(env, uid, bulan);
  return html(url, bulan, uid, data);
}

export async function handleCheckLogin(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  const code = url.searchParams.get('code') || '';
  const chatId = await takeCode(env, code);
  if (!chatId) {
    return new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } });
  }
  const cookie = await signUser(chatId, keyBytes);
  return new Response('{"ok":true}', {
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': `dash_user=${cookie}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    },
  });
}

export async function handleLogout() {
  return new Response('', {
    status: 302,
    headers: { Location: '/dashboard', 'Set-Cookie': 'dash_user=; Path=/; Max-Age=0; HttpOnly' },
  });
}

async function getMonthData(env, chatId, bulan) {
  const [tot, budget, perDay, perCat, recent] = await Promise.all([
    env.DB.prepare(
      'SELECT COALESCE(SUM(nominal),0) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ?')
      .bind(chatId, bulan).first(),
    env.DB.prepare('SELECT nominal FROM budget WHERE chat_id = ? AND bulan = ?')
      .bind(chatId, bulan).first(),
    env.DB.prepare(
      'SELECT tanggal, SUM(nominal) AS total FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ? GROUP BY tanggal ORDER BY tanggal')
      .bind(chatId, bulan).all(),
    env.DB.prepare(
      'SELECT kategori, SUM(nominal) AS total, COUNT(*) AS n FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ? GROUP BY kategori ORDER BY total DESC')
      .bind(chatId, bulan).all(),
    env.DB.prepare(
      'SELECT id, tanggal, kategori, nominal, catatan FROM pengeluaran WHERE chat_id = ? AND substr(tanggal,1,7) = ? ORDER BY id DESC LIMIT 25')
      .bind(chatId, bulan).all(),
  ]);
  const today = wibNow().toISOString().slice(0, 10);
  const tToday = await env.DB.prepare(
    'SELECT COALESCE(SUM(nominal),0) AS total FROM pengeluaran WHERE chat_id = ? AND tanggal = ?')
    .bind(chatId, today).first();
  return {
    total: Number(tot ? tot.total : 0),
    count: Number(tot ? tot.n : 0),
    budget: budget ? Number(budget.nominal) : null,
    perDay: (perDay.results || []).map((r) => ({ tanggal: r.tanggal, total: Number(r.total) })),
    perCat: (perCat.results || []).map((r) => ({ kategori: r.kategori, total: Number(r.total), n: Number(r.n) })),
    recent: (recent.results || []),
    today: Number(tToday ? tToday.total : 0),
    todayLabel: today,
  };
}

const COLORS = ['#bf8ff5', '#9a6ff0', '#7a55d8', '#c08ff5', '#8f5bd8', '#a588e8',
  '#6a4ec0', '#d9b4ff', '#4e36ac', '#b08fd3', '#c98fff', '#5a3fb5'];

const LAYOUT = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Pengeluaran</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
 :root{--bg:#091428;--card:#141c35;--card2:#1a2339;--line:rgba(191,143,245,.14);--tx:#e6eaf3;--mut:#8f919f;
  --purp:#bf8ff5;--lav:#cea2f7;--green:#22c55e;--red:#ef4444}
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 520px at 75% -12%, rgba(191,143,245,.16), transparent 60%), var(--bg);color:var(--tx)}
 .wrap{max-width:1080px;margin:0 auto;padding:26px 18px 70px}
 header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:22px}
 .brand{display:flex;align-items:center;gap:12px}
 .logo{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#c08ff5,#4e4273);
  display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:0 8px 24px rgba(191,143,245,.35)}
 h1{font-size:20px;margin:0;color:var(--lav);font-weight:700}
 .sub{color:var(--mut);font-size:12.5px;margin-top:2px}
 .nav{display:flex;gap:8px;align-items:center}
 .btn{background:var(--card);border:1px solid var(--line);color:var(--tx);padding:9px 14px;
  border-radius:12px;text-decoration:none;font-size:14px;font-weight:600;transition:.15s}
 .btn:hover{border-color:var(--purp);color:var(--lav)}
 .logout{color:var(--mut);font-size:13px;text-decoration:none;margin-left:8px}
 .logout:hover{color:var(--red)}
 .hero{position:relative;overflow:hidden;border-radius:22px;padding:28px 30px;
  background:linear-gradient(135deg,#b08fd3 0%,#7a55d8 45%,#4e4273 100%);
  box-shadow:0 18px 50px rgba(80,60,160,.45);margin-bottom:18px}
 .hero::after{content:'';position:absolute;inset:0;background:radial-gradient(400px 200px at 85% 0%, rgba(255,255,255,.25), transparent 60%)}
 .hero>.in{position:relative}
 .hero .hl{font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.85);font-weight:600}
 .hero .hv{font-size:38px;font-weight:800;color:#fff;margin-top:4px;letter-spacing:.5px}
 .hero .hs{font-size:13.5px;color:rgba(255,255,255,.85);margin-top:6px}
 .hero .hs b{color:#fff}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:18px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;transition:.15s}
 .card:hover{border-color:var(--purp)}
 .card .lbl{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:.8px}
 .card .val{font-size:23px;font-weight:800;margin-top:7px;color:var(--lav)}
 .card .val.red{color:var(--red)} .card .val.green{color:var(--green)}
 .card .sub2{color:var(--mut);font-size:12.5px;margin-top:4px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 @media (max-width:760px){.grid{grid-template-columns:1fr}}
 .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
 .panel h2{font-size:12.5px;margin:0 0 14px;color:var(--mut);text-transform:uppercase;letter-spacing:.9px}
 .bar{height:26px;background:#0b1526;border-radius:8px;overflow:hidden;margin-bottom:6px;border:1px solid var(--line)}
 .bar>div{height:100%;border-radius:8px;display:flex;align-items:center;justify-content:flex-end;
  padding-right:8px;font-size:11px;font-weight:800;color:#0c0c1c;min-width:34px}
 .cat{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
 .cat:last-child{border-bottom:0}
 .dot{width:10px;height:10px;border-radius:50%;flex:none}
 .cat .nm{flex:1} .cat .amt{font-weight:700;color:var(--tx)} .cat .pct{color:var(--mut);font-size:12px;width:44px;text-align:right}
 table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line)}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.9px}
 td{color:var(--tx)} .mut{color:var(--mut);font-size:13px}
</style></head><body>
<div class="wrap">

<header>
  <div class="brand">
    <div class="logo">📒</div>
    <div><h1>Dashboard Pengeluaran</h1><div class="sub">{SUB}</div></div>
  </div>
  <div class="nav">
    <a class="btn" href="?bulan={PREV}">←</a>
    <span style="font-weight:700;min-width:150px;text-align:center;color:var(--tx)">{BULAN}</span>
    <a class="btn" href="?bulan={NEXT}">→</a>
    <a class="logout" href="/logout">Keluar</a>
  </div>
</header>

{HERO}

{CARDS}

<div class="grid">
  <div class="panel"><h2>Pengeluaran per hari</h2><canvas id="daily"></canvas></div>
  <div class="panel"><h2>Per kategori</h2><canvas id="cat"></canvas>
    <div style="margin-top:14px">{CATLIST}</div></div>
</div>

<div class="panel" style="margin-top:14px">
  <h2>Catatan terbaru · {BULAN}</h2>
  {TABLE}
</div>

</div>
<script>
const DAILY = {DAILYJSON};
const CAT = {CATJSON};
const COLORS = {COLORSJSON};
new Chart(document.getElementById('daily'), {
  type:'bar',
  data:{ labels:DAILY.map(d=>d.tanggal.slice(5)),
    datasets:[{ data:DAILY.map(d=>d.total), backgroundColor:'#bf8ff5',
      hoverBackgroundColor:'#d9b4ff', borderRadius:7, barPercentage:0.65 }]},
  options:{ plugins:{legend:{display:false}}, scales:{
    x:{ticks:{color:'#8f919f',maxRotation:0},grid:{display:false}},
    y:{beginAtZero:true,ticks:{color:'#8f919f'},grid:{color:'rgba(191,143,245,.08)'}} }}
});
new Chart(document.getElementById('cat'), {
  type:'doughnut',
  data:{ labels:CAT.map(c=>c.kategori),
    datasets:[{ data:CAT.map(c=>c.total), backgroundColor:COLORS.slice(0,CAT.length),
      borderColor:'#141c35', borderWidth:2 }]},
  options:{ plugins:{ legend:{ position:'bottom', labels:{color:'#cbd0da',boxWidth:10,font:{size:12}} } }}
});
</script>
</body></html>`;

const HERO = `<div class="hero"><div class="in">
  <div class="hl">Total pengeluaran</div>
  <div class="hv">{TOTAL}</div>
  <div class="hs"><b>{COUNT}</b> catatan · hari ini <b>{TODAY}</b></div>
</div></div>`;

const CARD_HTML = `<div class="card"><div class="lbl">Hari ini ({TGL})</div><div class="val green">{TODAY}</div></div>`;
const CARD_BUDGET = `<div class="card"><div class="lbl">Budget</div><div class="val {BUDGET_CLS}">{BUDGET}</div><div class="sub2">Terpakai {SPENT}</div></div>`;
const CARD_SISA = `<div class="card"><div class="lbl">Sisa budget</div><div class="val {SISA_CLS}">{SISA}</div></div>`;

function html(url, bulan, chatId, data) {
  const prev = prevBulan(bulan), next = nextBulan(bulan);

  const hero = HERO
    .replace('{TOTAL}', 'Rp ' + nf(data.total))
    .replace('{COUNT}', String(data.count))
    .replace('{TODAY}', 'Rp ' + nf(data.today));

  let cards = CARD_HTML
    .replace('{TGL}', esc(data.todayLabel.slice(5).replace('-', '/')))
    .replace('{TODAY}', 'Rp ' + nf(data.today));

  if (data.budget !== null) {
    const sisa = data.budget - data.total;
    cards += CARD_BUDGET.replace('{BUDGET}', 'Rp ' + nf(data.budget))
      .replace('{BUDGET_CLS}', sisa < 0 ? 'red' : 'green')
      .replace('{SPENT}', 'Rp ' + nf(data.total))
      + CARD_SISA.replace('{SISA}', (sisa >= 0 ? '' : '−Rp ') + nf(Math.abs(sisa)))
        .replace('{SISA_CLS}', sisa < 0 ? 'red' : 'green');
  } else {
    cards += `<div class="card"><div class="lbl">Budget</div><div class="sub2">Belum diset. Ketik /budget <nominal> di bot.</div></div>`;
  }

  let catList = '';
  const catMax = data.perCat.length ? data.perCat[0].total : 1;
  const catCol = COLORS.slice(0, data.perCat.length);
  data.perCat.forEach((c, i) => {
    const p = Math.round((c.total / (data.total || 1)) * 100);
    catList += `<div class="cat">
      <span class="dot" style="background:${catCol[i]}"></span>
      <span class="nm">${esc(c.kategori)}</span>
      <span class="amt">Rp ${nf(c.total)}</span>
      <span class="pct">${p}%</span></div>
      <div class="bar"><div style="width:${Math.max((c.total / catMax) * 100, 4)}%;background:${catCol[i]}">${c.n}x</div></div>`;
  });

  let table = data.recent.length ? '<table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Catatan</th><th style="text-align:right">Nominal</th></tr></thead><tbody>'
    + data.recent.map((r) => `<tr><td class="mut">${esc(fmtTgl(r.tanggal))}</td><td>${esc(r.kategori)}</td><td class="mut">${esc(r.catatan || '')}</td><td style="text-align:right;font-weight:700;color:#cea2f7">Rp ${nf(r.nominal)}</td></tr>`).join('')
    + '</tbody></table>'
    : `<div class="mut">Belum ada data bulan ini untuk kamu.</div>`;

  return new Response(LAYOUT
    .replace('{SUB}', esc(`Data pribadi · chat ${chatId}`))
    .split('{BULAN}').join(esc(fmtBulan(bulan)))
    .replace('{PREV}', prev)
    .replace('{NEXT}', next)
    .replace('{HERO}', hero)
    .replace('{CARDS}', cards)
    .replace('{CATLIST}', catList)
    .replace('{TABLE}', table)
    .replace('{DAILYJSON}', JSON.stringify(data.perDay))
    .replace('{CATJSON}', JSON.stringify(data.perCat))
    .replace('{COLORSJSON}', JSON.stringify(catCol)),
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
