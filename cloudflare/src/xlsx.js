/* =====================================================================
   xlsx.js — Pembuat file .xlsx (murni JS, tanpa dependency).
   Tema & gaya dipusatkan di objek THEME agar mudah diubah.
   Mendukung: freeze panes, zoom, gridlines off, page setup, tab color,
   AutoFilter, sel rumus (dengan cached value), tipe tanggal, format
   angka kustom (Rp / persen), dan grafik tertanam (bar/line/doughnut)
   dengan twoCellAnchor.
   ===================================================================== */

/* ---------- TEMA (satu tempat untuk semua warna/font) ---------- */
const THEME = {
  font: 'Calibri',
  navy: 'FF1F3A5F',
  blue: 'FF2E75B6',
  green: 'FF2E8B57',
  red: 'FFC0392B',
  bg: 'FFF5F7FA',
  border: 'FFD9DEE5',
  text: 'FF222222',
  label: 'FF6B7280',
  zebra: 'FFEDF1F4',
  white: 'FFFFFFFF',
};

/* ---------- CRC32 (untuk ZIP) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameU = new Uint8Array(enc.encode(e.name));
    const data = e.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameU.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameU, data);
    central.push({ nameU, crc, size: data.length, offset });
    offset += 30 + nameU.length + data.length;
  }
  const cdStart = offset;
  const cdChunks = [];
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true);
    ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.nameU.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, c.offset, true);
    cdChunks.push(new Uint8Array(ch.buffer), c.nameU);
  }
  const cdSize = cdChunks.reduce((a, c) => a + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);
  const total = chunks.reduce((a, c) => a + c.length, 0) + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of cdChunks) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(eocd.buffer), p);
  return out;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = (s) => new TextEncoder().encode(s);
const xml = (s) => enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);

/* ---------- tipe data ---------- */
// 'YYYY-MM-DD' -> serial Excel (hari sejak 1899-12-30)
function dateSerial(ymd) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const epoch = Date.UTC(1899, 11, 30);
  return Math.floor((Date.UTC(y, mo - 1, d) - epoch) / 86400000);
}

/* ---------- sel ---------- */
// v: nilai; s: style index; opts: { f: formula, date: bool }
function cell(ref, v, s, opts) {
  opts = opts || {};
  const st = s || 0;
  if (opts.f) {
    const cached = v == null ? 0 : v;
    return `<c r="${ref}" s="${st}"><f>${opts.f}</f><v>${cached}</v></c>`;
  }
  if (typeof v === 'number') {
    return `<c r="${ref}" s="${st}" t="n"><v>${v}</v></c>`;
  }
  if (opts.date || v instanceof Date) {
    const serial = v instanceof Date ? Math.floor((v - Date.UTC(1899, 11, 30)) / 86400000) : dateSerial(v);
    return `<c r="${ref}" s="${st}" t="n"><v>${serial}</v></c>`;
  }
  const text = v == null ? '' : String(v);
  if (!text) return `<c r="${ref}" s="${st}"/>`;
  return `<c r="${ref}" s="${st}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`;
}

function col(ref, w) {
  return `<col min="${ref}" max="${ref}" width="${w}" customWidth="1"/>`;
}

/* ---------- worksheet ---------- */
// rows: array of row; tiap row = array [ [val, style, opts?] | val ]
function sheetXml(rows, opts) {
  opts = opts || {};
  const colWidths = opts.widths || null;
  const merges = opts.merges || [];
  const drawingRid = opts.drawingRid || null;
  const rowHeights = opts.rowHeights || null;
  const tabColor = opts.tabColor || null;
  const autofilter = opts.autofilter || null;
  const maxR = rows.length;
  let maxC = 0;
  rows.forEach((r) => { maxC = Math.max(maxC, r.length); });
  const refEnd = (maxC ? String.fromCharCode(64 + maxC) : 'A') + (maxR || 1);
  let cols = '';
  if (colWidths) {
    for (const k in colWidths) {
      const ci = k.charCodeAt(0) - 64;
      cols += col(ci, colWidths[k]);
    }
  }
  let mer = '';
  if (merges.length) mer = `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
  const draw = drawingRid ? `<drawing r:id="${drawingRid}"/>` : '';
  let sd = '';
  rows.forEach((r, i) => {
    const rn = i + 1;
    let cells = '';
    r.forEach((c, j) => {
      const cn = String.fromCharCode(65 + j);
      if (c === undefined || c === null) return;
      if (Array.isArray(c)) {
        const [val, st, copts] = c;
        cells += cell(cn + rn, val, st, copts);
      } else {
        cells += cell(cn + rn, c, 0);
      }
    });
    const ht = rowHeights ? rowHeights[rn] : null;
    const attrs = ht ? ` ht="${ht}" customHeight="1"` : '';
    sd += `<row r="${rn}"${attrs}>${cells}</row>`;
  });

  // sheetPr (tab color, fit-to-page)
  let spr = '';
  if (tabColor) spr = `<tabColor rgb="${tabColor}"/>`;
  const fit = opts.fitToWidth ? `<pageSetup orientation="${opts.orientation || 'landscape'}" fitToWidth="1" fitToHeight="0"/>` : (opts.orientation ? `<pageSetup orientation="${opts.orientation}"/>` : '');
  const pm = opts.margins ? `<pageMargins ${opts.margins}/>` : '';
  const sheetPrInner = (tabColor ? `<tabColor rgb="${tabColor}"/>` : '') + (fit ? '<pageSetUpPr fitToPage="1"/>' : '');
  let sprBlock = '';
  if (tabColor || fit) sprBlock = `<sheetPr>${sheetPrInner}</sheetPr>`;

  // sheetView: gridlines off, zoom, freeze
  const showGrid = opts.showGrid === false ? ' showGridLines="0"' : '';
  const zoom = opts.zoom ? ` zoomScale="${opts.zoom}" zoomScaleNormal="${opts.zoom}"` : '';
  let pane = '';
  if (opts.freeze) {
    const f = opts.freeze;
    const attrs = [];
    if (f.col > 0) attrs.push(`xSplit="${f.col}"`);
    if (f.row > 0) attrs.push(`ySplit="${f.row}"`);
    const tl = (f.col > 0 ? String.fromCharCode(65 + f.col) : 'A') + (f.row + 1);
    attrs.push(`topLeftCell="${tl}"`);
    attrs.push('activePane="bottomRight"');
    attrs.push('state="frozen"');
    pane = `<pane ${attrs.join(' ')}/>`;
  }
  const view = `<sheetView workbookViewId="0"${showGrid}${zoom}>${pane}</sheetView>`;
  const af = autofilter ? `<autoFilter ref="${autofilter}"/>` : '';
  const pageSetup = fit || opts.orientation ? fit : '';

  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${sprBlock}
<dimension ref="A1:${refEnd}"/>
<sheetViews>${view}</sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${sd}</sheetData>
${mer}
${af}
${pm}
${pageSetup}
${draw}
</worksheet>`);
}

/* ---------- styles (dibangun dari TEMA) ---------- */
function stylesXml() {
  const F = THEME.font;
  const fonts = [
    `<font><sz val="11"/><name val="${F}"/></font>`,                                                // 0 normal
    `<font><b/><sz val="11"/><color rgb="${THEME.white}"/><name val="${F}"/></font>`,                // 1 white bold
    `<font><b/><sz val="20"/><color rgb="${THEME.white}"/><name val="${F}"/></font>`,                // 2 hero bold
    `<font><sz val="11"/><color rgb="${THEME.label}"/><name val="${F}"/></font>`,                    // 3 label gray
    `<font><b/><sz val="22"/><color rgb="${THEME.text}"/><name val="${F}"/></font>`,                 // 4 KPI value bold
    `<font><b/><sz val="11"/><color rgb="${THEME.text}"/><name val="${F}"/></font>`,                 // 5 table total bold
    `<font><sz val="11"/><color rgb="${THEME.red}"/><name val="${F}"/></font>`,                      // 6 red text
  ];
  const fills = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.navy}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.bg}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.green}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.red}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.blue}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FF4B5563"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.white}"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${THEME.zebra}"/></patternFill></fill>`,
  ];
  const borderThin = `<border><left style="thin"><color rgb="${THEME.border}"/></left><right style="thin"><color rgb="${THEME.border}"/></right><top style="thin"><color rgb="${THEME.border}"/></top><bottom style="thin"><color rgb="${THEME.border}"/></bottom><diagonal/></border>`;
  const borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`, borderThin];
  const AL = ' applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
  const ALR = ' applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>';
  // numFmts: id 164 = Rp, 165 = persen, 166 = tanggal
  const xfs = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${AL}`,
    `<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"${AL}`,
    `<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${AL}`,
    `<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${AL}`,
    `<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="165" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"${AL}`,
    `<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="164" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="164" fontId="6" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="3" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${ALR}`,
  ];

  return xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode='"Rp "#,##0'/>
<numFmt numFmtId="165" formatCode="0.0%"/>
<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>
</numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
}

/* ---------- workbook / rels / content types ---------- */
function workbookXml(sheets) {
  const list = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="32000" windowHeight="18000"/></bookViews>
<sheets>${list}</sheets>
</workbook>`);
}

const RT = {
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  drawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
};

function workbookRels(sheets, drawingHosts) {
  let items = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${RT.worksheet}" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  let base = sheets.length;
  for (let k = 0; k < drawingHosts.length; k++) {
    items += `<Relationship Id="rId${base + 1 + k}" Type="${RT.drawing}" Target="drawings/drawing${drawingHosts[k].drawingId}.xml"/>`;
  }
  items += `<Relationship Id="rId${base + drawingHosts.length + 1}" Type="${RT.styles}" Target="styles.xml"/>`;
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`);
}

function sheetRels(drawingId) {
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT.drawing}" Target="../drawings/drawing${drawingId}.xml"/></Relationships>`);
}

function drawingRels(count) {
  let items = '';
  for (let i = 1; i <= count; i++) items += `<Relationship Id="rId${i}" Type="${RT.chart}" Target="../charts/chart${i}.xml"/>`;
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`);
}

function chartRels(dataSheetTarget) {
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT.worksheet}" Target="${dataSheetTarget}"/></Relationships>`);
}

function rootRels() {
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${RT.core}" Target="docProps/core.xml"/></Relationships>`);
}

function contentTypes(sheets, chartCount, drawingIds) {
  let ov = sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  for (let i = 1; i <= chartCount; i++) ov += `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
  for (const d of drawingIds) ov += `<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
  return xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${ov}
</Types>`);
}

function coreProps(title, creator) {
  return xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title>
<dc:creator>${esc(creator)}</dc:creator>
<cp:lastModifiedBy>${esc(creator)}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`);
}

/* ---------- chart (bar/line/doughnut) ---------- */
function chartXml(type, title, catSheet, catRange, series, opts) {
  opts = opts || {};
  const lgPos = opts.legendPos || 'b';
  const serXml = series.map((s, i) => {
    const catF = `'${catSheet}'!${catRange}`;
    const valF = `'${s.sheet}'!${s.range}`;
    const nameStr = `<c:tx><c:strRef><c:f>'${s.sheet}'!${s.nameCell}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
    let prep = '';
    let post = '';
    if (type === 'line') {
      const ln = `<c:spPr><a:ln w="${opts.lineW || 28575}"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:ln></c:spPr>`;
      const marker = `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr></c:marker>`;
      prep = ln + marker;
      post = '<c:smooth val="0"/>';
    } else if (type === 'bar') {
      if (s.color) prep = `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr>`;
    } else if (type === 'doughnut') {
      prep = '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>';
    }
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${nameStr}${prep}<c:cat><c:strRef><c:f>${catF}</c:f><c:strCache><c:ptCount val="0"/></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${valF}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="0"/></c:numCache></c:numRef></c:val>${post}</c:ser>`;
  }).join('');

  const axTitle = '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Juta Rp</a:t></a:r></a:p></c:rich></c:tx><c:layout/></c:title>';
  const catRot = '<c:txPr><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:pPr algn="r"/><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  let plot;
  let axes = '';
  if (type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${serXml}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`;
  } else if (type === 'doughnut') {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${serXml}<c:holeSize val="${opts.hole || 55}"/></c:doughnutChart>`;
  } else {
    plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${serXml}<c:gapWidth val="${opts.gap || 70}"/><c:axId val="1"/><c:axId val="2"/></c:barChart>`;
  }
  if (type !== 'doughnut') {
    axes = `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>${catRot}</c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>${axTitle}<c:numFmt formatCode="#,##0,," sourceLinked="0"/></c:valAx>`;
  }

  return xml(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:date1904 val="0"/>
<c:lang val="en-US"/>
<c:chart>
<c:autoTitleDeleted val="0"/>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/></c:title>
<c:plotArea>
<c:layout/>
${plot}
${axes}
</c:plotArea>
<c:legend><c:legendPos val="${lgPos}"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`);
}

/* ---------- drawing (grafik tertanam) ---------- */
function drawingXml(anchors) {
  let body = '';
  anchors.forEach((a, i) => {
    const rid = 'rId' + (i + 1);
    const nv = `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`;
    const gf = `<xdr:graphicFrame macro="">${nv}<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
    if (a.to) {
      body += `<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${a.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${a.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
${gf}
<xdr:clientData/>
</xdr:twoCellAnchor>`;
    } else {
      body += `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${a.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:ext cx="${a.cx}" cy="${a.cy}"/>
${gf}
<xdr:clientData/>
</xdr:oneCellAnchor>`;
    }
  });
  return xml(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</xdr:wsDr>`);
}

/* ---------- API utama ---------- */
// cfg: { sheets:[{name,rows,widths,merges,rowHeights,opts}], charts:[{type,title,host,catSheet,catRange,series,anchor}], title, creator }
function buildXlsx(cfg) {
  const sheets = cfg.sheets;
  const charts = cfg.charts || [];

  const hosts = new Map();
  charts.forEach((ch, ci) => {
    const idx = sheets.findIndex((s) => s.name === ch.host);
    if (idx < 0) return;
    if (!hosts.has(idx)) hosts.set(idx, []);
    hosts.get(idx).push({ ch, chartIdx: ci });
  });

  const drawingHosts = [];
  let drawingCounter = 0;
  hosts.forEach((list, sheetIdx) => {
    drawingCounter++;
    const anchors = list.map((x) => ({ ...x.ch.anchor, chartIdx: x.chartIdx }));
    drawingHosts.push({ sheetIndex: sheetIdx, drawingId: drawingCounter, anchors });
  });
  const nChart = charts.length;

  const entries = [];
  entries.push({ name: '[Content_Types].xml', data: contentTypes(sheets, nChart, drawingHosts.map((d) => d.drawingId)) });
  entries.push({ name: '_rels/.rels', data: rootRels() });
  entries.push({ name: 'docProps/core.xml', data: coreProps(cfg.title || 'Dashboard Pengeluaran', cfg.creator || 'Pengeluaran Bot') });
  entries.push({ name: 'xl/workbook.xml', data: workbookXml(sheets) });
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: workbookRels(sheets, drawingHosts) });
  entries.push({ name: 'xl/styles.xml', data: stylesXml() });

  sheets.forEach((s, i) => {
    const idx = i + 1;
    const dh = drawingHosts.find((d) => d.sheetIndex === i);
    const opts = Object.assign({}, s.opts, { widths: s.widths, merges: s.merges, rowHeights: s.rowHeights });
    if (dh) opts.drawingRid = 'rId1';
    entries.push({ name: `xl/worksheets/sheet${idx}.xml`, data: sheetXml(s.rows, opts) });
    if (dh) entries.push({ name: `xl/worksheets/_rels/sheet${idx}.xml.rels`, data: sheetRels(dh.drawingId) });
  });

  for (const d of drawingHosts) {
    entries.push({ name: `xl/drawings/drawing${d.drawingId}.xml`, data: drawingXml(d.anchors) });
    entries.push({ name: `xl/drawings/_rels/drawing${d.drawingId}.xml.rels`, data: drawingRels(d.anchors.length) });
  }

  charts.forEach((ch, ci) => {
    const dataSheetIndex = sheets.findIndex((x) => x.name === ch.catSheet);
    const dataTarget = `../worksheets/sheet${dataSheetIndex + 1}.xml`;
    entries.push({ name: `xl/charts/chart${ci + 1}.xml`, data: chartXml(ch.type, ch.title, ch.catSheet, ch.catRange, ch.series, ch.opts) });
    entries.push({ name: `xl/charts/_rels/chart${ci + 1}.xml.rels`, data: chartRels(dataTarget) });
  });

  return zipStore(entries);
}

export { buildXlsx, THEME, dateSerial };
