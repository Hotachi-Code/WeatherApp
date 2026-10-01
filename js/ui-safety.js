/**
 * ui-safety.js — A biztonsági rétegek megjelenítése.
 *
 * Három külön kérdésre három külön válaszblokk, és egyiket sem keverjük:
 *   • Mi fenyeget most?      (hivatalos ügynökségek élő eseményei)
 *   • Mi jön az időjárásból? (a saját modellmezőny szavazata)
 *   • Mit írnak a hírek?     (és mennyire van megerősítve)
 */

import { num, pct } from './narrative.js';
import { IMPACT } from './space.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_ICON = { good: '✔', warning: '◐', serious: '?', critical: '!' };

function badge(status, text) {
  return `<span class="conf" data-status="${status}">
    <span class="conf-mark" aria-hidden="true">${STATUS_ICON[status] || '·'}</span>${esc(text)}
  </span>`;
}

/** Súlyossági fokozat → állapotszín + szó. */
const SEVERITY = {
  0: { status: 'good', word: 'figyelemfelhívás' },
  1: { status: 'warning', word: 'mérsékelt' },
  2: { status: 'serious', word: 'jelentős' },
  3: { status: 'critical', word: 'súlyos' },
};

function relTime(ms) {
  const h = (Date.now() - ms) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} perce`;
  if (h < 48) return `${Math.round(h)} órája`;
  return `${Math.round(h / 24)} napja`;
}

function whenLabel(iso, lead) {
  if (!iso) return '';
  const d = new Date(Date.parse(`${iso}:00Z`));
  const day = ['vasárnap', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton'][d.getUTCDay()];
  const hh = d.getUTCHours();
  if (lead < 6) return `${hh}:00 körül`;
  if (lead < 30) return `${day} ${hh}:00 körül`;
  return `${day} (+${Math.round(lead / 24)} nap) ${hh}:00 körül`;
}

/* ================================================================== */
/* 1. Élő veszélyesemények                                             */
/* ================================================================== */

function threatRow(t) {
  const conf = badge(t.confirmationStatus, t.confirmationLabel);
  const sev = SEVERITY[t.severity >= 0.75 ? 3 : t.severity >= 0.5 ? 2 : t.severity >= 0.25 ? 1 : 0];

  // Ha több ügynökség is bemérte, mindig kiírjuk kinek mi jött ki —
  // a teljes egyetértés ugyanolyan fontos információ, mint az eltérés.
  const reports = t.magnitudeReports || [];
  const magLine = t.magnitude != null
    ? `<div class="threat-line">Erősség: <b>${num(t.magnitude, t.type === 'earthquake' ? 1 : 0)} ${esc(t.magnitudeUnit)}</b>` +
      (reports.length >= 2
        ? ` — ${reports.length} ügynökség mérése: ${reports.map((m) => `${m.id.toUpperCase()} ${num(m.v, 1)}`).join(', ')}` +
          (t.magnitudeSpread > 0.05
            ? ` <span class="muted">(±${num(t.magnitudeSpread, 2)} eltérés)</span>`
            : ' <span class="muted">(teljes egyetértés)</span>')
        : '') +
      `</div>`
    : '';

  const reach = t.type === 'earthquake'
    ? `<div class="threat-line">Általában <b>${num(t.feltRadius, 0)} km</b>-ig érezhető, <b>${num(t.damageRadius, 0)} km</b>-ig okoz kárt.
       Te <b>${num(t.distance, 0)} km</b>-re vagy — ${t.distance <= t.damageRadius
         ? 'ez a károkozó zónán belül van.'
         : t.distance <= t.feltRadius
           ? 'érezhető lehetett, de károkozás innen már nem valószínű.'
           : 'ez már jóval a hatókörön kívül van.'}</div>`
    : `<div class="threat-line">Távolság: <b>${num(t.distance, 0)} km</b> ${esc(t.bearing)}${t.countryMatch ? ' · az ország a hivatalos érintettségi listán szerepel' : ''}</div>`;

  return `<div class="threat" data-severity="${sev.status}">
    <div class="threat-head">
      <span class="threat-icon">${t.meta.icon}</span>
      <div class="threat-title">
        <div class="threat-name">${esc(t.meta.label)}${t.alertLevel ? ` · ${esc(t.alertLevel)}` : ''}</div>
        <div class="threat-where">${esc(t.title)}</div>
      </div>
      <div class="threat-when">${relTime(t.time)}</div>
    </div>
    ${magLine}
    ${reach}
    ${t.description ? `<div class="threat-line">${esc(t.description)}</div>` : ''}
    ${t.instruction ? `<div class="threat-line threat-advice">${esc(t.instruction.slice(0, 300))}</div>` : ''}
    <div class="threat-foot">
      ${conf}
      ${t.url ? `<a class="threat-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Hivatalos oldal ↗</a>` : ''}
    </div>
  </div>`;
}

/* ================================================================== */
/* 2. Veszély-előrejelzés a modellmezőnyből                            */
/* ================================================================== */

/**
 * Egy veszélytípus egyetlen blokkban.
 *
 * A pásztázás ugyanazt a hőséget több napra külön találatként adja vissza.
 * Ezeket nem soroljuk fel egyesével — a legerősebbet mutatjuk részletesen,
 * a többit egy sorban összefoglalva. A tanács is egyszer szerepel.
 */
function hazardGroup(group) {
  const h = group[0];
  const rest = group.slice(1);
  const sev = SEVERITY[h.severity] || SEVERITY[1];
  const bar = Math.round(h.probability * 100);

  const amount = h.expected != null
    ? ` · várhatóan <b>${num(h.expected, 1)} ${esc(h.spec.unit)}</b>` +
      (h.range && h.range.max - h.range.min > 0.5
        ? ` <span class="muted">(a mezőny ${num(h.range.min, 1)}–${num(h.range.max, 1)} között szór)</span>`
        : '')
    : '';

  const more = rest.length
    ? `<div class="threat-line muted">Máskor is: ${[...rest]
        .sort((a, b) => a.lead - b.lead)
        .slice(0, 4)
        .map((r) => `${esc(whenLabel(r.startTime, r.lead))} ${Math.round(r.probability * 100)}%`)
        .join(' · ')}${rest.length > 4 ? ` · +${rest.length - 4} alkalom` : ''}</div>`
    : '';

  // A „Sűrű köd — köd" fajta ismétlést nem írjuk ki kétszer.
  const heading = h.severityText && h.severityText.toLowerCase() !== h.spec.label.toLowerCase()
    ? `${h.spec.label} — ${h.severityText}`
    : h.spec.label;

  return `<div class="hazard" data-severity="${sev.status}">
    <div class="hazard-head">
      <span class="hazard-icon">${h.spec.icon}</span>
      <div>
        <div class="hazard-name">${esc(heading)}</div>
        <div class="hazard-when">${esc(whenLabel(h.startTime, h.lead))}</div>
      </div>
      <div class="hazard-prob">${bar}%</div>
    </div>
    <div class="hazard-bar"><i style="width:${bar}%; background: var(--${sev.status})"></i></div>
    <div class="threat-line">
      <b>${h.sourceCount}-ből ${h.yesCount} modell</b> jelzi${amount}.
      ${h.worstCaseText ? `A legrosszabb eset, amit egy forrás mutat: <b>${esc(h.worstCaseText)}</b>.` : ''}
    </div>
    <div class="threat-line muted">
      Jelzi: ${esc(h.yes.slice(0, 5).map((x) => x.model.short).join(', '))}${h.yes.length > 5 ? ` +${h.yes.length - 5}` : ''}
      ${h.no.length ? ` · Nem jelzi: ${esc(h.no.slice(0, 4).map((x) => x.model.short).join(', '))}${h.no.length > 4 ? ` +${h.no.length - 4}` : ''}` : ''}
    </div>
    ${more}
    <div class="threat-line threat-advice">${esc(h.spec.advice)}</div>
  </div>`;
}

/**
 * Megjelenítési küszöb: az enyhe fokozatú veszélyeket csak akkor mutatjuk,
 * ha elég valószínűek. Különben a lista tele lenne 19%-os ködjelzéssel, és
 * a fontos tételek elvesznének benne.
 */
function worthShowing(h) {
  if (h.severity >= 3) return h.probability >= 0.15;
  if (h.severity === 2) return h.probability >= 0.2;
  return h.probability >= 0.35;
}

function groupHazards(hazards) {
  const byType = new Map();
  for (const h of hazards.filter(worthShowing)) {
    if (!byType.has(h.type)) byType.set(h.type, []);
    byType.get(h.type).push(h);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => b.severity - a.severity || b.probability - a.probability || a.lead - b.lead);
  }
  return [...byType.values()].sort((a, b) => b[0].rank - a[0].rank);
}

/* ================================================================== */
/* Biztonsági kártya                                                   */
/* ================================================================== */

export function renderSafety(data) {
  const {
    threats = [], nearby = [], hazards = [], landslide = null, fire = null,
    failed = {}, sourcesUsed = [], queried = [], watchRadiusKm,
  } = data;

  const activeCount = threats.length;
  const forecastGroups = groupHazards(hazards);
  const forecastCount = forecastGroups.length;
  const extra = [
    landslide?.applicable && landslide.severity >= 1,
    fire && fire.severity >= 1,
  ].filter(Boolean).length;

  const total = activeCount + forecastCount + extra;

  /* --- Összegző mondat: ez az első, amit el kell olvasni --- */
  let summaryStatus = 'good';
  let summaryText;
  if (activeCount) {
    summaryStatus = 'critical';
    summaryText = `${activeCount} aktív veszélyesemény éri el a környéket.`;
  } else if (forecastCount) {
    summaryStatus = hazards.some((h) => h.severity >= 3 && h.probability >= 0.4) ? 'serious' : 'warning';
    summaryText = `Jelenleg nincs élő vészhelyzet, de ${forecastCount} féle időjárási veszély várható a következő napokban.`;
  } else if (extra) {
    summaryStatus = 'warning';
    summaryText = 'Nincs akut veszély, de a terepviszonyok miatt egy kockázat figyelmet érdemel.';
  } else {
    summaryText = `A figyelt ${watchRadiusKm} km-es körzetben nincs ismert veszély, és a modellek sem jeleznek szélsőséget.`;
  }

  $('safety-summary').innerHTML = `
    <div class="safety-summary" data-status="${summaryStatus}">
      ${badge(summaryStatus, summaryStatus === 'good' ? 'Nyugodt' : summaryStatus === 'warning' ? 'Figyelj rá' : summaryStatus === 'serious' ? 'Fontos' : 'Sürgős')}
      <span>${esc(summaryText)}</span>
    </div>`;

  /* --- Aktív események --- */
  $('safety-active').innerHTML = threats.length
    ? `<h3 class="card-title" style="margin-top:14px">Aktív veszély <span class="hint">hivatalos ügynökségektől</span></h3>` +
      threats.map(threatRow).join('')
    : '';

  /* --- Időjárási veszély-előrejelzés, típusonként összevonva --- */
  const groups = groupHazards(hazards).slice(0, 6);
  const parts = [];
  if (groups.length) {
    parts.push(`<h3 class="card-title" style="margin-top:14px">Várható veszély <span class="hint">a modellmezőny szavazata</span></h3>`);
    parts.push(groups.map(hazardGroup).join(''));
  }

  if (landslide?.applicable && landslide.severity >= 1) {
    const sev = SEVERITY[landslide.severity];
    parts.push(`<div class="hazard" data-severity="${sev.status}">
      <div class="hazard-head">
        <span class="hazard-icon">⛰️</span>
        <div>
          <div class="hazard-name">Földcsuszamlás-kockázat — ${esc(sev.word)}</div>
          <div class="hazard-when">a domborzat, az átázott talaj és a várható eső együtteséből</div>
        </div>
        <div class="hazard-prob">${Math.round(landslide.risk * 100)}%</div>
      </div>
      <div class="hazard-bar"><i style="width:${Math.round(landslide.risk * 100)}%; background: var(--${sev.status})"></i></div>
      <div class="threat-line">
        Legmeredekebb lejtő a közelben: <b>${num(landslide.slope, 1)}°</b>.
        Az elmúlt 3 nap csapadéka: <b>${num(landslide.antecedent, 0)} mm</b>.
        ${landslide.rain ? `A következő napokban <b>${num(landslide.rain.expected, 0)} mm</b> eső jöhet (${pct(landslide.rain.probability)} eséllyel).` : 'Jelentős eső nincs előrejelezve.'}
      </div>
      <div class="threat-line muted">${esc(landslide.caveat)}</div>
    </div>`);
  }

  if (fire && fire.severity >= 1) {
    const sev = SEVERITY[fire.severity];
    parts.push(`<div class="hazard" data-severity="${sev.status}">
      <div class="hazard-head">
        <span class="hazard-icon">🔥</span>
        <div>
          <div class="hazard-name">Tűzveszély — ${esc(sev.word)}</div>
          <div class="hazard-when">${esc(whenLabel(fire.time, 24))}</div>
        </div>
        <div class="hazard-prob">${Math.round(fire.score * 100)}%</div>
      </div>
      <div class="hazard-bar"><i style="width:${Math.round(fire.score * 100)}%; background: var(--${sev.status})"></i></div>
      <div class="threat-line">
        ${num(fire.temp, 0)} °C, ${num(fire.humidity, 0)}% páratartalom, ${num(fire.wind, 0)} km/h szél,
        ${fire.dryDays != null ? `${fire.dryDays} száraz nap` : 'ismeretlen szárazság'}.
      </div>
      <div class="threat-line threat-advice">Szabadtéri tűzgyújtás, dohányzás, grillezés fokozottan kockázatos.</div>
    </div>`);
  }
  $('safety-forecast').innerHTML = parts.join('');

  /* --- Környéken történt, de nem ér el idáig --- */
  $('safety-nearby').innerHTML = nearby.length
    ? `<details class="table-view" style="margin-top:14px">
        <summary>A környéken történt még ${nearby.length} esemény — ezek nem érnek el idáig</summary>
        <div class="nearby-list">
          ${nearby.slice(0, 15).map((t) => `<div class="nearby">
            <span>${t.meta.icon}</span>
            <div>
              <div class="nearby-name">${esc(t.meta.label)}${t.magnitude != null ? ` ${num(t.magnitude, 1)} ${esc(t.magnitudeUnit)}` : ''} — ${esc(t.title)}</div>
              <div class="nearby-meta">${num(t.distance, 0)} km ${esc(t.bearing)} · ${relTime(t.time)} · ${esc(t.sources.join(', ').toUpperCase())}</div>
            </div>
          </div>`).join('')}
        </div>
      </details>`
    : '';

  // Külön mondjuk meg, hányat kérdeztünk meg és hányból jött adat: a
  // „0 forrás jelentett" nem ugyanaz, mint a „nem sikerült lekérdezni".
  const failedList = Object.keys(failed);
  const asked = queried.length || sourcesUsed.length;
  $('safety-hint').textContent =
    `${asked} ügynökségből ${sourcesUsed.length} jelentett` +
    `${failedList.length ? ` · ${failedList.length} nem válaszolt` : ''} · ${watchRadiusKm} km`;

  $('card-safety').hidden = false;
  return { total, summaryStatus };
}

/* ================================================================== */
/* 3. Hírek                                                            */
/* ================================================================== */

export function renderNews(news, state) {
  const host = $('news-list');

  if (news?.error) {
    host.innerHTML = `<p class="chart-empty">${esc(news.error)}</p>`;
    $('news-hint').textContent = 'átmenetileg nem elérhető';
    $('card-news').hidden = false;
    return;
  }

  const stories = news?.stories || [];
  if (!stories.length) {
    host.innerHTML = `<p class="chart-empty">A figyelt időszakban nem találtunk biztonsági vonatkozású hírt erre a területre.</p>`;
    $('news-hint').textContent = `${news?.total ?? 0} cikk átnézve`;
    $('card-news').hidden = false;
    return;
  }

  host.innerHTML = stories.slice(0, 12).map((s) => `
    <div class="story" data-status="${s.verificationStatus}">
      <div class="story-head">
        <span class="story-icon">${s.category?.icon || '⚠️'}</span>
        <div class="story-main">
          <div class="story-title">${esc(s.title)}</div>
          <div class="story-meta">
            ${esc(s.category?.label || 'Veszélyhír')} · ${relTime(s.time)} ·
            ${s.domains.length} forrás${s.countries.length > 1 ? ` · ${s.countries.length} ország` : ''}
          </div>
        </div>
      </div>
      <div class="story-foot">
        ${badge(s.verificationStatus, s.verificationLabel)}
      </div>
      <div class="story-sources">
        ${s.articles.slice(0, 4).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.domain)} ↗</a>`).join('')}
        ${s.articles.length > 4 ? `<span class="muted">+${s.articles.length - 4} további</span>` : ''}
      </div>
    </div>`).join('');

  const confirmed = stories.filter((s) => s.verification === 'hivatalos').length;
  const single = stories.filter((s) => s.verification === 'egy-forras').length;

  $('news-hint').textContent = `${news.total} cikk → ${stories.length} téma`;
  $('news-note').innerHTML =
    `<span class="tag">Hogyan olvasd:</span> ${confirmed} témát hivatalos ügynökség is megerősít, ` +
    `${single} viszont egyetlen szerkesztőségtől származik, minden megerősítés nélkül — ` +
    `azt kezeld pletykaként, amíg más forrás is meg nem írja. ` +
    `A rangsor a megerősítettséget és a frissességet követi, nem a szenzációt.`;

  $('card-news').hidden = false;
}

/* ================================================================== */
/* 4. Űridőjárás                                                       */
/* ================================================================== */

const SCALE_STATUS = (n) => (n >= 4 ? 'critical' : n >= 3 ? 'serious' : n >= 1 ? 'warning' : 'good');

export function renderSpace(ev) {
  if (!ev) return;

  /* --- Aktuális R/S/G --- */
  const tile = (key, label, value, text) => {
    const st = SCALE_STATUS(value);
    return `<button class="metric space-tile" data-scale="${key}">
      <div class="metric-label">${key === 'R' ? '📻' : key === 'S' ? '☢️' : '🧲'} ${esc(label)}</div>
      <div class="metric-value">${key}${value} <small>${esc(text)}</small></div>
      <div class="metric-spread"><span class="conf-dot" data-status="${st}"></span> ${esc(IMPACT[key][value].slice(0, 58))}${IMPACT[key][value].length > 58 ? '…' : ''}</div>
    </button>`;
  };

  $('space-now').innerHTML = `<div class="metrics">
    ${tile('R', 'Rádiókimaradás', ev.current.R, ev.currentText.R)}
    ${tile('S', 'Sugárvihar', ev.current.S, ev.currentText.S)}
    ${tile('G', 'Mágneses vihar', ev.current.G, ev.currentText.G)}
  </div>`;

  /* --- Napkitörés-valószínűség, három forrás konszenzusa --- */
  const flareBlock = (key, label, desc) => {
    const f = ev.flare[key];
    if (!f) return '';
    const st = f.mean >= 50 ? 'serious' : f.mean >= 20 ? 'warning' : 'good';
    return `<div class="flare">
      <div class="flare-head">
        <div>
          <div class="flare-name">${esc(label)}</div>
          <div class="flare-desc">${esc(desc)}</div>
        </div>
        <div class="flare-value">${num(f.mean, 0)}%</div>
      </div>
      <div class="hazard-bar"><i style="width:${Math.min(100, Math.round(f.mean))}%; background: var(--${st})"></i></div>
      <div class="threat-line muted">
        ${f.members.map((m) => `${esc(m.name)} <b>${num(m.value, 0)}%</b>`).join(' · ')}
        — szórás ${num(f.std, 1)} pont, ${esc(f.confidence.label.toLowerCase())}
      </div>
    </div>`;
  };

  $('space-flare').innerHTML =
    `<h3 class="card-title" style="margin-top:14px">Napkitörés a következő 24 órában <span class="hint">3 forrás súlyozva</span></h3>` +
    flareBlock('c', 'C-osztály', 'Gyakori, a Földön nem érzékelhető.') +
    flareBlock('m', 'M-osztály', 'Közepes: rövidhullámú rádiózavar a napos oldalon.') +
    flareBlock('x', 'X-osztály', 'Erős: rádiókimaradás, GPS-hiba, ritkán hálózati zavar.') +
    (ev.flare.proton != null
      ? `<div class="threat-line muted">Protonvihar (sugárzás) esélye: <b>${num(ev.flare.proton, 0)}%</b> — ez a nagy magasságú repülésre hat, a földfelszínen nem.</div>`
      : '');

  /* --- 3 napos NOAA-előrejelzés --- */
  $('space-forecast').innerHTML = ev.forecast.length
    ? `<h3 class="card-title" style="margin-top:14px">3 napos kilátás <span class="hint">NOAA SWPC</span></h3>
       <div class="table-scroll"><table class="data">
         <thead><tr><th>Nap</th><th>Rádió</th><th>Sugárzás</th><th>Mágneses</th></tr></thead>
         <tbody>${ev.forecast.map((d) => `<tr>
           <td>${esc(String(d.date).slice(5))}</td>
           <td><span class="conf-dot" data-status="${SCALE_STATUS(d.R)}"></span> R${d.R}${d.rMinor != null ? ` <span class="muted">(${d.rMinor}%)</span>` : ''}</td>
           <td><span class="conf-dot" data-status="${SCALE_STATUS(d.S)}"></span> S${d.S}${d.sProb != null ? ` <span class="muted">(${d.sProb}%)</span>` : ''}</td>
           <td><span class="conf-dot" data-status="${SCALE_STATUS(d.G)}"></span> G${d.G}</td>
         </tr>`).join('')}</tbody>
       </table></div>`
    : '';

  /* --- Mit láttunk, és látszik-e sarki fény --- */
  const a = ev.aurora;
  const obs = ev.observed;
  $('space-aurora').innerHTML = `
    <div class="verdict" style="margin-top:14px">
      <span class="tag">Megfigyelt aktivitás:</span>
      az elmúlt ${obs.goesWindow} napban a GOES műhold <b>${obs.goesC} C</b>, <b>${obs.goesM} M</b> és <b>${obs.goesX} X</b> osztályú kitörést mért.
      ${ev.strongest ? `A legerősebb <b>${esc(ev.strongest.max_class)}</b> volt.` : ''}
      ${ev.cmeCount ? ` A NASA ${ev.cmeCount} plazmakidobódást (CME) katalogizált.` : ''}
      <span class="muted">A NASA katalógusa 2 nap késéssel teljes, ezért az ő számai alacsonyabbak — a súlyozás ezt figyelembe veszi.</span>
    </div>
    ${a ? `<div class="verdict">
      <span class="tag">Sarki fény innen:</span>
      geomágneses szélességed <b>${num(a.geomagneticLat, 1)}°</b>, a mostani Kp${num(ev.kp.max24h ?? ev.kp.now, 0)} mellett
      <b>${esc(a.level)}</b>.
      ${a.visible ? 'Sötét, északra nyitott helyről érdemes próbálkozni.' : `Ide legalább <b>Kp${a.kpNeeded}</b> kellene — ez évente néhányszor fordul elő.`}
    </div>` : ''}`;

  // A „most" és a „várható" két külön dolog — ne mossuk össze őket.
  const words = ['nyugodt', 'kisebb', 'mérsékelt', 'erős', 'súlyos', 'szélsőséges'];
  $('space-hint').textContent = ev.worst
    ? `most ${words[ev.worst]} zavar`
    : ev.forecastWorst
      ? `most nyugodt · ${words[ev.forecastWorst]} zavar várható`
      : 'nyugodt';

  $('card-space').hidden = false;
}

export { badge, relTime };
