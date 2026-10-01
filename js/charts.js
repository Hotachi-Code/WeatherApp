/**
 * charts.js — Könyvtár nélküli SVG diagramok.
 *
 * Három forma, mindegyiknek egy dolga van:
 *   • ensembleBand   — idősor bizonytalansági sávval (a szórás maga az üzenet)
 *   • agreementBars  — óránkénti egyetértés/valószínűség, nagyságrend szerint
 *   • deviationDots  — modellenkénti eltérés a konszenzustól, kétpólusú skálán
 *
 * A színek szerepekhez kötöttek (CSS-változók), nem konkrét hexekhez, így
 * a világos és sötét téma ugyanabból a rendszerből kap értéket.
 */

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  return n;
};

const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d).replace('.', ','));

/** Egyszerű, megosztott tooltip-réteg. */
function ensureTooltip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
  }
  return tip;
}

function placeTip(container, tip, x, y) {
  const w = container.clientWidth;
  tip.style.left = `${Math.max(4, Math.min(w - tip.offsetWidth - 4, x - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(2, y)}px`;
}

/* ------------------------------------------------------------------ */
/* 1. Ensemble-sáv: konszenzus vonal + bizonytalansági tartományok      */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLElement} container
 * @param {object} spec
 *   points: [{ label, sub, mean, p10, p90, min, max, extra }]
 *   unit:   mértékegység a tooltipben
 *   height: px
 */
export function ensembleBand(container, spec) {
  const { points, unit = '', height = 190, showMinMax = true } = spec;
  container.innerHTML = '';
  const tip = ensureTooltip(container);

  const valid = points.filter((p) => p.mean != null);
  if (valid.length < 2) {
    container.innerHTML = '<p class="chart-empty">Nincs elég adat a diagramhoz.</p>';
    return;
  }

  const padL = 34;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  // Óránként legalább 12 px: így a 24 órás alapnézet még a legkeskenyebb
  // telefonra is kifér, a hosszabb távok pedig vízszintesen görgethetők.
  const stepX = Math.max(12, Math.min(46, Math.round((container.clientWidth - padL - padR) / Math.max(1, points.length - 1))));
  const width = padL + padR + stepX * (points.length - 1);

  const lows = points.map((p) => (showMinMax ? p.min : p.p10)).filter((v) => v != null);
  const highs = points.map((p) => (showMinMax ? p.max : p.p90)).filter((v) => v != null);
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const X = (i) => padL + i * stepX;
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);

  const svg = el('svg', {
    class: 'chart chart-band',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': spec.ariaLabel || 'Előrejelzés bizonytalansági sávval',
  });

  /* Rácsvonalak — visszafogottan, csak tájékozódáshoz. */
  const ticks = niceTicks(lo, hi, 5);
  for (const t of ticks) {
    svg.appendChild(el('line', { class: 'grid', x1: padL, x2: width - padR, y1: Y(t), y2: Y(t) }));
    const label = el('text', { class: 'axis', x: 4, y: Y(t) + 4 });
    label.textContent = num(t, Math.abs(hi - lo) < 5 ? 1 : 0);
    svg.appendChild(label);
  }

  /* Éjszakai sávok, ha meg van adva. */
  points.forEach((p, i) => {
    if (!p.night) return;
    const x0 = X(i) - stepX / 2;
    svg.appendChild(el('rect', { class: 'night', x: Math.max(padL, x0), y: padT, width: stepX, height: height - padT - padB }));
  });

  /* Min–max tartomány (a teljes mezőny), majd a p10–p90 (a középső 80%). */
  const area = (loKey, hiKey, cls) => {
    const up = [];
    const down = [];
    points.forEach((p, i) => {
      if (p[loKey] == null || p[hiKey] == null) return;
      up.push(`${X(i)},${Y(p[hiKey])}`);
      down.unshift(`${X(i)},${Y(p[loKey])}`);
    });
    if (!up.length) return;
    svg.appendChild(el('polygon', { class: cls, points: [...up, ...down].join(' ') }));
  };
  if (showMinMax) area('min', 'max', 'band band-outer');
  area('p10', 'p90', 'band band-inner');

  /* A konszenzus vonala. */
  const line = points
    .map((p, i) => (p.mean == null ? null : `${i === 0 || points[i - 1].mean == null ? 'M' : 'L'}${X(i)},${Y(p.mean)}`))
    .filter(Boolean)
    .join(' ');
  svg.appendChild(el('path', { class: 'series-line', d: line }));

  /* X tengely feliratok — minden n-edik, hogy ne érjenek össze. */
  const every = Math.max(1, Math.ceil(56 / stepX));
  points.forEach((p, i) => {
    if (i % every) return;
    const t = el('text', { class: 'axis axis-x', x: X(i), y: height - 8, 'text-anchor': 'middle' });
    t.textContent = p.label;
    svg.appendChild(t);
  });

  /* "Most" jelölés. */
  const nowIdx = points.findIndex((p) => p.isNow);
  if (nowIdx >= 0) {
    svg.appendChild(el('line', { class: 'now-line', x1: X(nowIdx), x2: X(nowIdx), y1: padT, y2: height - padB }));
  }

  /* Interakció: függőleges célkereszt + tooltip. */
  const cross = el('line', { class: 'crosshair', y1: padT, y2: height - padB, x1: 0, x2: 0 });
  cross.setAttribute('opacity', '0');
  const dot = el('circle', { class: 'crosshair-dot', r: 4.5, cx: 0, cy: 0, opacity: 0 });
  svg.appendChild(cross);
  svg.appendChild(dot);

  const wrap = document.createElement('div');
  wrap.className = 'chart-scroll';
  wrap.appendChild(svg);
  container.appendChild(wrap);

  const pick = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((x - padL) / stepX)));
    return i;
  };

  const show = (evt) => {
    const i = pick(evt.clientX);
    const p = points[i];
    if (!p || p.mean == null) return;
    cross.setAttribute('x1', X(i));
    cross.setAttribute('x2', X(i));
    cross.setAttribute('opacity', '1');
    dot.setAttribute('cx', X(i));
    dot.setAttribute('cy', Y(p.mean));
    dot.setAttribute('opacity', '1');
    tip.hidden = false;
    tip.innerHTML =
      `<strong>${p.sub || p.label}</strong>` +
      `<span class="tip-main">${num(p.mean, 1)} ${unit}</span>` +
      `<span class="tip-range">reálisan ${num(p.p10, 1)} – ${num(p.p90, 1)} ${unit}</span>` +
      (p.extra ? `<span class="tip-extra">${p.extra}</span>` : '');
    const r = svg.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    placeTip(container, tip, r.left - cr.left + X(i), Math.max(0, Y(p.mean) - 8));
  };

  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
  };

  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
  wrap.addEventListener('scroll', hide, { passive: true });
}

/* ------------------------------------------------------------------ */
/* 2. Egyetértés-oszlopok                                              */
/* ------------------------------------------------------------------ */

/**
 * Nagyságrendet mutat (0–1), egyetlen kék színátmenettel: minél nagyobb
 * az érték, annál telítettebb az oszlop. Az oszlopok a nullvonalhoz
 * kötöttek, tetejük 4 px-en lekerekített, köztük 2 px felületrés.
 */
export function agreementBars(container, spec) {
  const { points, height = 76, unit = '%', labelEvery = 6 } = spec;
  container.innerHTML = '';
  const tip = ensureTooltip(container);
  if (!points.length) {
    container.innerHTML = '<p class="chart-empty">Nincs adat.</p>';
    return;
  }

  // Ha egyetlen forrás sem jelez semmit, egy üres diagram helyett
  // mondjuk ki: ez maga is információ, nem hiányzó adat.
  const peak = Math.max(...points.map((p) => p.value ?? 0));
  if (peak < 0.02) {
    container.innerHTML = `<p class="chart-empty">${
      spec.emptyText || 'Egyetlen forrás sem jelez csapadékot ebben az időszakban.'
    }</p>`;
    return;
  }

  const padT = 8;
  const padB = 18;
  const stepX = Math.max(12, Math.min(46, Math.round(container.clientWidth / points.length)));
  const barW = Math.max(6, stepX - 2); // 2 px felületrés a szomszédos oszlopok közt
  const width = stepX * points.length;
  const plotH = height - padT - padB;

  const svg = el('svg', {
    class: 'chart chart-bars',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': spec.ariaLabel || 'Óránkénti valószínűség',
  });

  svg.appendChild(el('line', { class: 'baseline', x1: 0, x2: width, y1: height - padB, y2: height - padB }));

  points.forEach((p, i) => {
    const v = p.value == null ? 0 : Math.max(0, Math.min(1, p.value));
    const h = Math.max(v > 0 ? 2 : 0, v * plotH);
    const x = i * stepX + (stepX - barW) / 2;
    const y = height - padB - h;
    if (h > 0) {
      const rect = el('rect', {
        class: 'bar',
        x,
        y,
        width: barW,
        height: h,
        rx: Math.min(4, h / 2),
        style: `fill: ${rampBlue(v)}`,
      });
      rect.dataset.i = String(i);
      svg.appendChild(rect);
    }
    // Érintési célpont: a teljes oszlopsáv, nem csak a látható oszlop.
    const hit = el('rect', { class: 'bar-hit', x: i * stepX, y: 0, width: stepX, height });
    hit.dataset.i = String(i);
    svg.appendChild(hit);

    if (i % labelEvery === 0) {
      const t = el('text', { class: 'axis axis-x', x: i * stepX + stepX / 2, y: height - 5, 'text-anchor': 'middle' });
      t.textContent = p.label;
      svg.appendChild(t);
    }

  });

  const wrap = document.createElement('div');
  wrap.className = 'chart-scroll';
  wrap.appendChild(svg);
  container.appendChild(wrap);

  const onMove = (evt) => {
    const target = evt.target.closest('[data-i]');
    if (!target) return;
    const p = points[Number(target.dataset.i)];
    if (!p) return;
    tip.hidden = false;
    tip.innerHTML =
      `<strong>${p.sub || p.label}</strong>` +
      `<span class="tip-main">${p.value == null ? '–' : Math.round(p.value * 100)} ${unit}</span>` +
      (p.extra ? `<span class="tip-extra">${p.extra}</span>` : '');
    const r = target.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    placeTip(container, tip, r.left - cr.left + r.width / 2, 0);
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onMove);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  wrap.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
}

/** Kék szekvenciális rámpa 0–1 nagysághoz (világos → sötét). */
function rampBlue(v) {
  const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#256abf', '#184f95'];
  const darkSteps = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef'];
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const list = isDark ? darkSteps : steps;
  const i = Math.min(list.length - 1, Math.max(0, Math.round(v * (list.length - 1))));
  return list[i];
}

/* ------------------------------------------------------------------ */
/* 3. Eltérés-pontok: ki mennyivel tér el a konszenzustól              */
/* ------------------------------------------------------------------ */

/**
 * Kétpólusú (diverging) skála: a hidegebb becslés kék, a melegebb piros,
 * a nulla körül semleges szürke. A polaritás itt a lényeg, ezért nem
 * kategorikus színezés.
 */
export function deviationDots(container, rows, { unit = '°C', maxAbs = null } = {}) {
  container.innerHTML = '';
  const usable = rows.filter((r) => r.available && r.deviation != null);
  if (!usable.length) {
    container.innerHTML = '<p class="chart-empty">Nincs összehasonlítható forrás.</p>';
    return;
  }
  const lim = maxAbs || Math.max(0.5, ...usable.map((r) => Math.abs(r.deviation))) * 1.15;

  const list = document.createElement('div');
  list.className = 'dev-list';

  for (const r of usable) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    const pos = 50 + (r.deviation / lim) * 50;
    row.innerHTML = `
      <span class="dev-name">${r.model.flag} ${r.model.short}</span>
      <span class="dev-track" role="img" aria-label="${r.deviation > 0 ? '+' : ''}${num(r.deviation, 1)} ${unit} eltérés">
        <span class="dev-zero"></span>
        <span class="dev-dot${r.outlier ? ' is-outlier' : ''}" style="left:${pos}%; background:${divergingColor(r.deviation / lim)}"></span>
      </span>
      <span class="dev-val">${r.deviation > 0 ? '+' : ''}${num(r.deviation, 1)}</span>
      <span class="dev-weight">${Math.round(r.share * 100)}%</span>
    `;
    list.appendChild(row);
  }
  container.appendChild(list);
}

/** Kék ↔ szürke ↔ piros, a −1…+1 normalizált eltéréshez. */
function divergingColor(t) {
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const neutral = isDark ? '#383835' : '#f0efec';
  const cool = ['#9ec5f4', '#3987e5', '#1c5cab'];
  const warm = ['#f0a6a6', '#e34948', '#b12f2f'];
  const a = Math.min(1, Math.abs(t));
  if (a < 0.18) return neutral;
  const list = t < 0 ? cool : warm;
  return list[Math.min(list.length - 1, Math.floor((a - 0.18) / 0.28))];
}

/* ------------------------------------------------------------------ */
/* Segéd                                                               */
/* ------------------------------------------------------------------ */

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return [lo];
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
