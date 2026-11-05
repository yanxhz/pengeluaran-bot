// Dashboard web multiuser untuk bot catatan pengeluaran.
// Login via Telegram Login Widget (data-auth-url -> /auth). Server memverifikasi
// tanda tangan HMAC-SHA256 pakai bot token (secret TELEGRAM_TOKEN), lalu mengeluarkan
// cookie sesi per-user. Data difilter per chat_id (id Telegram user).

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
    _secret = new Uint8Array(await digestBytes(tk)); // kunci HMAC = sha256(bot token)
  }
  return _secret;
}

/* ---------- otentikasi Telegram ---------- */
function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

async function verifyTelegramAuth(data, keyBytes) {
  if (!data || !data.hash || !data.id || !data.auth_date) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - Number(data.auth_date) > 86400) return false; // kedaluwarsa > 24 jam
  const check = Object.keys(data)
    .filter((k) => k !== 'hash' && data[k] !== undefined)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const sig = await hmacHex(keyBytes, check);
  return sig === data.hash;
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

let _botUser = null;
async function getBotUsername(env) {
  if (_botUser) return _botUser;
  try {
    const r = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getMe`)).json();
    _botUser = r.ok ? r.result.username : null;
  } catch { _botUser = null; }
  return _botUser;
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) {
    return new Response('TELEGRAM_TOKEN belum diset', { status: 500 });
  }
  const data = {};
  if (request.method === 'GET') {
    url.searchParams.forEach((v, k) => { data[k] = v; });
  } else {
    try { Object.assign(data, await request.json()); } catch { /* js fallback */ }
    url.searchParams.forEach((v, k) => { if (!(k in data)) data[k] = v; });
  }
  const ok = await verifyTelegramAuth(data, keyBytes);
  if (!ok) {
    return new Response('', { status: 302, headers: { Location: '/dashboard?err=login' } });
  }
  const cookie = await signUser(data.id, keyBytes);
  return new Response('', {
    status: 302,
    headers: {
      Location: '/dashboard',
      'Set-Cookie': `dash_user=${cookie}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    },
  });
}

function loginPage(username, err) {
  const widget = username
    ? `<script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${esc(username)}" data-size="large" data-auth-url="/auth" data-request-access="write"></script>`
    : `<div class="mut">Bot username tidak ditemukan (cek secret TELEGRAM_TOKEN).</div>`;
  const errHtml = err ? `<div class="err">Login gagal. Coba lagi.</div>` : '';
  const body = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk — Catatan Pengeluaran</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;
 display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{background:#1e293b;padding:36px;border-radius:16px;width:340px;box-shadow:0 10px 30px rgba(0,0,0,.4);text-align:center}
 h1{font-size:20px;margin:0 0 6px} p{color:#94a3b8;font-size:13px;margin:0 0 24px;line-height:1.5}
 .err{color:#f87171;font-size:13px;margin-bottom:14px}
 .mut{color:#94a3b8;font-size:13px}
</style></head><body>
<div class="card"><h1>🔒 Catatan Pengeluaran</h1>
<p>Masuk pakai akun Telegram kamu untuk melihat dashboard pribadi.</p>
${errHtml}
${widget}
</div>
</body></html>`;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function handleDashboard(request, env) {
  const url = new URL(request.url);
  const keyBytes = await secretKey(env);
  if (!keyBytes) {
    return new Response('TELEGRAM_TOKEN belum diset di secret Worker.', { status: 500 });
  }
  const uid = await verifyUser(getCookie(request, 'dash_user'), keyBytes);
  if (!uid) {
    const un = await getBotUsername(env);
    return loginPage(un, url.searchParams.get('err') === 'login');
  }
  const bulan = /^\d{4}-\d{2}$/.test(url.searchParams.get('bulan') || '')
    ? url.searchParams.get('bulan')
    : bulanWIB();
  const data = await getMonthData(env, uid, bulan);
  return html(url, bulan, uid, data);
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

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#e11d48'];

const LAYOUT = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Pengeluaran</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
 :root{--bg:#0f172a;--card:#1e293b;--line:#334155;--tx:#e2e8f0;--mut:#94a3b8;--green:#22c55e;--red:#ef4444}
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
 background:var(--bg);color:var(--tx)}
 .wrap{max-width:980px;margin:0 auto;padding:24px 16px 60px}
 header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}
 h1{font-size:22px;margin:0} .sub{color:var(--mut);font-size:13px}
 .nav{display:flex;gap:8px;align-items:center}
 .btn{background:var(--card);border:1px solid var(--line);color:var(--tx);padding:8px 12px;
 border-radius:10px;text-decoration:none;font-size:14px;font-weight:600}
 .btn:hover{border-color:var(--green)}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
 .card .lbl{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
 .card .val{font-size:22px;font-weight:800;margin-top:6px}
 .card .val.red{color:var(--red)} .card .val.green{color:var(--green)}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 @media (max-width:720px){.grid{grid-template-columns:1fr}}
 .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
 .panel h2{font-size:15px;margin:0 0 12px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
 .bar{height:26px;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:6px}
 .bar>div{height:100%;border-radius:8px;display:flex;align-items:center;justify-content:flex-end;
 padding-right:8px;font-size:11px;font-weight:800;color:#052e16;min-width:34px}
 .cat{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
 .cat:last-child{border-bottom:0}
 .dot{width:10px;height:10px;border-radius:50%;flex:none}
 .cat .nm{flex:1} .cat .amt{font-weight:700} .cat .pct{color:var(--mut);font-size:12px;width:44px;text-align:right}
 table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
 th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
 .mut{color:var(--mut);font-size:13px}
 .logout{color:var(--mut);font-size:13px;text-decoration:none;margin-left:8px}
 .logout:hover{color:var(--red)}
</style></head><body>
<div class="wrap">

<header>
  <div><h1>📒 Dashboard Pengeluaran</h1>
    <div class="sub">{SUB}</div></div>
  <div class="nav">
    <a class="btn" href="?bulan={PREV}">←</a>
    <span style="font-weight:700;min-width:150px;text-align:center">{BULAN}</span>
    <a class="btn" href="?bulan={NEXT}">→</a>
    <a class="logout" href="/logout">Keluar</a>
  </div>
</header>

{CARDS}

<div class="grid">
  <div class="panel"><h2>Pengeluaran per hari</h2><canvas id="daily"></canvas></div>
  <div class="panel"><h2>Per kategori</h2><canvas id="cat"></canvas>
    <div style="margin-top:12px">{CATLIST}</div></div>
</div>

<div class="panel" style="margin-top:12px">
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
    datasets:[{ data:DAILY.map(d=>d.total), backgroundColor:'#22c55e',
      borderRadius:6, barPercentage:0.7 }]},
  options:{ plugins:{legend:{display:false}}, scales:{
    x:{ticks:{color:'#94a3b8',maxRotation:0},grid:{display:false}},
    y:{beginAtZero:true,ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}} }}
});
new Chart(document.getElementById('cat'), {
  type:'doughnut',
  data:{ labels:CAT.map(c=>c.kategori),
    datasets:[{ data:CAT.map(c=>c.total), backgroundColor:COLORS.slice(0,CAT.length),
      borderColor:'#1e293b', borderWidth:2 }]},
  options:{ plugins:{ legend:{ position:'bottom', labels:{color:'#e2e8f0',boxWidth:10,font:{size:12}} } }}
});
</script>
</body></html>`;

const CARD_HTML = `<div class="card"><div class="lbl">Total {BULAN}</div><div class="val">{TOTAL}</div><div class="sub">{COUNT} catatan</div></div>`;
const CARD_TODAY = `<div class="card"><div class="lbl">Hari ini ({TGL})</div><div class="val">{TODAY}</div></div>`;
const CARD_BUDGET = `<div class="card"><div class="lbl">Budget</div><div class="val {BUDGET_CLS}">{BUDGET}</div><div class="sub">Terpakai {SPENT}</div></div>`;
const CARD_SISA = `<div class="card"><div class="lbl">Sisa budget</div><div class="val {SISA_CLS}">{SISA}</div></div>`;

function html(url, bulan, chatId, data) {
  const prev = prevBulan(bulan), next = nextBulan(bulan);

  let cards = CARD_HTML.replace('{BULAN}', esc(fmtBulan(bulan)))
    .replace('{TOTAL}', 'Rp ' + nf(data.total))
    .replace('{COUNT}', String(data.count))
    + CARD_TODAY.replace('{TGL}', esc(data.todayLabel.slice(5).replace('-', '/')))
      .replace('{TODAY}', 'Rp ' + nf(data.today));

  if (data.budget !== null) {
    const sisa = data.budget - data.total;
    cards += CARD_BUDGET.replace('{BUDGET}', 'Rp ' + nf(data.budget))
      .replace('{BUDGET_CLS}', sisa < 0 ? 'red' : 'green')
      .replace('{SPENT}', 'Rp ' + nf(data.total))
      + CARD_SISA.replace('{SISA}', (sisa >= 0 ? '' : '−Rp ') + nf(Math.abs(sisa)))
        .replace('{SISA_CLS}', sisa < 0 ? 'red' : 'green');
  } else {
    cards += `<div class="card"><div class="lbl">Budget</div><div class="mut">Belum diset. Ketik /budget <nominal> di bot.</div></div>`;
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
    + data.recent.map((r) => `<tr><td class="mut">${esc(fmtTgl(r.tanggal))}</td><td>${esc(r.kategori)}</td><td class="mut">${esc(r.catatan || '')}</td><td style="text-align:right;font-weight:700">Rp ${nf(r.nominal)}</td></tr>`).join('')
    + '</tbody></table>'
    : `<div class="mut">Belum ada data bulan ini untuk kamu.</div>`;

  return new Response(LAYOUT
    .replace('{SUB}', esc(`Data pribadi · chat ${chatId}`))
    .replace('{BULAN}', esc(fmtBulan(bulan)))
    .replace('{PREV}', prev)
    .replace('{NEXT}', next)
    .replace('{CARDS}', cards)
    .replace('{CATLIST}', catList)
    .replace('{TABLE}', table)
    .replace('{DAILYJSON}', JSON.stringify(data.perDay))
    .replace('{CATJSON}', JSON.stringify(data.perCat))
    .replace('{COLORSJSON}', JSON.stringify(catCol)),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function handleLogout() {
  return new Response('', {
    status: 302,
    headers: { Location: '/dashboard', 'Set-Cookie': 'dash_user=; Path=/; Max-Age=0; HttpOnly' },
  });
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
