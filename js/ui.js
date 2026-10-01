/**
 * ui.js — Megjelenítés.
 *
 * Az időbélyegek a HELY helyi idejében érkeznek (naiv ISO-string), ezért
 * mindenhol UTC-ként olvassuk és UTC-ként formázzuk őket. Így a telefon
 * saját időzónája nem tolja el a másik országra kért előrejelzést.
 */

import { VARS } from './config.js';
import { membersAt, dayMembers } from './ensemble.js';
import { ensembleBand, agreementBars, deviationDots } from './charts.js';
import {
  precipSentence, tempSentence, weatherSentence, confidenceExplanation,
  calibrationSummary, listNames, num, pct,
} from './narrative.js';

const DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const DAYS_SHORT = ['vas', 'hét', 'kedd', 'szer', 'csüt', 'pén', 'szo'];
const MONTHS = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

const asDate = (iso) => new Date(Date.parse(`${iso.length === 10 ? `${iso}T00:00` : iso}:00Z`));
const hourLabel = (iso) => `${asDate(iso).getUTCHours()}`;
const dayShort = (iso) => DAYS_SHORT[asDate(iso).getUTCDay()];
const dayLong = (iso) => DAYS[asDate(iso).getUTCDay()];
const dateShort = (iso) => {
  const d = asDate(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}.`;
};
const isNight = (iso) => {
  const h = asDate(iso).getUTCHours();
  return h < 6 || h >= 20;
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Megbízhatósági jelvény — szín SOHA nem önmagában hordozza a jelentést. */
export function confBadge(conf) {
  return `<span class="conf" data-status="${conf.status}">
    <span class="conf-mark" aria-hidden="true">${conf.icon}</span>
    ${esc(conf.label)} · ${Math.round(conf.score * 100)}%
  </span>`;
}

const confColorVar = (status) => `var(--${status})`;

/* ================================================================== */
/* Jelenlegi helyzet                                                   */
/* ================================================================== */

export function renderNow(state, context) {
  const hour = state.hours[state.nowIndex];
  if (!hour) return;

  const t = hour.vars.temperature_2m;
  const app = hour.vars.apparent_temperature;
  const cur = context?.current;

  $('now-icon').textContent = hour.weather?.top.icon || '🌡️';
  $('now-temp').textContent = t ? `${num(t.mean, 1)}°` : '–';

  const condText = hour.weather ? hour.weather.top.label : '';
  $('now-cond').innerHTML = `${esc(condText)} ${confBadge(hour.confidence)}`;

  const subBits = [];
  if (app) subBits.push(`hőérzet ${num(app.mean, 0)} °C`);
  if (cur && cur.temperature_2m != null) subBits.push(`elemzés szerint ${num(cur.temperature_2m, 1)} °C`);
  $('now-sub').textContent = subBits.join(' · ');

  $('now-range').innerHTML = t
    ? `A források szerint most <b>${num(t.p10, 1)} – ${num(t.p90, 1)} °C</b> között van
       (a teljes mezőny ${num(t.min, 1)}–${num(t.max, 1)} °C). Szórás: <b>${num(t.std, 2)} °C</b>.`
    : '';

  /* Az ítélet-blokkok: ezekből derül ki, mennyire "talán". */
  const v = [];
  v.push(`<p class="verdict"><span class="tag">Csapadék a következő órában:</span> ${esc(precipSentence(hour.precip))}</p>`);

  const next6 = state.hours.slice(state.nowIndex, state.nowIndex + 7).filter((h) => h.precip);
  if (next6.length) {
    const best = next6.reduce((a, b) => (b.precip.probability > a.precip.probability ? b : a));
    if (best.precip.probability >= 0.2 && best !== hour) {
      v.push(`<p class="verdict"><span class="tag">6 órán belül:</span> a legnagyobb esély
        <b>${hourLabel(best.time)}:00</b> körül, ${pct(best.precip.probability)} —
        ${esc(best.precip.yesCount)} forrás a ${esc(best.precip.total)}-ből mond csapadékot.</p>`);
    }
  }

  v.push(`<p class="verdict"><span class="tag">Megbízhatóság:</span> ${esc(confidenceExplanation(hour.confidence, hour.sources))}</p>`);

  if (state.hours[state.nowIndex]?.weather && state.hours[state.nowIndex].weather.agreement < 0.6) {
    v.push(`<p class="verdict"><span class="tag">Az égkép megosztó:</span> ${esc(weatherSentence(hour.weather))}</p>`);
  }

  $('now-verdicts').innerHTML = v.join('');

  const offCount = Object.keys(state.unavailable).length;
  $('now-sources').innerHTML = `
    <span>Felhasznált forrás: <b>${hour.sources.used}</b></span>
    <span>Ebből független: <b>${num(hour.sources.effectiveN, 1)}</b></span>
    <span>Nem elérhető: <b>${offCount}</b></span>
    <span>Frissítve: <b>${new Date(state.fetchedAt).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</b></span>`;

  $('card-now').hidden = false;
}

/* ================================================================== */
/* Mérőszám-csempék                                                    */
/* ================================================================== */

const METRIC_ORDER = [
  'apparent_temperature', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m',
  'cloud_cover', 'relative_humidity_2m', 'surface_pressure', 'dew_point_2m',
  'wind_direction_10m', 'snowfall',
];

const COMPASS = ['É', 'ÉÉK', 'ÉK', 'KÉK', 'K', 'KDK', 'DK', 'DDK', 'D', 'DDNy', 'DNy', 'NyDNy', 'Ny', 'NyÉNy', 'ÉNy', 'ÉÉNy'];
const compass = (deg) => COMPASS[Math.round((deg % 360) / 22.5) % 16];

export function renderMetrics(state, onOpen) {
  const hour = state.hours[state.nowIndex];
  if (!hour) return;
  const host = $('metrics');
  host.innerHTML = '';

  for (const key of METRIC_ORDER) {
    const stat = hour.vars[key];
    if (!stat) continue;
    const meta = VARS[key];
    if (key === 'snowfall' && stat.mean < 0.05) continue;

    const conf = stat.confidence ?? 0;
    const status = conf >= 0.7 ? 'good' : conf >= 0.5 ? 'warning' : conf >= 0.3 ? 'serious' : 'critical';
    const value = meta.circular
      ? `${compass(stat.mean)} <small>${num(stat.mean, 0)}°</small>`
      : `${num(stat.mean, meta.dec)} <small>${esc(meta.unit)}</small>`;
    const spread = meta.circular
      ? `± ${num(stat.std, 0)}°`
      : `${num(stat.p10, meta.dec)} – ${num(stat.p90, meta.dec)}`;

    const btn = document.createElement('button');
    btn.className = 'metric';
    btn.innerHTML = `
      <div class="metric-label">${meta.icon} ${esc(meta.label)}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-spread">${spread} · ${stat.count} forrás</div>
      <div class="metric-bar"><i style="width:${Math.round(conf * 100)}%; background:${confColorVar(status)}"></i></div>`;
    btn.addEventListener('click', () => onOpen(state.nowIndex, key));
    host.appendChild(btn);
  }
  $('card-metrics').hidden = false;
}

/* ================================================================== */
/* Órás diagramok                                                      */
/* ================================================================== */

export function renderHourly(state, count) {
  const start = state.nowIndex;
  const slice = state.hours.slice(start, start + count);
  if (!slice.length) return;

  const tempPoints = slice.map((h, i) => {
    const s = h.vars.temperature_2m;
    return {
      label: `${hourLabel(h.time)}`,
      sub: `${dayShort(h.time)} ${hourLabel(h.time)}:00`,
      mean: s?.mean ?? null,
      p10: s?.p10 ?? null,
      p90: s?.p90 ?? null,
      min: s?.min ?? null,
      max: s?.max ?? null,
      night: isNight(h.time),
      isNow: i === 0,
      extra: s ? `${s.count} forrás · szórás ${num(s.std, 1)} °C` : '',
    };
  });

  ensembleBand($('chart-temp'), {
    points: tempPoints,
    unit: '°C',
    height: 195,
    ariaLabel: 'Hőmérséklet-előrejelzés a modellek szórásával',
  });

  const precipPoints = slice.map((h) => ({
    label: `${hourLabel(h.time)}`,
    sub: `${dayShort(h.time)} ${hourLabel(h.time)}:00`,
    value: h.precip ? h.precip.probability : null,
    extra: h.precip
      ? `${h.precip.yesCount}/${h.precip.total} forrás · ha esik, ~${num(h.precip.conditional, 1)} mm`
      : '',
  }));

  agreementBars($('chart-precip'), {
    points: precipPoints,
    height: 82,
    unit: '%',
    labelEvery: Math.max(3, Math.round(slice.length / 8)),
    ariaLabel: 'Óránkénti csapadékesély a források szavazata alapján',
  });

  // A csúcs a fejlécbe kerül: hosszabb időtávon a diagramot görgetni
  // kellene hozzá, így viszont egy pillantással látszik.
  const peakHour = slice.reduce(
    (best, h) => (h.precip && (!best || h.precip.probability > best.precip.probability) ? h : best),
    null,
  );
  $('precip-hint').textContent = peakHour && peakHour.precip.probability >= 0.05
    ? `csúcs ${Math.round(peakHour.precip.probability * 100)}% — ${dayShort(peakHour.time)} ${hourLabel(peakHour.time)}:00`
    : 'a források súlyozott szavazata';

  $('hourly-hint').textContent = `${slice[0] ? `${hourLabel(slice[0].time)}:00-tól` : ''} · ${slice.length} óra`;

  /* Táblázatos nézet — a diagram akadálymentes megfelelője. */
  const rows = slice
    .filter((_, i) => i % Math.max(1, Math.round(slice.length / 40)) === 0)
    .map((h) => {
      const s = h.vars.temperature_2m;
      const w = h.vars.wind_speed_10m;
      return `<tr>
        <td>${dayShort(h.time)} ${hourLabel(h.time)}:00</td>
        <td>${s ? num(s.mean, 1) : '–'}</td>
        <td>${s ? `${num(s.p10, 1)}–${num(s.p90, 1)}` : '–'}</td>
        <td>${h.precip ? Math.round(h.precip.probability * 100) : '–'}%</td>
        <td>${h.precip ? num(h.precip.expected, 1) : '–'}</td>
        <td>${w ? num(w.mean, 0) : '–'}</td>
        <td>${s ? s.count : 0}</td>
      </tr>`;
    })
    .join('');

  $('hourly-table').innerHTML = `<table class="data">
    <thead><tr>
      <th>Időpont</th><th>°C</th><th>80% sáv</th><th>Esély</th><th>mm</th><th>km/h</th><th>Forrás</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

  $('card-hourly').hidden = false;
}

/* ================================================================== */
/* Napi lista                                                          */
/* ================================================================== */

export function renderDaily(state, onOpen) {
  const host = $('daily');
  host.innerHTML = '';

  // A visszamenőleges órák miatt lezárult napok is szerepelnek az adatban —
  // azok a talajtelítettség számításához kellenek, nem a listába.
  const days = state.days.filter((d) => d.tmax && !d.isPast);
  const allMin = Math.min(...days.map((d) => d.tmin?.min ?? d.tmax.min));
  const allMax = Math.max(...days.map((d) => d.tmax.max));
  const span = Math.max(1, allMax - allMin);

  days.forEach((d, i) => {
    const lo = d.tmin?.mean ?? d.tmax.mean;
    const hi = d.tmax.mean;
    const barLeft = ((lo - allMin) / span) * 100;
    const barWidth = Math.max(4, ((hi - lo) / span) * 100);

    const btn = document.createElement('button');
    btn.className = 'day';
    btn.innerHTML = `
      <div>
        <div class="day-name">${i === 0 ? 'ma' : i === 1 ? 'holnap' : esc(dayLong(d.date))}</div>
        <div class="day-date">${esc(dateShort(d.date))}</div>
      </div>
      <div class="day-icon">${d.weather?.top.icon || '·'}</div>
      <div class="day-mid">
        <div class="day-cond">
          <span class="conf-dot" data-status="${d.confidence.status}" title="${esc(d.confidence.label)}"></span>
          ${esc(d.weather?.top.label || '')}
          ${d.weather && d.weather.agreement < 0.6 ? `<span style="color:var(--text-muted)"> · talán</span>` : ''}
        </div>
        <div class="day-precip">
          ${d.precipProb != null ? `${Math.round(d.precipProb * 100)}% eső` : ''}
          ${d.precip && d.precip.mean >= 0.2 ? ` · ${num(d.precip.mean, 1)} mm` : ''}
          · ${d.sources.used} forrás
        </div>
        <div class="day-spread"><i style="left:${barLeft}%; width:${barWidth}%"></i></div>
      </div>
      <div class="day-temps">
        <span class="day-max">${num(hi, 0)}°</span>
        <span class="day-min">/ ${num(lo, 0)}°</span>
        <div class="day-precip">± ${num(d.tmax.std, 1)}°</div>
      </div>`;
    btn.addEventListener('click', () => onOpen(state.days.indexOf(d)));
    host.appendChild(btn);
  });

  $('card-daily').hidden = false;
}

/* ================================================================== */
/* Levegőminőség                                                       */
/* ================================================================== */

const AQ_ITEMS = [
  { key: 'european_aqi', label: 'Európai AQI', unit: '', dec: 0, icon: '🫁', bands: [20, 40, 60, 80] },
  { key: 'pm2_5', label: 'PM2,5', unit: 'µg/m³', dec: 1, icon: '🌫️', bands: [10, 20, 25, 50] },
  { key: 'pm10', label: 'PM10', unit: 'µg/m³', dec: 0, icon: '🌫️', bands: [20, 40, 50, 100] },
  { key: 'ozone', label: 'Ózon', unit: 'µg/m³', dec: 0, icon: '🧪', bands: [60, 100, 130, 180] },
  { key: 'nitrogen_dioxide', label: 'NO₂', unit: 'µg/m³', dec: 0, icon: '🚗', bands: [40, 90, 120, 230] },
  { key: 'grass_pollen', label: 'Fűpollen', unit: 'db/m³', dec: 0, icon: '🌾', bands: [5, 20, 50, 200] },
  { key: 'birch_pollen', label: 'Nyírpollen', unit: 'db/m³', dec: 0, icon: '🌳', bands: [5, 20, 50, 200] },
  { key: 'ragweed_pollen', label: 'Parlagfű', unit: 'db/m³', dec: 0, icon: '🌿', bands: [5, 20, 50, 200] },
  { key: 'alder_pollen', label: 'Égerpollen', unit: 'db/m³', dec: 0, icon: '🌲', bands: [5, 20, 50, 200] },
  { key: 'mugwort_pollen', label: 'Üröm', unit: 'db/m³', dec: 0, icon: '🌱', bands: [5, 20, 50, 200] },
  { key: 'olive_pollen', label: 'Olajfa', unit: 'db/m³', dec: 0, icon: '🫒', bands: [5, 20, 50, 200] },
];

export function renderAir(aq, state) {
  if (!aq?.hourly) return;
  const times = aq.hourly.time;
  // A helyszín aktuális órájához legközelebbi index.
  const nowIso = state.hours[state.nowIndex]?.time;
  let idx = times.indexOf(nowIso);
  if (idx < 0) idx = 0;

  const host = $('air-metrics');
  host.innerHTML = '';
  let shown = 0;

  for (const item of AQ_ITEMS) {
    const series = aq.hourly[item.key];
    const v = series ? series[idx] : null;
    if (v == null) continue;
    if (item.key.includes('pollen') && v < 1) continue;

    const level = item.bands.findIndex((b) => v <= b);
    const status = level === 0 ? 'good' : level === 1 ? 'good' : level === 2 ? 'warning' : level === 3 ? 'serious' : 'critical';
    const word = ['kiváló', 'jó', 'közepes', 'rossz', 'nagyon rossz'][level < 0 ? 4 : level];

    const div = document.createElement('div');
    div.className = 'metric';
    div.innerHTML = `
      <div class="metric-label">${item.icon} ${esc(item.label)}</div>
      <div class="metric-value">${num(v, item.dec)} <small>${esc(item.unit)}</small></div>
      <div class="metric-spread">
        <span class="conf-dot" data-status="${status}"></span> ${word}
      </div>`;
    host.appendChild(div);
    shown++;
  }

  if (shown) $('card-air').hidden = false;
}

/* ================================================================== */
/* Adatforrások                                                        */
/* ================================================================== */

export function renderSources(state) {
  const hour = state.hours[state.nowIndex];
  const rows = membersAt(state, state.nowIndex, 'temperature_2m');
  const on = rows.filter((r) => r.available);
  const off = rows.filter((r) => !r.available);

  $('sources-count').textContent = `${on.length} aktív · ${off.length} kimaradt`;
  $('calibration-note').textContent = calibrationSummary(state);

  const maxShare = Math.max(...on.map((r) => r.share), 0.0001);
  const cal = state.calFactors;

  $('sources-list').innerHTML = on
    .map((r) => {
      const m = r.model;
      const maeT = state.calibration?.mae?.[m.id]?.temperature_2m;
      const f = cal[m.id]?.temperature_2m;
      const calBits = [];
      if (maeT != null) calBits.push(`friss hiba ${num(maeT, 2)} °C`);
      if (f) calBits.push(`kalibráció ×${num(f, 2)}`);
      if (state.familyPenalty[m.family] < 0.999) {
        calBits.push(`függetlenségi osztás ×${num(state.familyPenalty[m.family], 2)}`);
      }
      return `<div class="src">
        <div>
          <div class="src-name">${m.flag} ${esc(m.short)}</div>
          <div class="src-org">${esc(m.orgFull)} · ${esc(m.res)} · ${m.scope === 'regional' ? 'regionális' : 'globális'} · max ${m.maxLead} óra</div>
        </div>
        <div class="src-weight">${Math.round(r.share * 100)}%<small>${num(r.value, 1)} °C</small></div>
        <div class="src-bar"><i style="width:${Math.round((r.share / maxShare) * 100)}%"></i></div>
        <div class="src-note">${esc(m.note)}${calBits.length ? ` <em>(${esc(calBits.join(' · '))})</em>` : ''}</div>
      </div>`;
    })
    .join('');

  $('sources-off').innerHTML = off.length
    ? `<div class="card-title" style="margin-bottom:6px">Most nem számít bele</div>` +
      off
        .map((r) => `<div class="src is-off">
          <div>
            <div class="src-name">${r.model.flag} ${esc(r.model.short)}</div>
            <div class="src-org">${esc(r.model.org)}</div>
          </div>
          <div class="src-weight">${esc(r.reason || state.unavailable[r.model.id] || 'nincs adat')}</div>
        </div>`)
        .join('')
    : '';

  $('card-sources').hidden = false;
}

/* ================================================================== */
/* Részletes lapok (bottom sheet)                                      */
/* ================================================================== */

function openSheet(html, onMount) {
  const root = $('sheet-root');
  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-body">${html}</div></div>`;
  const sheet = root.querySelector('.sheet');
  const close = () => { root.innerHTML = ''; document.body.style.overflow = ''; };
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  root.querySelector('[data-close]')?.addEventListener('click', close);
  document.body.style.overflow = 'hidden';
  onMount?.(root, close);
  return close;
}

/** Egy változó teljes forrásbontása egy adott órára. */
export function openVariableSheet(state, hourIndex, variable) {
  const hour = state.hours[hourIndex];
  const meta = VARS[variable];
  const stat = hour.vars[variable];
  const rows = membersAt(state, hourIndex, variable);
  const on = rows.filter((r) => r.available);
  const off = rows.filter((r) => !r.available);

  const head = `
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title">${meta.icon} ${esc(meta.label)}</h2>
        <p class="sheet-sub">${esc(dayLong(hour.time))} ${hourLabel(hour.time)}:00 · +${Math.round(hour.lead)} óra</p>
      </div>
      <button class="icon-btn" data-close aria-label="Bezárás">✕</button>
    </div>`;

  const summary = stat
    ? `<div class="now-head" style="align-items:baseline">
         <div class="now-temp" style="font-size:42px">${num(stat.mean, meta.dec)}<small style="font-size:18px"> ${esc(meta.unit)}</small></div>
       </div>
       <p class="verdict">
         <span class="tag">Súlyozott konszenzus.</span>
         A források 80%-a <b>${num(stat.p10, meta.dec)} – ${num(stat.p90, meta.dec)} ${esc(meta.unit)}</b> között van,
         a teljes mezőny ${num(stat.min, meta.dec)}–${num(stat.max, meta.dec)}.
         Szórás ${num(stat.std, 2)} ${esc(meta.unit)}, medián ${num(stat.median, meta.dec)}.
       </p>
       <p class="verdict">
         <span class="tag">Hány forrás?</span>
         ${on.length} modell adott értéket, ebből ${num(stat.effectiveN, 1)} számít valóban független véleménynek
         (az azonos intézettől származó modellek osztoznak a súlyon).
         ${stat.outliers?.length ? `Kilógónak minősült és kimaradt: ${esc(listNames(stat.outliers))}.` : ''}
       </p>
       <p class="verdict">${confBadge({ ...hour.confidence })} ${esc(confidenceExplanation(hour.confidence, hour.sources))}</p>`
    : '<p class="verdict">Erre az órára egyetlen forrás sem ad értéket.</p>';

  const devTitle = `<h3 class="card-title" style="margin-top:16px">Eltérés a konszenzustól <span class="hint">pont = modell, jobbra = magasabb</span></h3>`;

  const table = `
    <details class="table-view" open>
      <summary>Modellenkénti értékek</summary>
      <div class="table-scroll">
        <table class="data">
          <thead><tr><th>Forrás</th><th>Érték</th><th>Eltérés</th><th>Súly</th></tr></thead>
          <tbody>
            ${on.map((r) => `<tr>
              <td>${r.model.flag} ${esc(r.model.short)}${r.outlier ? ' ⚠' : ''}</td>
              <td>${num(r.value, meta.dec)}</td>
              <td>${r.deviation > 0 ? '+' : ''}${num(r.deviation, meta.dec)}</td>
              <td>${Math.round(r.share * 100)}%</td>
            </tr>`).join('')}
            ${off.map((r) => `<tr style="opacity:.55">
              <td>${r.model.flag} ${esc(r.model.short)}</td>
              <td colspan="3" style="text-align:left">${esc(r.reason || 'nincs adat')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>`;

  openSheet(head + summary + devTitle + '<div id="dev-holder"></div>' + table, (root) => {
    deviationDots(root.querySelector('#dev-holder'), on, { unit: meta.unit });
  });
}

/** Egy nap részletei: órás bontás + forrásbontás. */
export function openDaySheet(state, dayIndex, onOpenVar) {
  const day = state.days[dayIndex];
  const hours = day.hourIndexes.map((i) => state.hours[i]);

  const head = `
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title">${esc(dayLong(day.date))}, ${esc(dateShort(day.date))}</h2>
        <p class="sheet-sub">${day.sources.used} forrás · +${Math.round(day.lead)} óra előre</p>
      </div>
      <button class="icon-btn" data-close aria-label="Bezárás">✕</button>
    </div>`;

  const verdicts = [
    `<p class="verdict">${confBadge(day.confidence)} ${esc(confidenceExplanation(day.confidence, day.sources))}</p>`,
    day.tmax ? `<p class="verdict"><span class="tag">Csúcshőmérséklet:</span> ${esc(tempSentence(day.tmax, 'A nap maximuma'))}</p>` : '',
    day.tmin ? `<p class="verdict"><span class="tag">Minimum:</span> ${esc(tempSentence(day.tmin, 'A hajnali minimum'))}</p>` : '',
    day.precipProb != null
      ? `<p class="verdict"><span class="tag">Csapadék:</span>
         ${day.precipProb >= 0.5 ? 'Inkább csapadékos' : 'Inkább száraz'} nap —
         ${day.precipVotes.yes.length} forrás mond mérhető csapadékot, ${day.precipVotes.no.length} nem
         (súlyozva ${pct(day.precipProb)}).
         ${day.precip ? `Várható mennyiség ${num(day.precip.mean, 1)} mm, de ${num(day.precip.min, 1)} és ${num(day.precip.max, 1)} mm között szórnak a modellek.` : ''}
         ${day.precipVotes.yes.length && day.precipVotes.no.length
            ? `Esőt mond: ${esc(listNames(day.precipVotes.yes))}. Szárazat: ${esc(listNames(day.precipVotes.no))}.`
            : ''}</p>`
      : '',
    day.weather && day.weather.agreement < 0.7
      ? `<p class="verdict"><span class="tag">Az égkép:</span> ${esc(weatherSentence(day.weather))}</p>`
      : '',
    day.gust && day.gust.mean >= 40
      ? `<p class="verdict"><span class="tag">Szél:</span> A széllökések ${num(day.gust.mean, 0)} km/h körül,
         de a források ${num(day.gust.min, 0)} és ${num(day.gust.max, 0)} km/h között szórnak.</p>`
      : '',
  ].join('');

  const voteRows = (day.weather?.votes || [])
    .map((v) => `<tr><td>${v.icon} ${esc(v.label)}</td><td>${Math.round(v.share * 100)}%</td><td>${v.count}</td>
      <td style="text-align:left">${esc(listNames(v.ids, 4))}</td></tr>`)
    .join('');

  const voteTable = voteRows
    ? `<h3 class="card-title" style="margin-top:16px">Ki mit mond a napra</h3>
       <div class="table-scroll"><table class="data">
         <thead><tr><th>Jelleg</th><th>Súly</th><th>Db</th><th>Források</th></tr></thead>
         <tbody>${voteRows}</tbody></table></div>`
    : '';

  openSheet(
    head + verdicts +
    `<h3 class="card-title" style="margin-top:16px">Óránként ezen a napon</h3>
     <div class="chart-holder" id="day-chart"></div>
     <div class="chart-legend">
       <span><i class="legend-line"></i> konszenzus</span>
       <span><i class="legend-swatch" style="background: var(--band-inner)"></i> 80%-os sáv</span>
     </div>
     <div class="chart-holder" id="day-precip" style="margin-top:10px"></div>` +
    voteTable +
    `<h3 class="card-title" style="margin-top:16px">Napi maximum forrásonként</h3>
     <div id="day-dev"></div>`,
    (root) => {
      ensembleBand(root.querySelector('#day-chart'), {
        points: hours.map((h) => {
          const s = h.vars.temperature_2m;
          return {
            label: hourLabel(h.time),
            sub: `${hourLabel(h.time)}:00`,
            mean: s?.mean ?? null, p10: s?.p10 ?? null, p90: s?.p90 ?? null,
            min: s?.min ?? null, max: s?.max ?? null,
            night: isNight(h.time),
            extra: s ? `${s.count} forrás` : '',
          };
        }),
        unit: '°C',
        height: 170,
      });
      agreementBars(root.querySelector('#day-precip'), {
        points: hours.map((h) => ({
          label: hourLabel(h.time),
          sub: `${hourLabel(h.time)}:00`,
          value: h.precip?.probability ?? null,
          extra: h.precip ? `${h.precip.yesCount}/${h.precip.total} forrás` : '',
        })),
        height: 70,
        labelEvery: 3,
      });
      deviationDots(root.querySelector('#day-dev'), dayMembers(state, dayIndex, 'tmax'), { unit: '°C' });
    },
  );
}

export { $, esc, hourLabel, dayLong, dayShort, dateShort };
