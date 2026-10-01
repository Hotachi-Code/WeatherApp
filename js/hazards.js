/**
 * hazards.js — Élő veszélyesemények hivatalos ügynökségektől.
 *
 * Az elv ugyanaz, mint a modelleknél: több független forrás, súlyozva.
 * Egy földrengést az amerikai USGS és az európai EMSC egymástól függetlenül
 * mér be; ha mindkettő jelenti, az megerősített esemény, és a két
 * magnitúdóból konszenzusérték számolható a szórással együtt.
 *
 * Ami csak egy forrásból jön, az is megjelenik — de kiírjuk róla, hogy
 * nincs megerősítve.
 */

/* ------------------------------------------------------------------ */
/* Forrásregiszter                                                     */
/* ------------------------------------------------------------------ */

export const HAZARD_SOURCES = {
  usgs: {
    id: 'usgs', name: 'USGS', org: 'Amerikai Geológiai Szolgálat', flag: '🇺🇸',
    official: true, trust: 1.00, covers: ['earthquake'],
    note: 'A világ földrengéseinek referenciakatalógusa.',
  },
  emsc: {
    id: 'emsc', name: 'EMSC', org: 'Európai-Mediterrán Szeizmológiai Központ', flag: '🇪🇺',
    official: true, trust: 0.97, covers: ['earthquake'],
    note: 'Az európai szeizmológiai hálózatok közös központja — Európában sűrűbb mérőhálózat.',
  },
  eonet: {
    id: 'eonet', name: 'NASA EONET', org: 'NASA Föld-megfigyelő eseménykövetés', flag: '🇺🇸',
    official: true, trust: 0.93, covers: ['wildfire', 'volcano', 'storm', 'flood', 'landslide', 'ice', 'drought', 'dustHaze', 'extremeTemp', 'manmade'],
    note: 'Műholdas megfigyelésből, több ügynökség adatát összefésülve.',
  },
  gdacs: {
    id: 'gdacs', name: 'GDACS', org: 'ENSZ–EU Globális Katasztrófariasztó Rendszer', flag: '🌐',
    official: true, trust: 0.95, covers: ['earthquake', 'storm', 'flood', 'volcano', 'drought', 'wildfire'],
    note: 'Az ENSZ és az Európai Bizottság közös riasztórendszere, hatásbecsléssel.',
  },
  nws: {
    id: 'nws', name: 'NWS', org: 'Amerikai Nemzeti Meteorológiai Szolgálat', flag: '🇺🇸',
    official: true, trust: 1.00, covers: ['alert'], region: 'US',
    note: 'Hivatalos amerikai veszélyjelzések. Csak az Egyesült Államok területén.',
  },
};

export const EVENT_TYPES = {
  earthquake:  { label: 'Földrengés',       icon: '🌍', radiusKm: 150 },
  wildfire:    { label: 'Erdőtűz',          icon: '🔥', radiusKm: 40 },
  volcano:     { label: 'Vulkán',           icon: '🌋', radiusKm: 100 },
  flood:       { label: 'Árvíz',            icon: '🌊', radiusKm: 60 },
  landslide:   { label: 'Földcsuszamlás',   icon: '⛰️', radiusKm: 25 },
  storm:       { label: 'Vihar, ciklon',    icon: '🌀', radiusKm: 250 },
  drought:     { label: 'Aszály',           icon: '🏜️', radiusKm: 200 },
  ice:         { label: 'Jégviszonyok',     icon: '🧊', radiusKm: 100 },
  dustHaze:    { label: 'Por, szmog',       icon: '🌫️', radiusKm: 150 },
  extremeTemp: { label: 'Hőmérsékleti szélsőség', icon: '🌡️', radiusKm: 150 },
  manmade:     { label: 'Ipari esemény',    icon: '🏭', radiusKm: 40 },
  alert:       { label: 'Hatósági riasztás', icon: '📢', radiusKm: 60 },
  tsunami:     { label: 'Szökőár',          icon: '🌊', radiusKm: 400 },
  other:       { label: 'Egyéb',            icon: '⚠️', radiusKm: 60 },
};

/* ------------------------------------------------------------------ */
/* Földrajzi segédfüggvények                                           */
/* ------------------------------------------------------------------ */

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const COMPASS = ['északra', 'északkeletre', 'keletre', 'délkeletre', 'délre', 'délnyugatra', 'nyugatra', 'északnyugatra'];

export function bearingLabel(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/**
 * Földrengés hatósugara a magnitúdóból.
 * Az „érezhető" a III-as Mercalli-fokozat környéke, a „károkozó" a VI-os.
 * Mindkettő durva, tapasztalati közelítés — a talajviszonyok sokat számítanak.
 */
export function quakeRadii(mag) {
  if (mag == null) return { felt: 50, damage: 10 };
  return {
    felt: Math.max(15, 10 ** (0.33 * mag + 0.45)),
    damage: Math.max(3, 10 ** (0.5 * mag - 1.5)),
  };
}

/* ------------------------------------------------------------------ */
/* Lekérdezők                                                          */
/* ------------------------------------------------------------------ */

const get = async (url, timeout = 20000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Több ügynökség üres törzzsel válaszol, ha nincs találat — ez nem hiba.
  const text = await r.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('értelmezhetetlen válasz');
  }
};

const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

async function fromUSGS(lat, lon, radiusKm, days) {
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lon}&maxradiuskm=${Math.min(2000, Math.round(radiusKm))}` +
    `&starttime=${isoDate(Date.now() - days * 864e5)}&minmagnitude=2.5&orderby=time&limit=200`;
  const d = await get(url);
  return (d?.features || []).map((f) => ({
    sourceId: 'usgs',
    extId: f.id,
    type: 'earthquake',
    title: f.properties.place || 'Földrengés',
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    depthKm: f.geometry.coordinates[2],
    time: f.properties.time,
    updated: f.properties.updated,
    magnitude: f.properties.mag,
    magnitudeUnit: f.properties.magType || 'M',
    reviewed: f.properties.status === 'reviewed',
    tsunami: !!f.properties.tsunami,
    url: f.properties.url,
  }));
}

async function fromEMSC(lat, lon, radiusKm, days) {
  const url =
    `https://www.seismicportal.eu/fdsnws/event/1/query?format=json` +
    `&lat=${lat}&lon=${lon}&maxradius=${Math.min(20, (radiusKm / 111).toFixed(2))}` +
    `&start=${isoDate(Date.now() - days * 864e5)}&minmag=2.5&limit=200`;
  const d = await get(url);
  return (d?.features || []).map((f) => {
    const p = f.properties;
    return {
      sourceId: 'emsc',
      extId: p.unid || p.source_id,
      type: 'earthquake',
      title: p.flynn_region || 'Földrengés',
      lat: p.lat,
      lon: p.lon,
      depthKm: p.depth,
      time: Date.parse(p.time),
      updated: Date.parse(p.lastupdate || p.time),
      magnitude: p.mag,
      magnitudeUnit: p.magtype || 'M',
      reviewed: p.auth === 'EMSC',
      url: `https://www.emsc-csem.org/Earthquake/earthquake.php?id=${p.source_id}`,
    };
  });
}

const EONET_TYPE = {
  wildfires: 'wildfire', volcanoes: 'volcano', severeStorms: 'storm', floods: 'flood',
  landslides: 'landslide', drought: 'drought', seaLakeIce: 'ice', dustHaze: 'dustHaze',
  tempExtremes: 'extremeTemp', manmade: 'manmade', earthquakes: 'earthquake', snow: 'ice',
  waterColor: 'other',
};

async function fromEONET(lat, lon, radiusKm, days) {
  // Nagyvonalú befoglaló téglalap; a pontos távolságot később számoljuk.
  const deg = Math.min(30, radiusKm / 90);
  const bbox = [lon - deg * 1.6, lat + deg, lon + deg * 1.6, lat - deg]
    .map((v) => v.toFixed(3)).join(',');
  const d = await get(
    `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${Math.min(120, days)}&bbox=${bbox}`,
  );
  return (d?.events || []).map((ev) => {
    const geoms = ev.geometry || [];
    const last = geoms[geoms.length - 1];
    const coords = last?.type === 'Point'
      ? last.coordinates
      : centroidOf(last?.coordinates);
    if (!coords) return null;
    return {
      sourceId: 'eonet',
      extId: ev.id,
      type: EONET_TYPE[ev.categories?.[0]?.id] || 'other',
      title: ev.title,
      lat: coords[1],
      lon: coords[0],
      time: Date.parse(last?.date || ev.geometry?.[0]?.date || Date.now()),
      updated: Date.parse(last?.date || Date.now()),
      magnitude: last?.magnitudeValue ?? null,
      magnitudeUnit: last?.magnitudeUnit || '',
      url: ev.link || ev.sources?.[0]?.url,
      /** Az EONET maga is több ügynökségből dolgozik — ezt megőrizzük. */
      subSources: (ev.sources || []).map((s) => s.id),
    };
  }).filter(Boolean);
}

function centroidOf(coords) {
  if (!Array.isArray(coords)) return null;
  const flat = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') flat.push(c);
    else c.forEach(walk);
  };
  walk(coords);
  if (!flat.length) return null;
  return [
    flat.reduce((s, c) => s + c[0], 0) / flat.length,
    flat.reduce((s, c) => s + c[1], 0) / flat.length,
  ];
}

const GDACS_TYPE = { EQ: 'earthquake', TC: 'storm', FL: 'flood', VO: 'volcano', DR: 'drought', WF: 'wildfire', TS: 'tsunami' };
const GDACS_SEVERITY = { Green: 0.25, Orange: 0.6, Red: 1.0 };

async function fromGDACS(days) {
  const d = await get(
    `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromdate=${isoDate(Date.now() - days * 864e5)}&pagesize=300`,
  );
  return (d?.features || []).map((f) => {
    const p = f.properties;
    const c = f.geometry?.coordinates;
    if (!c) return null;
    return {
      sourceId: 'gdacs',
      extId: `${p.eventtype}-${p.eventid}`,
      type: GDACS_TYPE[p.eventtype] || 'other',
      title: p.name || p.eventname || 'Esemény',
      description: p.severitydata?.severitytext || p.description || '',
      lat: c[1],
      lon: c[0],
      time: Date.parse(p.fromdate + 'Z'),
      endTime: p.todate ? Date.parse(p.todate + 'Z') : null,
      updated: Date.parse(p.datemodified || p.fromdate + 'Z'),
      magnitude: p.severitydata?.severity ?? null,
      magnitudeUnit: p.severitydata?.severityunit || '',
      alertLevel: p.alertlevel,
      severityHint: GDACS_SEVERITY[p.alertlevel] ?? 0.3,
      iso3: p.iso3,
      countries: p.country || '',
      url: p.url?.report,
      /** A sok országot érintő események centroidja félrevezető lehet. */
      wideArea: /,/.test(p.country || ''),
    };
  }).filter(Boolean);
}

async function fromNWS(lat, lon) {
  const d = await get(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
  const SEV = { Extreme: 1.0, Severe: 0.8, Moderate: 0.5, Minor: 0.3, Unknown: 0.3 };
  return (d?.features || []).map((f) => {
    const p = f.properties;
    return {
      sourceId: 'nws',
      extId: p.id,
      type: 'alert',
      title: p.event,
      description: p.headline || p.description?.slice(0, 400) || '',
      instruction: p.instruction || '',
      lat,
      lon,
      time: Date.parse(p.effective || p.sent),
      endTime: p.expires ? Date.parse(p.expires) : null,
      updated: Date.parse(p.sent),
      severityHint: SEV[p.severity] ?? 0.4,
      urgency: p.urgency,
      areaDesc: p.areaDesc,
      url: p.uri || p['@id'],
      /** A hatóság már eleve a helyre szabta — nem kell távolságot számolni. */
      pointMatched: true,
    };
  });
}

/** Az Egyesült Államok durva befoglalója, hogy ne küldjünk felesleges kérést. */
const US_BBOX = [18.0, -170.0, 72.0, -65.0];
const inUS = (lat, lon) =>
  lat >= US_BBOX[0] && lat <= US_BBOX[2] && lon >= US_BBOX[1] && lon <= US_BBOX[3];

/* ------------------------------------------------------------------ */
/* Összegyűjtés                                                        */
/* ------------------------------------------------------------------ */

export async function fetchHazardEvents(lat, lon, { radiusKm = 300, days = 14 } = {}) {
  const failed = {};
  const settle = (id, p) =>
    p.then((v) => v).catch((e) => {
      failed[id] = e.message || 'nem elérhető';
      return [];
    });

  const queried = ['usgs', 'emsc', 'eonet', 'gdacs'];
  const tasks = [
    settle('usgs', fromUSGS(lat, lon, Math.max(radiusKm, 500), days)),
    settle('emsc', fromEMSC(lat, lon, Math.max(radiusKm, 500), days)),
    settle('eonet', fromEONET(lat, lon, Math.max(radiusKm, 400), days)),
    settle('gdacs', fromGDACS(days)),
  ];
  if (inUS(lat, lon)) {
    queried.push('nws');
    tasks.push(settle('nws', fromNWS(lat, lon)));
  }

  const groups = await Promise.all(tasks);
  return { events: groups.flat(), failed, queried, fetchedAt: Date.now() };
}

/* ------------------------------------------------------------------ */
/* Kereszt-ellenőrzés: ugyanaz az esemény több forrásból                */
/* ------------------------------------------------------------------ */

/** Mekkora tér- és időbeli eltérésig tekintünk két jelentést egy eseménynek. */
const MATCH = {
  earthquake: { km: 180, hours: 0.15 },
  wildfire:   { km: 60,  hours: 168 },
  volcano:    { km: 40,  hours: 720 },
  flood:      { km: 120, hours: 168 },
  landslide:  { km: 40,  hours: 168 },
  storm:      { km: 300, hours: 48 },
  drought:    { km: 600, hours: 2160 },
  default:    { km: 120, hours: 168 },
};

export function corroborate(events) {
  const clusters = [];

  for (const ev of events) {
    const rule = MATCH[ev.type] || MATCH.default;
    const hit = clusters.find((c) => {
      if (c.type !== ev.type) return false;
      if (c.reports.some((r) => r.sourceId === ev.sourceId)) return false;
      const d = haversineKm(c.lat, c.lon, ev.lat, ev.lon);
      const dt = Math.abs(c.time - ev.time) / 3600000;
      return d <= rule.km && dt <= rule.hours;
    });

    if (hit) {
      hit.reports.push(ev);
      // A pozíciót és időt a megbízhatóbb forrás felé húzzuk.
      const w = HAZARD_SOURCES[ev.sourceId]?.trust ?? 0.5;
      const wc = hit.weightSum;
      hit.lat = (hit.lat * wc + ev.lat * w) / (wc + w);
      hit.lon = (hit.lon * wc + ev.lon * w) / (wc + w);
      hit.weightSum += w;
      hit.time = Math.min(hit.time, ev.time);
      hit.updated = Math.max(hit.updated || 0, ev.updated || 0);
    } else {
      clusters.push({
        type: ev.type,
        lat: ev.lat,
        lon: ev.lon,
        time: ev.time,
        updated: ev.updated,
        weightSum: HAZARD_SOURCES[ev.sourceId]?.trust ?? 0.5,
        reports: [ev],
      });
    }
  }

  for (const c of clusters) finalizeCluster(c);
  return clusters;
}

function finalizeCluster(c) {
  const sources = [...new Set(c.reports.map((r) => r.sourceId))];
  const officials = sources.filter((s) => HAZARD_SOURCES[s]?.official);

  // Az EONET maga is több ügynökség adatát fésüli össze — ezt beszámítjuk
  // megerősítésként, de kisebb súllyal, mert nem teljesen független.
  const subSources = [...new Set(c.reports.flatMap((r) => r.subSources || []))];

  c.sources = sources;
  c.officialSources = officials;
  c.subSources = subSources;

  const independent = officials.length + Math.min(2, subSources.length) * 0.5;
  c.confirmation =
    officials.length >= 2 ? 'megerosítve-tobb'
      : officials.length === 1 && subSources.length >= 2 ? 'megerosítve-tobb'
      : officials.length === 1 ? 'hivatalos-egy'
      : 'nem-megerosítve';

  c.confirmationLabel = {
    'megerosítve-tobb': 'Több független hivatalos forrás megerősítette',
    'hivatalos-egy': 'Egy hivatalos forrás jelenti',
    'nem-megerosítve': 'Nincs hivatalos megerősítés',
  }[c.confirmation];

  c.confirmationStatus = {
    'megerosítve-tobb': 'good',
    'hivatalos-egy': 'warning',
    'nem-megerosítve': 'serious',
  }[c.confirmation];

  c.independence = independent;

  /* --- Konszenzus-magnitúdó, ha több forrás mérte --- */
  const mags = c.reports
    .filter((r) => r.magnitude != null && Number.isFinite(r.magnitude))
    .map((r) => ({ v: r.magnitude, w: HAZARD_SOURCES[r.sourceId]?.trust ?? 0.5, id: r.sourceId }));

  if (mags.length) {
    const tot = mags.reduce((s, m) => s + m.w, 0);
    const mean = mags.reduce((s, m) => s + m.w * m.v, 0) / tot;
    const spread = mags.length > 1
      ? Math.sqrt(mags.reduce((s, m) => s + m.w * (m.v - mean) ** 2, 0) / tot)
      : 0;
    c.magnitude = mean;
    c.magnitudeSpread = spread;
    c.magnitudeUnit = c.reports.find((r) => r.magnitudeUnit)?.magnitudeUnit || '';
    c.magnitudeReports = mags;
  }

  const primary = c.reports.slice().sort(
    (a, b) => (HAZARD_SOURCES[b.sourceId]?.trust ?? 0) - (HAZARD_SOURCES[a.sourceId]?.trust ?? 0),
  )[0];
  c.title = primary.title;
  c.description = c.reports.find((r) => r.description)?.description || '';
  c.url = primary.url;
  c.alertLevel = c.reports.find((r) => r.alertLevel)?.alertLevel || null;
  c.severityHint = Math.max(...c.reports.map((r) => r.severityHint ?? 0), 0);
  c.depthKm = c.reports.find((r) => r.depthKm != null)?.depthKm ?? null;
  c.tsunami = c.reports.some((r) => r.tsunami);
  c.instruction = c.reports.find((r) => r.instruction)?.instruction || '';
  c.areaDesc = c.reports.find((r) => r.areaDesc)?.areaDesc || '';
  c.countries = c.reports.find((r) => r.countries)?.countries || '';
  c.iso3 = c.reports.find((r) => r.iso3)?.iso3 || null;
  c.wideArea = c.reports.some((r) => r.wideArea);
  c.pointMatched = c.reports.some((r) => r.pointMatched);
  c.endTime = c.reports.map((r) => r.endTime).filter(Boolean).sort((a, b) => b - a)[0] || null;
}

/* ------------------------------------------------------------------ */
/* Személyes fenyegetettség                                            */
/* ------------------------------------------------------------------ */

/**
 * Mennyire érint ez engem, itt, most?
 *
 * Nem az a kérdés, történt-e valami, hanem hogy a hatóköre elér-e idáig.
 * Egy M6-os rengés 800 km-re nem érdekes; egy M3-as 10 km-re igen.
 */
export function assessThreat(cluster, lat, lon, { countryEn = null, watchRadiusKm = 300 } = {}) {
  const meta = EVENT_TYPES[cluster.type] || EVENT_TYPES.other;
  const distance = haversineKm(lat, lon, cluster.lat, cluster.lon);
  const ageHours = (Date.now() - cluster.time) / 3600000;

  /* Hatósugár típusonként. */
  let feltRadius = meta.radiusKm;
  let damageRadius = meta.radiusKm * 0.35;
  if (cluster.type === 'earthquake') {
    const r = quakeRadii(cluster.magnitude);
    feltRadius = r.felt;
    damageRadius = r.damage;
  } else if (cluster.severityHint) {
    feltRadius = meta.radiusKm * (0.6 + cluster.severityHint);
    damageRadius = feltRadius * 0.35;
  }

  /* Az országlista alapján is érinthet, ha a centroid messze esik
     (több országon átnyúló aszály, árvíz). */
  const countryMatch =
    !!countryEn && !!cluster.countries &&
    cluster.countries.toLowerCase().includes(countryEn.toLowerCase());

  const inRange = distance <= feltRadius || countryMatch || cluster.pointMatched;

  /* Közelség: 1, ha a károkozó sugáron belül vagyunk; 0, ha az érezhetőn kívül. */
  let proximity;
  if (cluster.pointMatched) proximity = 1;
  else if (distance <= damageRadius) proximity = 1;
  else if (distance <= feltRadius) proximity = 1 - (distance - damageRadius) / Math.max(1, feltRadius - damageRadius) * 0.7;
  else if (countryMatch) proximity = 0.25;
  else proximity = 0;

  /* Frissesség.
     A csillapítást NEM a kezdéstől számoljuk, hanem az utolsó frissítéstől:
     egy fél éve tartó aszály vagy egy hetek óta égő erdőtűz ma is aktív,
     miközben a kezdete régen volt. A hirtelen események (földrengés)
     ezzel szemben gyorsan veszítenek jelentőségükből. */
  const reference = Math.max(cluster.time || 0, cluster.updated || 0);
  const sinceUpdate = (Date.now() - reference) / 3600000;
  const decay = {
    earthquake: 30, alert: 72, storm: 120, flood: 336,
    wildfire: 240, landslide: 240, volcano: 720, drought: 1440, ice: 480,
  }[cluster.type] || 240;
  const recency = Math.exp(-Math.max(0, sinceUpdate) / decay);
  const expired = cluster.endTime && cluster.endTime < Date.now() - 3600000;

  /* Súlyosság. */
  let severity = cluster.severityHint || 0.3;
  if (cluster.type === 'earthquake' && cluster.magnitude != null) {
    severity = Math.min(1, Math.max(0.1, (cluster.magnitude - 2.5) / 5));
  }

  const confirmationFactor =
    cluster.confirmation === 'megerosítve-tobb' ? 1
      : cluster.confirmation === 'hivatalos-egy' ? 0.85
      : 0.55;

  const threat = expired ? 0 : proximity * severity * recency * confirmationFactor;

  /* Két külön kérdés, és nem szabad összemosni őket:
     „veszélyes-e rám nézve?" és „történt-e valami a környéken?".
     A második akkor is érdekes, ha a válasz az elsőre nem — épp az a
     megnyugtató információ, hogy a rengés nem ért idáig.
     Ezért itt nem a fenyegetettség csillapítását használjuk, hanem egy
     tágabb, típusfüggő időablakot. */
  const interestRadius = Math.max(feltRadius * 2.5, 60);
  const interestWindowH = {
    earthquake: 7 * 24, alert: 3 * 24, storm: 14 * 24, flood: 21 * 24,
    wildfire: 21 * 24, landslide: 21 * 24, volcano: 30 * 24, drought: 60 * 24,
  }[cluster.type] || 21 * 24;

  const nearby =
    !expired &&
    sinceUpdate <= interestWindowH &&
    (distance <= Math.min(interestRadius, watchRadiusKm) || countryMatch || cluster.pointMatched);

  return {
    ...cluster,
    meta,
    distance,
    bearing: bearingLabel(lat, lon, cluster.lat, cluster.lon),
    ageHours,
    sinceUpdate,
    feltRadius,
    damageRadius,
    interestRadius,
    countryMatch,
    inRange: inRange && !expired,
    proximity,
    recency,
    severity,
    expired,
    threat,
    /** Aktív fenyegetés: elér idáig, és most is él. */
    active: threat >= 0.12,
    /** Egyáltalán megjelenik-e a listában. */
    relevant: nearby,
  };
}

/** A teljes feldolgozási lánc egy lépésben. */
export function processHazards(raw, lat, lon, opts = {}) {
  const clusters = corroborate(raw.events || []);
  const assessed = clusters
    .map((c) => assessThreat(c, lat, lon, opts))
    .filter((c) => c.relevant)
    .sort((a, b) => b.threat - a.threat || b.updated - a.updated);

  return {
    threats: assessed.filter((c) => c.active),
    nearby: assessed.filter((c) => !c.active),
    all: clusters.length,
    failed: raw.failed || {},
    fetchedAt: raw.fetchedAt,
    queried: raw.queried || [],
    sourcesUsed: [...new Set((raw.events || []).map((e) => e.sourceId))],
  };
}
