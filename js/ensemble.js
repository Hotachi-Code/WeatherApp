/**
 * ensemble.js — A konszenzus-számítás magja.
 *
 * Itt dől el, hogy a sok, egymásnak gyakran ellentmondó modellből mi lesz
 * a végső szám, és mennyire lehet benne megbízni. A logika négy lépés:
 *
 *   1. SÚLYOZÁS  — minden modell annyit nyom a latban, amennyit a hosszú
 *      távú beválása, a felbontása, az előrejelzési táv és a helyben mért
 *      friss hibája indokol.
 *   2. FÜGGETLENSÉG — azonos intézet modelljei nem számítanak külön
 *      véleménynek (az ECMWF IFS és AIFS ugyanabból az adatasszimilációból
 *      indul), ezért a családon belül osztozniuk kell a súlyon.
 *   3. SZÓRÁS — a súlyozott átlag mellé súlyozott szórást és kvantiliseket
 *      is számolunk; ez adja a "talán" mértékét.
 *   4. EGYETÉRTÉS — igen/nem jellegű eseményeknél (esik-e?) nem átlagolunk,
 *      hanem szavaztatunk: a súlyozott szavazatarány maga a valószínűség.
 */

import { APP, VARS, MODEL_BY_ID, wmoGroup, GROUP_LABEL } from './config.js';

/* ------------------------------------------------------------------ */
/* Súlyozott statisztika                                               */
/* ------------------------------------------------------------------ */

/**
 * Súlyozott átlag, szórás és kvantilisek.
 * A szórásnál megbízhatósági súlyokra érvényes torzítatlan becslést
 * használunk: var = Σw(x-μ)² / (1 - Σw²), ahol Σw = 1.
 */
export function weightedStats(pairs) {
  const items = pairs.filter((p) => p.v != null && Number.isFinite(p.v) && p.w > 0);
  if (!items.length) return null;

  const total = items.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return null;
  const norm = items.map((p) => ({ ...p, w: p.w / total }));

  const mean = norm.reduce((s, p) => s + p.w * p.v, 0);
  const sumW2 = norm.reduce((s, p) => s + p.w * p.w, 0);
  const denom = 1 - sumW2;
  const rawVar = norm.reduce((s, p) => s + p.w * (p.v - mean) ** 2, 0);
  const variance = denom > 1e-9 ? rawVar / denom : rawVar;
  const std = Math.sqrt(Math.max(0, variance));

  const sorted = [...norm].sort((a, b) => a.v - b.v);
  const quantile = (q) => {
    let acc = 0;
    for (let i = 0; i < sorted.length; i++) {
      const lo = acc;
      acc += sorted[i].w;
      // A súly "közepéhez" rendeljük a mintát, és lineárisan interpolálunk.
      const mid = lo + sorted[i].w / 2;
      if (q <= mid) {
        if (i === 0) return sorted[0].v;
        const prev = sorted[i - 1];
        const prevMid = lo - prev.w / 2;
        const f = (q - prevMid) / Math.max(1e-9, mid - prevMid);
        return prev.v + f * (sorted[i].v - prev.v);
      }
    }
    return sorted[sorted.length - 1].v;
  };

  return {
    mean,
    median: quantile(0.5),
    p10: quantile(0.1),
    p25: quantile(0.25),
    p75: quantile(0.75),
    p90: quantile(0.9),
    min: sorted[0].v,
    max: sorted[sorted.length - 1].v,
    std,
    /** Kish-féle effektív mintaszám: hány "igazi" független vélemény van. */
    effectiveN: 1 / sumW2,
    count: items.length,
    totalWeight: total,
  };
}

/** Szélirányhoz: körkörös (0–360°) súlyozott átlag és szórás. */
export function circularStats(pairs) {
  const items = pairs.filter((p) => p.v != null && Number.isFinite(p.v) && p.w > 0);
  if (!items.length) return null;
  const total = items.reduce((s, p) => s + p.w, 0);
  let x = 0;
  let y = 0;
  for (const p of items) {
    const r = (p.v * Math.PI) / 180;
    x += (p.w / total) * Math.cos(r);
    y += (p.w / total) * Math.sin(r);
  }
  const R = Math.min(1, Math.hypot(x, y));
  let mean = (Math.atan2(y, x) * 180) / Math.PI;
  if (mean < 0) mean += 360;
  const std = R > 1e-6 ? (Math.sqrt(-2 * Math.log(R)) * 180) / Math.PI : 180;
  return { mean, median: mean, std, min: mean, max: mean, p10: mean, p90: mean, p25: mean, p75: mean, effectiveN: items.length, count: items.length, totalWeight: total, concentration: R };
}

/* ------------------------------------------------------------------ */
/* Súlyok                                                              */
/* ------------------------------------------------------------------ */

/** Melyik kalibrációs mérőszám vonatkozik melyik változóra. */
const CAL_PROXY = {
  temperature_2m: 'temperature_2m',
  apparent_temperature: 'temperature_2m',
  dew_point_2m: 'temperature_2m',
  relative_humidity_2m: 'temperature_2m',
  surface_pressure: 'temperature_2m',
  cloud_cover: 'precipitation',
  precipitation: 'precipitation',
  snowfall: 'precipitation',
  weather_code: 'precipitation',
  wind_speed_10m: 'wind_speed_10m',
  wind_gusts_10m: 'wind_speed_10m',
  wind_direction_10m: 'wind_speed_10m',
};

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * A helyben mért friss hiba alapján számolt szorzó modellenként.
 * Aki a mezőny mediánjánál pontosabb volt, felfelé, aki pontatlanabb,
 * lefelé módosul — de korlátozott mértékben, hogy pár nap zaja ne
 * forgassa fel a súlyozást.
 */
export function calibrationFactors(calibration, modelIds) {
  const factors = {};
  if (!calibration || !calibration.mae) return factors;

  for (const metric of ['temperature_2m', 'precipitation', 'wind_speed_10m']) {
    const vals = modelIds
      .map((id) => calibration.mae[id]?.[metric])
      .filter((v) => v != null && Number.isFinite(v) && v >= 0);
    const med = median(vals);
    if (med == null || med <= 0) continue;

    for (const id of modelIds) {
      const mae = calibration.mae[id]?.[metric];
      if (mae == null || !Number.isFinite(mae)) continue;
      const ratio = med / Math.max(mae, med * 0.15);
      const f = Math.min(1.8, Math.max(0.55, Math.pow(ratio, 0.7)));
      (factors[id] ||= {})[metric] = f;
    }
  }
  return factors;
}

/**
 * Egy modell nyers súlya adott előrejelzési távra és változóra.
 * A normalizálás (hogy az összeg 1 legyen) később, a mezőny ismeretében
 * történik, mert csak akkor derül ki, ki adott egyáltalán adatot.
 */
export function rawWeight(model, leadHours, variable, opts = {}) {
  const { calFactors = {}, familyPenalty = {}, useCalibration = true } = opts;
  if (leadHours > model.maxLead) return 0;

  let w = model.skill;

  // Az előny kopása az idővel.
  w *= Math.exp(-Math.max(0, leadHours) / model.tau);

  // A nagy felbontású regionális modellek rövid távon többet tudnak.
  if (model.scope === 'regional') {
    w *= 1 + 0.25 * Math.exp(-Math.max(0, leadHours) / 30);
  }

  // Helyben mért friss beválás.
  if (useCalibration) {
    const f = calFactors[model.id]?.[CAL_PROXY[variable] || 'temperature_2m'];
    if (f) w *= f;
  }

  // Azonos intézet modelljei nem független vélemények.
  w *= familyPenalty[model.family] ?? 1;

  return Math.max(0, w);
}

/** Családonként 1/√n büntetés az elérhető modellek alapján. */
export function familyPenalties(availableIds) {
  const counts = {};
  for (const id of availableIds) {
    const m = MODEL_BY_ID[id];
    if (m) counts[m.family] = (counts[m.family] || 0) + 1;
  }
  const out = {};
  for (const [fam, n] of Object.entries(counts)) out[fam] = 1 / Math.sqrt(n);
  return out;
}

/* ------------------------------------------------------------------ */
/* Bizonytalanság → emberi címke                                       */
/* ------------------------------------------------------------------ */

export const CONFIDENCE_LEVELS = [
  { min: 0.70, key: 'biztos',      label: 'Biztos',              status: 'good',     icon: '✔' },
  { min: 0.50, key: 'enyhe',       label: 'Enyhén bizonytalan',  status: 'warning',  icon: '◐' },
  { min: 0.30, key: 'bizonytalan', label: 'Bizonytalan',         status: 'serious',  icon: '?' },
  { min: -1,   key: 'megosztott',  label: 'Erősen megosztott',   status: 'critical', icon: '!' },
];

export function confidenceLevel(score) {
  return CONFIDENCE_LEVELS.find((l) => score >= l.min) || CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];
}

/** Egy folytonos változó bizonyossága a szórásából. */
function continuousConfidence(std, variable) {
  const scale = VARS[variable]?.sigmaScale || 3;
  if (std == null) return 0;
  return Math.max(0, 1 - Math.min(1, std / scale));
}

/* ------------------------------------------------------------------ */
/* Az ensemble felépítése                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {object} raw     a fetchEnsemble eredménye
 * @param {object} options { calibration, useCalibration, rejectOutliers }
 */
export function buildEnsemble(raw, options = {}) {
  const { calibration = null, useCalibration = APP.calibrationEnabled, rejectOutliers = true } = options;

  const availableIds = Object.keys(raw.models);
  const models = availableIds.map((id) => MODEL_BY_ID[id]).filter(Boolean);
  const famPen = familyPenalties(availableIds);
  const calFactors = useCalibration ? calibrationFactors(calibration, availableIds) : {};

  const time = raw.time;
  const utcOffset = (raw.utcOffsetSeconds ?? 0) * 1000;
  const nowLocal = Date.now() + utcOffset;
  // A naiv, helyi idejű ISO-stringeket UTC-ként olvasva a különbség
  // közvetlenül az előrejelzési táv órában.
  const stamps = time.map((t) => Date.parse(`${t}:00Z`));
  const leads = stamps.map((s) => (s - nowLocal) / 3600000);

  // Az "aktuális óra" indexe.
  let nowIndex = 0;
  for (let i = 0; i < leads.length; i++) {
    if (leads[i] <= 0) nowIndex = i;
    else break;
  }

  const ctx = { calFactors, familyPenalty: famPen, useCalibration };

  const hours = time.map((t, i) => {
    const lead = Math.max(0, leads[i]);
    const vars = {};

    for (const variable of Object.keys(VARS)) {
      if (variable === 'weather_code') continue;
      const pairs = [];
      for (const m of models) {
        const series = raw.models[m.id][variable];
        const v = series ? series[i] : null;
        if (v == null) continue;
        const w = rawWeight(m, lead, variable, ctx);
        if (w > 0) pairs.push({ id: m.id, v, w });
      }
      if (!pairs.length) {
        vars[variable] = null;
        continue;
      }

      const circular = VARS[variable].circular;
      let stat = circular ? circularStats(pairs) : weightedStats(pairs);
      if (!stat) {
        vars[variable] = null;
        continue;
      }

      // Kilógó modellek kiszűrése, majd újraszámolás nélkülük.
      let outliers = [];
      if (rejectOutliers && !circular && stat.std > 0 && pairs.length >= 5) {
        const limit = APP.outlierSigma * stat.std;
        const keep = [];
        for (const p of pairs) {
          if (Math.abs(p.v - stat.mean) > limit && limit > 0.05) outliers.push(p.id);
          else keep.push(p);
        }
        if (outliers.length && keep.length >= 3) {
          const trimmed = weightedStats(keep);
          if (trimmed) stat = { ...trimmed, rawMean: stat.mean, rawStd: stat.std };
        } else {
          outliers = [];
        }
      }

      stat.outliers = outliers;
      stat.confidence = continuousConfidence(stat.std, variable);
      vars[variable] = stat;
    }

    /* --- Csapadék: nem átlagolunk, hanem szavaztatunk --- */
    const precipVote = voteEvent(models, raw, i, lead, 'precipitation', APP.precipThreshold, ctx);
    const snowVote = voteEvent(models, raw, i, lead, 'snowfall', 0.1, ctx);

    /* --- Időjárási típus: súlyozott szavazás --- */
    const weather = voteWeather(models, raw, i, lead, ctx);

    /* --- Összesített bizonyosság --- */
    const cTemp = vars.temperature_2m?.confidence ?? 0;
    const cWind = vars.wind_speed_10m?.confidence ?? 0;
    const cPrecip = precipVote ? Math.abs(2 * precipVote.probability - 1) : 0;
    const effN = vars.temperature_2m?.effectiveN ?? 0;
    const coverage = Math.min(1, effN / 6);
    const score = 0.34 * cTemp + 0.34 * cPrecip + 0.14 * cWind + 0.18 * coverage;

    return {
      time: t,
      timestamp: stamps[i],
      lead,
      isPast: leads[i] < -0.001,
      vars,
      precip: precipVote,
      snow: snowVote,
      weather,
      sources: {
        used: vars.temperature_2m?.count ?? 0,
        candidates: models.length,
        effectiveN: effN,
      },
      confidence: { score, ...confidenceLevel(score) },
    };
  });

  return {
    time,
    hours,
    nowIndex,
    utcOffsetSeconds: raw.utcOffsetSeconds ?? 0,
    models,
    availableIds,
    unavailable: raw.unavailable || {},
    familyPenalty: famPen,
    calFactors,
    calibration,
    useCalibration,
    rejectOutliers,
    fetchedAt: raw.fetchedAt,
    lat: raw.lat,
    lon: raw.lon,
    raw,
    days: buildDays(raw, models, leads, stamps, ctx),
  };
}

/** Igen/nem esemény súlyozott szavazása (pl. esik-e egyáltalán). */
function voteEvent(models, raw, i, lead, variable, threshold, ctx) {
  let wYes = 0;
  let wTotal = 0;
  let amountSum = 0;
  let wetSum = 0;
  let wetWeight = 0;
  const yes = [];
  const no = [];

  for (const m of models) {
    const series = raw.models[m.id][variable];
    const v = series ? series[i] : null;
    if (v == null) continue;
    const w = ctx ? rawWeight(m, lead, variable, ctx) : 0;
    if (w <= 0) continue;
    wTotal += w;
    amountSum += w * v;
    if (v >= threshold) {
      wYes += w;
      wetSum += w * v;
      wetWeight += w;
      yes.push({ id: m.id, v, w });
    } else {
      no.push({ id: m.id, v, w });
    }
  }
  if (wTotal <= 0) return null;

  return {
    probability: wYes / wTotal,
    /** Várható mennyiség (a száraz modellek nulláival együtt). */
    expected: amountSum / wTotal,
    /** Mennyiség arra az esetre, ha tényleg esik. */
    conditional: wetWeight > 0 ? wetSum / wetWeight : 0,
    yesCount: yes.length,
    noCount: no.length,
    total: yes.length + no.length,
    yes,
    no,
  };
}

/** Az időjárási típus súlyozott szavazása, csoportosított WMO-kódokon. */
function voteWeather(models, raw, i, lead, ctx) {
  const tally = {};
  let total = 0;
  for (const m of models) {
    const series = raw.models[m.id].weather_code;
    const code = series ? series[i] : null;
    const g = wmoGroup(code);
    if (!g) continue;
    const w = rawWeight(m, lead, 'weather_code', ctx);
    if (w <= 0) continue;
    total += w;
    (tally[g] ||= { weight: 0, ids: [] });
    tally[g].weight += w;
    tally[g].ids.push(m.id);
  }
  if (!total) return null;

  const votes = Object.entries(tally)
    .map(([group, d]) => ({
      group,
      label: GROUP_LABEL[group]?.[0] || group,
      icon: GROUP_LABEL[group]?.[1] || '🌡️',
      share: d.weight / total,
      ids: d.ids,
      count: d.ids.length,
    }))
    .sort((a, b) => b.share - a.share);

  return { top: votes[0], votes, agreement: votes[0].share };
}

/* ------------------------------------------------------------------ */
/* Napi összegzés                                                      */
/* ------------------------------------------------------------------ */

/**
 * A napi értékeket NEM az órás konszenzusból számoljuk, hanem minden
 * modellnél külön képezzük a napi maximumot/minimumot/összeget, és csak
 * utána súlyozunk. Így a napi szórás valóban a modellek közti eltérést
 * mutatja, nem az órás átlagolás mellékhatását.
 */
function buildDays(raw, models, leads, stamps, ctx) {
  const dayKeys = raw.time.map((t) => t.slice(0, 10));
  const order = [];
  const buckets = new Map();
  raw.time.forEach((t, i) => {
    const k = dayKeys[i];
    if (!buckets.has(k)) {
      buckets.set(k, []);
      order.push(k);
    }
    buckets.get(k).push(i);
  });

  return order.map((key) => {
    const idx = buckets.get(key);
    const lead = Math.max(0, leads[idx[Math.floor(idx.length / 2)]] ?? 0);
    const complete = idx.length >= 20;

    const per = { tmax: [], tmin: [], precipSum: [], windMax: [], gustMax: [], cloudMean: [] };
    const wetVotes = { yes: 0, total: 0, yesIds: [], noIds: [] };
    const weatherTally = {};
    let weatherTotal = 0;

    for (const m of models) {
      const mm = raw.models[m.id];
      const grab = (v, fn) => {
        const s = mm[v];
        if (!s) return null;
        const vals = idx.map((i) => s[i]).filter((x) => x != null);
        // Napi szélsőérték csak akkor érdemi, ha a nap nagy része megvan.
        if (vals.length < Math.min(idx.length, 18)) return null;
        return fn(vals);
      };
      const w = rawWeight(m, lead, 'temperature_2m', ctx);
      const wp = rawWeight(m, lead, 'precipitation', ctx);
      if (w <= 0 && wp <= 0) continue;

      const tmax = grab('temperature_2m', (a) => Math.max(...a));
      const tmin = grab('temperature_2m', (a) => Math.min(...a));
      const psum = grab('precipitation', (a) => a.reduce((s, x) => s + x, 0));
      const wmax = grab('wind_speed_10m', (a) => Math.max(...a));
      const gmax = grab('wind_gusts_10m', (a) => Math.max(...a));
      const cmean = grab('cloud_cover', (a) => a.reduce((s, x) => s + x, 0) / a.length);

      if (tmax != null && w > 0) per.tmax.push({ id: m.id, v: tmax, w });
      if (tmin != null && w > 0) per.tmin.push({ id: m.id, v: tmin, w });
      if (wmax != null && w > 0) per.windMax.push({ id: m.id, v: wmax, w });
      if (gmax != null && w > 0) per.gustMax.push({ id: m.id, v: gmax, w });
      if (cmean != null && w > 0) per.cloudMean.push({ id: m.id, v: cmean, w });
      if (psum != null && wp > 0) {
        per.precipSum.push({ id: m.id, v: psum, w: wp });
        wetVotes.total += wp;
        if (psum >= 0.5) {
          wetVotes.yes += wp;
          wetVotes.yesIds.push(m.id);
        } else {
          wetVotes.noIds.push(m.id);
        }
      }

      // A nap jellegét a legsúlyosabb olyan kód adja, ami legalább két
      // órán át fennáll. Így egyetlen kósza óra nem nevez el egy napot
      // zivatarosnak, de a hajnali eső sem tűnik el a napi címkéből —
      // különben "kissé felhős" nap kerülne 70%-os esőesély mellé.
      const codes = mm.weather_code;
      if (codes) {
        const vals = idx.map((i) => codes[i]).filter((x) => x != null);
        if (vals.length) {
          const counts = new Map();
          for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
          const persistent = [...counts.entries()].filter(([, n]) => n >= 2).map(([v]) => v);
          const g = wmoGroup(persistent.length ? Math.max(...persistent) : Math.max(...vals));
          if (g) {
            weatherTotal += wp || w;
            (weatherTally[g] ||= { weight: 0, ids: [] });
            weatherTally[g].weight += wp || w;
            weatherTally[g].ids.push(m.id);
          }
        }
      }
    }

    const stat = (arr) => (arr.length ? weightedStats(arr) : null);
    const tmax = stat(per.tmax);
    const tmin = stat(per.tmin);
    const precip = stat(per.precipSum);
    const wind = stat(per.windMax);
    const gust = stat(per.gustMax);
    const cloud = stat(per.cloudMean);

    const votes = Object.entries(weatherTally)
      .map(([group, d]) => ({
        group,
        label: GROUP_LABEL[group]?.[0] || group,
        icon: GROUP_LABEL[group]?.[1] || '🌡️',
        share: weatherTotal ? d.weight / weatherTotal : 0,
        ids: d.ids,
        count: d.ids.length,
      }))
      .sort((a, b) => b.share - a.share);

    const precipProb = wetVotes.total > 0 ? wetVotes.yes / wetVotes.total : null;
    const cT = tmax ? continuousConfidence(tmax.std, 'temperature_2m') : 0;
    const cP = precipProb != null ? Math.abs(2 * precipProb - 1) : 0;
    const coverage = Math.min(1, (tmax?.effectiveN ?? 0) / 6);
    const score = 0.38 * cT + 0.38 * cP + 0.24 * coverage;

    return {
      date: key,
      timestamp: stamps[idx[0]],
      lead,
      complete,
      /** Teljesen lezárult nap: a visszamenőleges adatok miatt ilyen is van. */
      isPast: leads[idx[idx.length - 1]] < 0,
      hourIndexes: idx,
      tmax,
      tmin,
      precip,
      precipProb,
      precipVotes: { yes: wetVotes.yesIds, no: wetVotes.noIds },
      wind,
      gust,
      cloud,
      weather: votes.length ? { top: votes[0], votes, agreement: votes[0].share } : null,
      sources: { used: tmax?.count ?? 0, candidates: models.length, effectiveN: tmax?.effectiveN ?? 0 },
      confidence: { score, ...confidenceLevel(score) },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Részletek igény szerint                                             */
/* ------------------------------------------------------------------ */

/**
 * Egy adott óra egy adott változójára visszaadja modellenként a
 * konkrét értéket, a súlyt és a konszenzustól való eltérést.
 * Csak megjelenítéskor hívjuk, így nem tárolunk feleslegesen
 * több tízezer objektumot a memóriában.
 */
export function membersAt(state, hourIndex, variable) {
  const hour = state.hours[hourIndex];
  if (!hour) return [];
  const stat = hour.vars[variable];
  const ctx = { calFactors: state.calFactors, familyPenalty: state.familyPenalty, useCalibration: state.useCalibration };

  const rows = [];
  let totalW = 0;
  for (const m of state.models) {
    const series = state.raw.models[m.id][variable];
    const v = series ? series[hourIndex] : null;
    const w = v == null ? 0 : rawWeight(m, hour.lead, variable, ctx);
    if (v != null && w > 0) totalW += w;
    rows.push({
      model: m,
      value: v,
      weight: w,
      available: v != null && w > 0,
      reason: v == null
        ? (state.unavailable[m.id] || 'Erre az órára nem ad értéket')
        : hour.lead > m.maxLead
          ? `Csak ${m.maxLead} órára előre számol`
          : null,
    });
  }

  for (const r of rows) {
    r.share = totalW > 0 && r.available ? r.weight / totalW : 0;
    r.deviation = r.available && stat ? r.value - stat.mean : null;
    r.outlier = !!(stat?.outliers || []).includes(r.model.id);
  }

  rows.sort((a, b) => b.share - a.share || (a.model.short > b.model.short ? 1 : -1));
  return rows;
}

/** Ugyanez napi szintre (napi max/min/csapadék modellenként). */
export function dayMembers(state, dayIndex, kind) {
  const day = state.days[dayIndex];
  if (!day) return [];
  const ctx = { calFactors: state.calFactors, familyPenalty: state.familyPenalty, useCalibration: state.useCalibration };
  const variable = kind === 'precip' ? 'precipitation' : kind === 'wind' ? 'wind_speed_10m' : 'temperature_2m';
  const reduce = {
    tmax: (a) => Math.max(...a),
    tmin: (a) => Math.min(...a),
    precip: (a) => a.reduce((s, x) => s + x, 0),
    wind: (a) => Math.max(...a),
  }[kind];

  const stat = day[kind === 'precip' ? 'precip' : kind === 'wind' ? 'wind' : kind];
  const rows = [];
  let totalW = 0;

  for (const m of state.models) {
    const series = state.raw.models[m.id][variable];
    let value = null;
    if (series) {
      const vals = day.hourIndexes.map((i) => series[i]).filter((x) => x != null);
      if (vals.length >= Math.min(day.hourIndexes.length, 18)) value = reduce(vals);
    }
    const w = value == null ? 0 : rawWeight(m, day.lead, variable, ctx);
    if (value != null && w > 0) totalW += w;
    rows.push({ model: m, value, weight: w, available: value != null && w > 0 });
  }

  for (const r of rows) {
    r.share = totalW > 0 && r.available ? r.weight / totalW : 0;
    r.deviation = r.available && stat ? r.value - stat.mean : null;
  }
  rows.sort((a, b) => b.share - a.share);
  return rows;
}
