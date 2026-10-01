/**
 * narrative.js — A számokból magyar mondat.
 *
 * A cél, hogy ne csak egy szám jelenjen meg, hanem az is kiderüljön,
 * mennyire lehet hinni neki: hány forrás mondja, mekkora a szórás, és
 * kik a kilógók. Ahol a mezőny megosztott, ott a szöveg is "talán".
 */

import { MODEL_BY_ID } from './config.js';

const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d).replace('.', ','));

const pct = (p) => `${Math.round(p * 100)}%`;

/**
 * Helyes határozott névelő. A modellnevek betűszavak, ezért a kiejtett
 * első hang dönt: "az ECMWF", de "a GFS".
 */
const VOWELS = 'AEIOUÁÉÍÓÖŐÚÜŰaeiouáéíóöőúüű';
export const article = (word) => (VOWELS.includes(String(word)[0]) ? 'az' : 'a');
const withArticle = (word) => `${article(word)} ${word}`;

/** Modell-nevek felsorolása magyarul ("A, B és C"). */
export function listNames(ids, limit = 3) {
  const names = ids.map((id) => MODEL_BY_ID[id]?.short || id);
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  let s = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} és ${shown[shown.length - 1]}` : shown[0] || '';
  if (rest > 0) s += ` (+${rest} másik)`;
  return s;
}

/* ------------------------------------------------------------------ */
/* Csapadék                                                            */
/* ------------------------------------------------------------------ */

/** A valószínűség szöveges fokozatai — itt jelenik meg a "talán". */
export function precipPhrase(p) {
  if (p >= 0.9) return { text: 'Szinte biztosan esni fog', tone: 'igen' };
  if (p >= 0.72) return { text: 'Nagy valószínűséggel esik', tone: 'igen' };
  if (p >= 0.58) return { text: 'Valószínűleg esik', tone: 'igen' };
  if (p >= 0.45) return { text: 'Talán esik, talán nem — a források megosztottak', tone: 'talan' };
  if (p >= 0.32) return { text: 'Talán inkább száraz marad', tone: 'talan' };
  if (p >= 0.15) return { text: 'Valószínűleg száraz marad', tone: 'nem' };
  if (p >= 0.05) return { text: 'Nagy valószínűséggel száraz marad', tone: 'nem' };
  return { text: 'Szinte biztosan száraz marad', tone: 'nem' };
}

/**
 * Teljes csapadék-mondat a forrásszámokkal együtt.
 * Például: "Talán esik, talán nem — 12 forrásból 6 mond csapadékot
 * (súlyozva 48%). Ha esik, kb. 1,4 mm. Esőt mond: ICON-D2, AROME-HD és GFS."
 */
export function precipSentence(vote) {
  if (!vote) return 'Erre az időpontra nincs csapadékadat.';
  const phrase = precipPhrase(vote.probability);
  const parts = [
    `${phrase.text} — ${vote.total} forrásból ${vote.yesCount} mond csapadékot (súlyozva ${pct(vote.probability)}).`,
  ];
  if (vote.probability > 0.05 && vote.conditional > 0) {
    parts.push(`Ha esik, nagyjából ${num(vote.conditional, 1)} mm várható.`);
  }
  if (vote.yesCount && vote.noCount) {
    const minority = vote.yesCount <= vote.noCount ? vote.yes : vote.no;
    const which = vote.yesCount <= vote.noCount ? 'Csapadékot mond' : 'Szárazat mond';
    parts.push(`${which}: ${listNames(minority.map((x) => x.id))}.`);
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Hőmérséklet                                                         */
/* ------------------------------------------------------------------ */

export function tempSentence(stat, label = 'A hőmérséklet') {
  if (!stat) return '';
  const spread = stat.p90 - stat.p10;
  const base = `${label} ${num(stat.mean, 1)} °C körül, ${stat.count} forrás súlyozott átlaga alapján.`;
  if (spread < 1.2) {
    return `${base} A modellek nagyon egyetértenek (a középső 80%-uk ${num(stat.p10, 1)} és ${num(stat.p90, 1)} °C közé esik).`;
  }
  if (spread < 2.5) {
    return `${base} Kisebb eltérés van köztük: reálisan ${num(stat.p10, 1)}–${num(stat.p90, 1)} °C.`;
  }
  if (spread < 5) {
    return `${base} De itt már érdemes óvatosnak lenni: talán ${num(stat.p10, 1)} °C is lehet, talán ${num(stat.p90, 1)} °C — a források szórnak.`;
  }
  return `${base} Nagyon bizonytalan: ${num(stat.min, 1)} és ${num(stat.max, 1)} °C között bármi előfordulhat, a források erősen megosztottak.`;
}

/* ------------------------------------------------------------------ */
/* Időjárás-típus szavazás                                             */
/* ------------------------------------------------------------------ */

export function weatherSentence(weather) {
  if (!weather) return '';
  const top = weather.top;
  if (weather.agreement >= 0.8) {
    return `${top.label.toLowerCase()} — a források ${pct(weather.agreement)}-a egyetért ebben.`;
  }
  const second = weather.votes[1];
  if (second) {
    return `talán ${top.label.toLowerCase()} (${pct(top.share)}), de ${pct(second.share)} szerint inkább ${second.label.toLowerCase()}.`;
  }
  return `${top.label.toLowerCase()} (${pct(top.share)}).`;
}

/* ------------------------------------------------------------------ */
/* Összegző mondat egy órára / napra                                   */
/* ------------------------------------------------------------------ */

export function hourSummary(hour) {
  if (!hour) return '';
  const t = hour.vars.temperature_2m;
  const bits = [];
  if (t) bits.push(`${num(t.mean, 0)} °C`);
  if (hour.weather) bits.push(hour.weather.top.label.toLowerCase());
  if (hour.precip && hour.precip.probability >= 0.15) {
    bits.push(`${pct(hour.precip.probability)} esély csapadékra`);
  }
  return bits.join(' · ');
}

export function daySummary(day) {
  if (!day) return '';
  const bits = [];
  if (day.tmax && day.tmin) bits.push(`${num(day.tmin.mean, 0)} – ${num(day.tmax.mean, 0)} °C`);
  if (day.weather) bits.push(day.weather.top.label.toLowerCase());
  if (day.precipProb != null && day.precipProb >= 0.15) bits.push(`${pct(day.precipProb)} csapadékesély`);
  return bits.join(' · ');
}

/** A bizonytalanság magyarázata emberi nyelven. */
export function confidenceExplanation(conf, sources) {
  const eff = sources?.effectiveN ?? 0;
  const base = {
    biztos: 'A források lényegében ugyanazt mondják, ez az előrejelzés megbízható.',
    enyhe: 'A források nagyjából egyetértenek, de van némi eltérés — a szám pár egységgel elmozdulhat.',
    bizonytalan: 'A források érdemben eltérnek. Ez inkább irányadó becslés, mint pontos érték.',
    megosztott: 'A források komolyan ellentmondanak egymásnak. Itt tényleg csak "talán" van — érdemes később újranézni.',
  }[conf.key];

  const indep =
    eff >= 6 ? '' : eff >= 3.5 ? ' Kevés a valóban független forrás, ez maga is növeli a kockázatot.' : ' Nagyon kevés független forrás áll rendelkezésre erre a helyre és időpontra.';

  return base + indep;
}

/** Az élő kalibráció eredményének összefoglalása. */
export function calibrationSummary(state) {
  if (!state.calibration || !state.useCalibration) {
    return 'Az élő kalibráció ki van kapcsolva — a súlyok a modellek hosszú távú, irodalmi beválásán alapulnak.';
  }
  const entries = Object.entries(state.calibration.mae)
    .filter(([id]) => state.availableIds.includes(id))
    .map(([id, m]) => ({ id, mae: m.temperature_2m }))
    .filter((x) => x.mae != null)
    .sort((a, b) => a.mae - b.mae);
  if (!entries.length) return 'Az élő kalibrációhoz nem érkezett elég visszamenőleges adat.';

  const best = MODEL_BY_ID[entries[0].id]?.short || entries[0].id;
  const worst = MODEL_BY_ID[entries[entries.length - 1].id]?.short || entries[entries.length - 1].id;
  if (entries.length < 2) {
    return `Az elmúlt ${state.calibration.days} napban ${withArticle(best)} hibája ${num(entries[0].mae, 2)} °C volt ezen a helyen.`;
  }
  return (
    `Az elmúlt ${state.calibration.days} napban ezen a helyen ${withArticle(best)} volt a legpontosabb ` +
    `(átlagos hőmérsékleti hiba ${num(entries[0].mae, 2)} °C), a leggyengébb ${withArticle(worst)} ` +
    `(${num(entries[entries.length - 1].mae, 2)} °C). A súlyozás ezt figyelembe veszi.`
  );
}

export { num, pct, withArticle };
