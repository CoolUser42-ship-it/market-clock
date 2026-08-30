"use strict";
/* Market Clock — ported from the Claude Design prototype (project/Market Hours.dc.html).
   Same exchange data and time math, rendered as plain DOM instead of the dc-runtime template. */

const EX = [
  { code: 'NYSE', city: 'New York', tz: 'America/New_York', pre: [240, 570], main: [570, 960], post: [960, 1200], lunch: null,
    hol: ['2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15'], early: { '2026-11-27': 780, '2026-12-24': 780 } },
  { code: 'TSX', city: 'Toronto', tz: 'America/Toronto', pre: [420, 570], main: [570, 960], post: [960, 1020], lunch: null,
    hol: ['2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28', '2027-01-01', '2027-02-15'], early: { '2026-12-24': 780 } },
  { code: 'LSE', city: 'London', tz: 'Europe/London', pre: [300, 480], main: [480, 990], post: [990, 1050], lunch: null,
    hol: ['2026-08-31', '2026-12-25', '2026-12-28', '2027-01-01'], early: { '2026-12-24': 750, '2026-12-31': 750 } },
  { code: 'TSE', city: 'Tokyo', tz: 'Asia/Tokyo', pre: null, main: [540, 930], post: null, lunch: [690, 750],
    hol: ['2026-09-21', '2026-09-22', '2026-10-12', '2026-11-03', '2026-11-23', '2026-12-31', '2027-01-01'], early: {} },
  { code: 'HKEX', city: 'Hong Kong', tz: 'Asia/Hong_Kong', pre: [540, 570], main: [570, 960], post: null, lunch: [720, 780],
    hol: ['2026-09-26', '2026-10-19', '2026-12-25', '2027-01-01'], early: { '2026-12-24': 720, '2026-12-31': 720 } },
  { code: 'SGX', city: 'Singapore', tz: 'Asia/Singapore', pre: [510, 540], main: [540, 1020], post: null, lunch: null,
    hol: ['2026-12-25', '2027-01-01'], early: { '2026-12-24': 750, '2026-12-31': 750 } }
];

const MACRO = [
  { at: 810, label: 'US CPI / NFP 13:30' },
  { at: 900, label: 'US ISM 15:00' },
  { at: 1140, label: 'FOMC 19:00' }
];

const HOME = 'Europe/London';

function parts(d, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const h = p.hour === '24' ? 0 : +p.hour;
  return { y: +p.year, mo: +p.month, d: +p.day, h, mi: +p.minute, s: +p.second, wd: p.weekday,
    iso: p.year + '-' + p.month + '-' + p.day, mins: h * 60 + +p.minute };
}
function offset(d, tz) {
  const p = parts(d, tz);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}
function fmt(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function dur(m) {
  if (m < 0) m = 0;
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h > 0 ? h + 'h ' + String(mm).padStart(2, '0') + 'm' : mm + 'm';
}
function wrap(a, b) {
  let s = ((a % 1440) + 1440) % 1440, d = b - a;
  if (d <= 0) return [];
  return s + d > 1440 ? [[s, 1440], [0, Math.min(s + d - 1440, 1440)]] : [[s, s + d]];
}
function pct(v) { return (v / 1440 * 100).toFixed(4) + '%'; }

function dayState(ex, p) {
  if (ex.hol.indexOf(p.iso) >= 0) return { kind: 'holiday' };
  if (p.wd === 'Sat' || p.wd === 'Sun') return { kind: 'weekend' };
  const e = ex.early[p.iso];
  return { kind: e ? 'early' : 'normal', close: e || null };
}

function sw(bg, w) { return { width: w || '16px', height: '11px', background: bg, display: 'inline-block', flex: '0 0 auto', border: '1px solid var(--color-divider)' }; }
function chip(kind) {
  const accent = kind === 'accent';
  return { fontFamily: 'var(--font-heading)', fontSize: '13px', letterSpacing: '.06em', textTransform: 'uppercase', padding: '5px 11px',
    border: '1px solid ' + (accent ? 'var(--color-accent-500)' : 'var(--color-neutral-400)'),
    color: accent ? 'var(--color-accent-800)' : 'var(--color-neutral-800)',
    background: accent ? 'var(--color-accent-100)' : 'transparent' };
}

function computeState(nowMs) {
  const now = new Date(nowMs);
  const showPP = true;
  const hp = parts(now, HOME);
  const homeOff = offset(now, HOME);
  const nowMin = hp.mins + hp.s / 60;

  const cards = [], rows = [], alerts = [], upcoming = [];
  const openSpans = [];

  EX.forEach(ex => {
    const p = parts(now, ex.tz);
    const delta = homeOff - offset(now, ex.tz);
    const ds = dayState(ex, p);
    const mainEnd = ds.close || ex.main[1];
    const trading = ds.kind === 'normal' || ds.kind === 'early';

    let status = 'Closed', tone = 'closed', countdown = '';
    if (ds.kind === 'holiday') { status = 'Holiday'; tone = 'holiday'; }
    else if (ds.kind === 'weekend') { status = 'Weekend'; tone = 'closed'; }
    else if (ex.lunch && p.mins >= ex.lunch[0] && p.mins < ex.lunch[1]) { status = 'Lunch break'; tone = 'lunch'; countdown = 'Resumes in ' + dur(ex.lunch[1] - p.mins); }
    else if (p.mins >= ex.main[0] && p.mins < mainEnd) {
      const inFirst = p.mins < ex.main[0] + 60, inLast = p.mins >= mainEnd - 60;
      status = inFirst ? 'Open · first hour' : inLast ? 'Open · closing hour' : 'Open';
      tone = inFirst || inLast ? 'liquid' : 'open';
      countdown = 'Closes in ' + dur(mainEnd - p.mins);
    }
    else if (showPP && ex.pre && p.mins >= ex.pre[0] && p.mins < ex.pre[1]) { status = 'Pre-market'; tone = 'ext'; countdown = 'Opens in ' + dur(ex.main[0] - p.mins); }
    else if (showPP && ex.post && p.mins >= mainEnd && p.mins < ex.post[1]) { status = 'Post-market'; tone = 'ext'; countdown = 'Closed for the day'; }

    if (!countdown) {
      let add = 0, probe = new Date(now.getTime());
      for (let i = 0; i < 10; i++) {
        const pp = parts(probe, ex.tz);
        const dd = dayState(ex, pp);
        if ((dd.kind === 'normal' || dd.kind === 'early') && (i > 0 || pp.mins < ex.main[0])) {
          add = (i === 0 ? ex.main[0] - pp.mins : (1440 - pp.mins) + (i - 1) * 1440 + ex.main[0]);
          break;
        }
        probe = new Date(probe.getTime() + 86400000);
      }
      countdown = add ? 'Opens in ' + dur(add) : 'Opens next session';
    }

    const toneMap = {
      open: ['var(--color-accent-700)', 'var(--color-accent-700)'],
      liquid: ['var(--color-accent-900)', 'var(--color-accent-900)'],
      lunch: ['var(--color-accent-400)', 'var(--color-accent-700)'],
      ext: ['var(--color-accent-300)', 'var(--color-neutral-700)'],
      holiday: ['var(--color-neutral-500)', 'var(--color-neutral-700)'],
      closed: ['var(--color-neutral-400)', 'var(--color-neutral-600)']
    };
    const tc = toneMap[tone];

    cards.push({
      code: ex.code, city: ex.city,
      time: fmt(p.mins) + ':' + String(p.s).padStart(2, '0'),
      status, countdown,
      sessionLine: fmt(ex.main[0] + delta) + '–' + fmt(mainEnd + delta) + ' London',
      dotStyle: { background: tc[0] },
      statusStyle: { fontFamily: 'var(--font-heading)', fontSize: '14px', letterSpacing: '.06em', textTransform: 'uppercase', color: tc[1] }
    });

    const gridLines = [];
    for (let h = 3; h < 24; h += 3) gridLines.push({ position: 'absolute', top: 0, bottom: 0, left: pct(h * 60), width: '1px', background: 'color-mix(in srgb, var(--color-text) 8%, transparent)' });

    const segments = [];
    const seg = (a, b, style, title) => wrap(a + delta, b + delta).forEach(([s, e]) => {
      segments.push({ title, style: Object.assign({ position: 'absolute', top: 0, bottom: 0, left: pct(s), width: pct(e - s) }, style) });
    });

    if (trading) {
      if (showPP && ex.pre) seg(ex.pre[0], ex.pre[1], { background: 'var(--color-accent-200)', borderRight: '1px solid var(--color-accent-400)' }, ex.code + ' pre-market');
      if (showPP && ex.post) seg(mainEnd, ex.post[1], { background: 'var(--color-accent-200)' }, ex.code + ' post-market');
      const blocks = ex.lunch ? [[ex.main[0], ex.lunch[0]], [ex.lunch[1], mainEnd]] : [[ex.main[0], mainEnd]];
      blocks.forEach(([a, b]) => {
        seg(a, b, { background: 'var(--color-accent-600)' }, ex.code + ' open');
        wrap(a + delta, b + delta).forEach(([s, e]) => openSpans.push([s, e]));
      });
      seg(ex.main[0], Math.min(ex.main[0] + 60, mainEnd), { background: 'var(--color-accent-900)' }, ex.code + ' opening hour');
      seg(Math.max(mainEnd - 60, ex.main[0]), mainEnd, { background: 'var(--color-accent-900)' }, ex.code + ' closing hour');
      if (ex.lunch) seg(ex.lunch[0], ex.lunch[1], { background: 'repeating-linear-gradient(45deg, var(--color-neutral-300) 0 4px, var(--color-neutral-200) 4px 8px)' }, ex.code + ' lunch break');
    } else {
      segments.push({ title: ex.code + ' ' + ds.kind, style: { position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, var(--color-neutral-300) 0 5px, transparent 5px 10px)' } });
    }
    rows.push({ code: ex.code, gridLines, segments });

    if (ds.kind === 'early') alerts.push({ text: ex.code + ' early close today at ' + fmt(mainEnd) + ' local', style: chip('accent') });
    if (ds.kind === 'holiday') alerts.push({ text: ex.code + ' closed today — exchange holiday', style: chip('neutral') });

    const diffNow = offset(now, ex.tz) - homeOff;
    const d21 = new Date(now.getTime() + 21 * 86400000);
    if (offset(d21, ex.tz) - offset(d21, HOME) !== diffNow) {
      let day = null;
      for (let i = 1; i <= 21; i++) {
        const dd = new Date(now.getTime() + i * 86400000);
        if (offset(dd, ex.tz) - offset(dd, HOME) !== diffNow) { day = dd; break; }
      }
      if (day) {
        const label = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        alerts.push({ text: ex.code + ' clock shift vs London on ' + label, style: chip('accent') });
        upcoming.push({ what: ex.code + ' DST shift', when: label, sort: day.getTime() });
      }
    }

    for (let i = 0; i <= 14; i++) {
      const dd = new Date(now.getTime() + i * 86400000);
      const pp = parts(dd, ex.tz);
      if (i > 0 && ex.hol.indexOf(pp.iso) >= 0) upcoming.push({ what: ex.code + ' closed', when: dd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), sort: dd.getTime() });
      else if (i > 0 && ex.early[pp.iso]) upcoming.push({ what: ex.code + ' early close', when: dd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), sort: dd.getTime() });
    }
  });

  const count = m => openSpans.reduce((n, [s, e]) => n + (m >= s && m < e ? 1 : 0), 0);
  const shade = ['var(--color-neutral-100)', 'var(--color-accent-300)', 'var(--color-accent-500)', 'var(--color-accent-700)', 'var(--color-accent-900)'];
  const overlapBlocks = [];
  for (let i = 0; i < 144; i++) {
    const m = i * 10, c = count(m + 5);
    overlapBlocks.push({ title: fmt(m) + ' — ' + c + ' open', style: { flex: '1 1 0', background: shade[Math.min(c, 4)] } });
  }

  const liveCount = count(nowMin);
  const nowOpenNames = EX.filter((ex, i) => cards[i].status.indexOf('Open') === 0).map(ex => ex.code);

  const hourTicks = [];
  for (let h = 0; h <= 24; h += 3) hourTicks.push({
    label: h === 24 ? '24' : String(h).padStart(2, '0'),
    style: { position: 'absolute', left: pct(h * 60), transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)', fontSize: '10.5px', letterSpacing: '.08em', color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums' }
  });

  const lanes = [];
  const macroMarks = MACRO.slice().sort((a, b) => a.at - b.at).map(m => {
    const left = m.at / 1440 * 100;
    const right = left + m.label.length * 0.62;
    let lane = 0;
    while (lanes[lane] !== undefined && lanes[lane] > left) lane++;
    lanes[lane] = right;
    return {
      label: m.label,
      style: { position: 'absolute', top: (lane * 13) + 'px', left: pct(m.at), fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--color-accent-700)', borderLeft: '1px solid var(--color-accent-500)', paddingLeft: '4px', whiteSpace: 'nowrap' }
    };
  });

  return {
    homeTime: fmt(hp.mins) + ':' + String(hp.s).padStart(2, '0'),
    homeDate: now.toLocaleDateString('en-GB', { timeZone: HOME, weekday: 'short', day: 'numeric', month: 'short' }),
    homeZone: homeOff === 60 ? 'BST' : 'GMT',
    cards, rows, overlapBlocks, hourTicks, macroMarks,
    alerts, hasAlerts: alerts.length > 0,
    nowLineStyle: { position: 'absolute', top: '-2px', bottom: '-2px', left: pct(nowMin), width: '2px', background: 'var(--color-text)', zIndex: 5 },
    openCount: liveCount === 0 ? 'None' : String(liveCount),
    openList: nowOpenNames.length ? nowOpenNames.join(' · ') + ' trading now' : 'No main sessions open. Extended-hours books may still be live.',
    liquidityNote: liveCount >= 2 ? 'Overlap in progress — deepest books of the day.' : liveCount === 1 ? 'Single-session liquidity.' : 'Thin conditions; expect wider spreads.',
    overlapWindows: [
      { name: 'Tokyo × Hong Kong × Singapore', range: '02:00 – 07:00' },
      { name: 'Hong Kong × London', range: '08:00 – 09:00' },
      { name: 'London × New York / Toronto', range: '14:30 – 16:30' },
      { name: 'US closing hour (alone)', range: '20:00 – 21:00' }
    ],
    upcoming: upcoming.sort((a, b) => a.sort - b.sort).slice(0, 6),
    legend: [
      { label: 'Open', swatch: sw('var(--color-accent-600)') },
      { label: 'First / last hour', swatch: sw('var(--color-accent-900)') },
      { label: 'Pre / post', swatch: sw('var(--color-accent-200)') },
      { label: 'Lunch break', swatch: sw('repeating-linear-gradient(45deg, var(--color-neutral-300) 0 4px, var(--color-neutral-200) 4px 8px)') },
      { label: 'Closed / holiday', swatch: sw('repeating-linear-gradient(45deg, var(--color-neutral-300) 0 5px, var(--color-neutral-100) 5px 10px)') },
      { label: 'Now', swatch: sw('var(--color-text)', '2px') }
    ]
  };
}

const css = obj => Object.entries(obj).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';');
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const els = {
  homeTime: document.getElementById('home-time'),
  homeMeta: document.getElementById('home-meta'),
  alerts: document.getElementById('alerts'),
  cards: document.getElementById('cards'),
  mapInner: document.getElementById('map-inner'),
  legend: document.getElementById('legend'),
  openCount: document.getElementById('open-count'),
  openList: document.getElementById('open-list'),
  liquidityNote: document.getElementById('liquidity-note'),
  overlapWindows: document.getElementById('overlap-windows'),
  upcoming: document.getElementById('upcoming')
};

let legendBuilt = false, overlapWindowsBuilt = false;

function render(v) {
  els.homeTime.textContent = v.homeTime;
  els.homeMeta.textContent = v.homeDate + ' · ' + v.homeZone;

  els.alerts.hidden = !v.hasAlerts;
  if (v.hasAlerts) {
    els.alerts.innerHTML = v.alerts.map(a => `<div style="${css(a.style)}">${escapeHtml(a.text)}</div>`).join('');
  }

  els.cards.innerHTML = v.cards.map(c => `
    <div class="blueprint card-tile">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="card-head">
        <div class="card-code">${c.code}</div>
        <div class="card-city">${c.city}</div>
      </div>
      <div class="card-time">${c.time}</div>
      <div class="card-status-row">
        <span class="dot" style="${css(c.dotStyle)}"></span>
        <span style="${css(c.statusStyle)}">${c.status}</span>
      </div>
      <div class="card-countdown">${c.countdown}</div>
      <div class="card-session-line">${c.sessionLine}</div>
    </div>
  `).join('');

  const ticksHtml = `
    <div class="map-row">
      <div></div>
      <div class="ticks">
        ${v.hourTicks.map(t => `<div style="${css(t.style)}">${t.label}</div>`).join('')}
      </div>
    </div>`;

  const rowsHtml = v.rows.map(r => `
    <div class="map-row">
      <div class="row-label">${r.code}</div>
      <div class="track">
        ${r.gridLines.map(g => `<div style="${css(g)}"></div>`).join('')}
        ${r.segments.map(s => `<div title="${escapeHtml(s.title || '')}" style="${css(s.style)}"></div>`).join('')}
        <div style="${css(v.nowLineStyle)}"></div>
      </div>
    </div>`).join('');

  const overlapHtml = `
    <div class="map-row overlap-row-wrap">
      <div class="row-label overlap-label">OVERLAP</div>
      <div class="overlap-row">
        ${v.overlapBlocks.map(b => `<div title="${escapeHtml(b.title)}" style="${css(b.style)}"></div>`).join('')}
        <div style="${css(v.nowLineStyle)}"></div>
      </div>
    </div>`;

  const macroHtml = `
    <div class="map-row macro-row-wrap">
      <div class="row-label macro-label">DATA</div>
      <div class="macro-row">
        ${v.macroMarks.map(m => `<div style="${css(m.style)}">${escapeHtml(m.label)}</div>`).join('')}
      </div>
    </div>`;

  els.mapInner.innerHTML = ticksHtml + rowsHtml + overlapHtml + macroHtml;

  if (!legendBuilt) {
    els.legend.innerHTML = v.legend.map(l => `
      <div class="legend-item"><span class="swatch" style="${css(l.swatch)}"></span>${escapeHtml(l.label)}</div>
    `).join('');
    legendBuilt = true;
  }

  els.openCount.textContent = v.openCount;
  els.openList.textContent = v.openList;
  els.liquidityNote.textContent = v.liquidityNote;

  if (!overlapWindowsBuilt) {
    els.overlapWindows.innerHTML = v.overlapWindows.map(w => `
      <div class="kv-row"><span class="label">${escapeHtml(w.name)}</span><span class="value">${escapeHtml(w.range)}</span></div>
    `).join('');
    overlapWindowsBuilt = true;
  }

  els.upcoming.innerHTML = v.upcoming.length
    ? v.upcoming.map(u => `
      <div class="kv-row"><span class="label">${escapeHtml(u.what)}</span><span class="value">${escapeHtml(u.when)}</span></div>
    `).join('')
    : `<div class="kv-row"><span class="label">Nothing scheduled</span></div>`;
}

function tick() { render(computeState(Date.now())); }
tick();
setInterval(tick, 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
