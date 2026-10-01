/**
 * news.js — Biztonsági szempontból releváns hírek, megerősítés-ellenőrzéssel.
 *
 * A hír a leggyengébb láncszem: egyetlen cikk bármit állíthat. Ezért itt
 * semmit nem veszünk készpénznek, hanem három dolgot mérünk meg:
 *
 *   1. HÁNY FÜGGETLEN SZERKESZTŐSÉG írja ugyanazt? Egy domain egy szavazat.
 *   2. MEGERŐSÍTI-E HIVATALOS FORRÁS? Ha az USGS, a GDACS vagy a NASA
 *      ugyanarra a helyre és időre eseményt jelent, az más kategória.
 *   3. MENNYIRE ÉRINT ENGEM? Ami nem a kijelölt terület közelében történt,
 *      vagy nem a testi biztonságról szól, az kimarad.
 *
 * Amit nem tudunk igazolni, azt nem tüntetjük fel igazoltként — a
 * „nincs megerősítve" címke ugyanolyan fontos információ, mint maga a hír.
 */

import { haversineKm } from './hazards.js';

const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/* ------------------------------------------------------------------ */
/* Mi számít biztonsági hírnek?                                        */
/* ------------------------------------------------------------------ */

/**
 * Veszélykategóriák kulcsszavai. Magyarul és angolul is, mert a helyi
 * sajtó magyarul ír, a nemzetközi viszont angolul — és a kettő egymást
 * erősítheti meg.
 */
export const HAZARD_KEYWORDS = {
  landslide: {
    label: 'Földcsuszamlás, partfalomlás', icon: '⛰️', type: 'landslide',
    hu: ['földcsuszamlás', 'partfalomlás', 'partfal', 'suvadás', 'omlás', 'löszfal'],
    en: ['landslide', 'mudslide', 'rockfall', 'slope failure'],
  },
  structural: {
    label: 'Épületkár, omlásveszély', icon: '🏚️', type: 'manmade',
    hu: ['épületomlás', 'falrepedés', 'megrepedt fal', 'életveszélyessé nyilvánít', 'összedőlt', 'statikai', 'ledőlt fal', 'homlokzat levált'],
    en: ['building collapse', 'structural damage', 'cracked wall', 'condemned building', 'evacuated building'],
  },
  flood: {
    label: 'Árvíz, belvíz', icon: '🌊', type: 'flood',
    hu: ['árvíz', 'árhullám', 'belvíz', 'gátszakadás', 'elöntött', 'villámárvíz'],
    en: ['flood', 'flash flood', 'levee breach', 'inundation'],
  },
  fire: {
    label: 'Tűz', icon: '🔥', type: 'wildfire',
    hu: ['erdőtűz', 'bozóttűz', 'tűzvész', 'lakástűz', 'tűz ütött ki'],
    en: ['wildfire', 'bushfire', 'blaze', 'major fire'],
  },
  chemical: {
    label: 'Vegyi, ipari baleset', icon: '☣️', type: 'manmade',
    hu: ['gázszivárgás', 'gázrobbanás', 'vegyi anyag', 'mérgező', 'szennyezés', 'olajszennyezés', 'ammónia', 'klórgáz'],
    en: ['gas leak', 'chemical spill', 'toxic release', 'hazmat', 'contamination'],
  },
  water: {
    label: 'Ivóvíz, közmű', icon: '🚱', type: 'manmade',
    hu: ['ivóvíz szennyez', 'fertőzött víz', 'vízkorlátozás', 'ne igyák', 'csőtörés'],
    en: ['water contamination', 'boil water', 'do not drink advisory'],
  },
  quake: {
    label: 'Földrengés', icon: '🌍', type: 'earthquake',
    hu: ['földrengés', 'rengés'],
    en: ['earthquake', 'seismic'],
  },
  storm: {
    label: 'Vihar, széllökés', icon: '🌪️', type: 'storm',
    hu: ['viharkár', 'ítéletidő', 'tornádó', 'jégeső', 'orkán', 'kidőlt fa'],
    en: ['storm damage', 'tornado', 'hailstorm', 'windstorm'],
  },
  evacuation: {
    label: 'Kitelepítés, lezárás', icon: '🚨', type: 'alert',
    hu: ['kiürítés', 'kitelepítés', 'evakuál', 'lezárták', 'katasztrófavédelem', 'életveszély'],
    en: ['evacuation', 'evacuated', 'emergency declared', 'shelter in place'],
  },
  epidemic: {
    label: 'Járvány, közegészség', icon: '🦠', type: 'other',
    hu: ['járvány', 'fertőzés', 'megbetegedés', 'karantén'],
    en: ['outbreak', 'epidemic', 'quarantine'],
  },
  radiation: {
    label: 'Sugárzás', icon: '☢️', type: 'manmade',
    hu: ['sugárzás', 'atomerőmű', 'radioaktív'],
    en: ['radiation leak', 'nuclear incident', 'radioactive'],
  },
};

/**
 * Amit a felhasználó kifejezetten NEM akar látni. A politika, a sport és
 * az üzleti hírek akkor is kiesnek, ha véletlenül tartalmaznak egy
 * veszélyre utaló szót ("a kampány viharos volt").
 */
const EXCLUDE = [
  'választás', 'polgármester', 'kampány', 'szavaz', 'parlament', 'koalíció', 'ellenzék',
  'kormánypárt', 'képviselő', 'miniszterelnök', 'pártelnök', 'frakció', 'népszavazás',
  'election', 'mayor', 'campaign', 'parliament', 'senator', 'candidate', 'poll',
  'bajnokság', 'mérkőzés', 'gól', 'átigazolás', 'football', 'match', 'league',
  'tőzsde', 'részvény', 'infláció', 'forintárfolyam', 'stock market',
  'film', 'sorozat', 'celeb', 'sztár', 'koncert',
];

const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOPWORDS = new Set([
  'a', 'az', 'es', 'de', 'hogy', 'egy', 'nem', 'is', 'van', 'volt', 'lesz', 'meg', 'ki', 'be',
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'at', 'is', 'was', 'after', 'as', 'by',
]);

const tokens = (s) => new Set(strip(s).split(' ').filter((w) => w.length > 3 && !STOPWORDS.has(w)));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Melyik veszélykategóriákba esik a cikk címe? */
export function classify(title) {
  const t = strip(title);
  const hits = [];
  for (const [key, cat] of Object.entries(HAZARD_KEYWORDS)) {
    const all = [...cat.hu, ...cat.en];
    if (all.some((k) => t.includes(strip(k)))) hits.push(key);
  }
  return hits;
}

export function isExcluded(title) {
  const t = strip(title);
  return EXCLUDE.some((k) => t.includes(strip(k)));
}

/* ------------------------------------------------------------------ */
/* Lekérés                                                             */
/* ------------------------------------------------------------------ */

/** A GDELT nyelvazonosítói a lekérdezésben. */
const LANG_BY_COUNTRY = {
  HU: 'hungarian', AT: 'german', DE: 'german', CH: 'german', SK: 'slovak', CZ: 'czech',
  PL: 'polish', RO: 'romanian', HR: 'croatian', RS: 'serbian', SI: 'slovenian',
  IT: 'italian', FR: 'french', ES: 'spanish', PT: 'portuguese', NL: 'dutch',
  SE: 'swedish', NO: 'norwegian', DK: 'danish', FI: 'finnish', GR: 'greek',
  TR: 'turkish', RU: 'russian', UA: 'ukrainian', JP: 'japanese', CN: 'chinese',
};

/**
 * A szolgáltatás IP-nként erősen korlátozza a kérésszámot, és a túllépést
 * hosszabb tiltással bünteti. Ezért saját fékünk is van: körönként legfeljebb
 * egy kérés, és két kérés között kötelező szünet. Így az app magától soha
 * nem sétál bele a tiltásba.
 */
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const LAST_CALL_KEY = 'wx:news:lastcall';

function tooSoon() {
  try {
    const last = Number(localStorage.getItem(LAST_CALL_KEY) || 0);
    const wait = last + MIN_INTERVAL_MS - Date.now();
    return wait > 0 ? wait : 0;
  } catch {
    return 0;
  }
}

function markCall() {
  try {
    localStorage.setItem(LAST_CALL_KEY, String(Date.now()));
  } catch { /* nem kritikus */ }
}

export async function fetchNews(place, { timespanDays = 14, max = 60, force = false } = {}) {
  const wait = tooSoon();
  if (wait && !force) {
    throw Object.assign(
      new Error(`A hírforrás kíméletéből ${Math.ceil(wait / 60000)} perc múlva kérdezzük le újra.`),
      { throttled: true, softLimit: true },
    );
  }
  const cc = (place.countryCode || '').toUpperCase();
  const lang = LANG_BY_COUNTRY[cc];

  let countryEn = null;
  try {
    countryEn = cc ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) : null;
  } catch { /* régi böngésző — marad null */ }

  // A helyi nyelv kulcsszavai + az angol változat, egyetlen OR-csoportban.
  const localWords = [];
  for (const cat of Object.values(HAZARD_KEYWORDS)) {
    if (lang === 'hungarian') localWords.push(...cat.hu.filter((w) => !w.includes(' ')).slice(0, 3));
  }
  const englishWords = Object.values(HAZARD_KEYWORDS).flatMap((c) => c.en.slice(0, 2));

  const words = (localWords.length ? localWords : englishWords).slice(0, 26);
  const group = `(${words.map((w) => (w.includes(' ') ? `"${w}"` : w)).join(' OR ')})`;

  const scope = lang ? `sourcelang:${lang}` : countryEn ? `sourcecountry:${countryEn}` : '';

  // Ha a szűkített lekérdezést a szolgáltatás valamiért nem fogadja el,
  // egyszer megpróbáljuk a puszta kulcsszócsoporttal is.
  const attempts = [`${scope} ${group}`.trim(), group];

  let data = null;
  let query = attempts[0];
  let lastError = null;

  for (const attempt of attempts) {
    const url =
      `${GDELT}?query=${encodeURIComponent(attempt)}&mode=artlist&format=json` +
      `&maxrecords=${max}&timespan=${timespanDays}d&sort=datedesc`;

    markCall();
    let res;
    let text;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      text = await res.text();
    } catch (netErr) {
      // A szolgáltatás a korlátozó válaszra nem küld CORS-fejlécet, ezért a
      // böngésző egyszerű hálózati hibaként látja. Ezt nem tudjuk
      // megkülönböztetni a valódi kapcsolathibától, ezért mindkettőt
      // őszintén, találgatás nélkül írjuk ki.
      throw Object.assign(
        new Error(
          'A hírforrás most nem válaszolt. Ez általában az ingyenes lekérdezési korlát miatt van; ' +
          'a többi adat ettől függetlenül friss. Később magától újrapróbálja.',
        ),
        { throttled: true, network: true, cause: netErr },
      );
    }

    // A szolgáltatás hibánál és korlátozásnál sima szöveget küld, nem JSON-t.
    if (text.trim().startsWith('{')) {
      data = JSON.parse(text);
      query = attempt;
      break;
    }

    const throttled = /limit requests/i.test(text);
    lastError = Object.assign(
      new Error(throttled
        ? 'A hírszolgáltatás pillanatnyilag korlátozza a lekérdezéseket — később újrapróbáljuk.'
        : `A hírlekérdezést elutasította a szolgáltatás: ${text.slice(0, 120)}`),
      { throttled },
    );
    // Korlátozásnál nincs értelme másik lekérdezéssel próbálkozni.
    if (throttled) throw lastError;
  }

  if (!data) throw lastError || new Error('A hírforrás nem válaszolt.');
  return {
    query,
    articles: (data.articles || []).map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      language: a.language,
      sourceCountry: a.sourcecountry,
      seen: parseGdeltDate(a.seendate),
      image: a.socialimage || null,
    })),
    fetchedAt: Date.now(),
  };
}

function parseGdeltDate(s) {
  // "20260915T143000Z" alak
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return Date.parse(s) || Date.now();
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/* ------------------------------------------------------------------ */
/* Sztorikká fésülés és megerősítés                                    */
/* ------------------------------------------------------------------ */

/**
 * Az ugyanarról szóló cikkek egy sztoriba kerülnek. A mérce a címek
 * szóhalmaz-átfedése 72 órás ablakon belül — ugyanaz az elv, mint a
 * veszélyeseményeknél: egy forrás egy szavazat, a szavazatok számítanak.
 */
export function clusterStories(articles, { similarity = 0.4, windowHours = 72 } = {}) {
  const stories = [];

  for (const a of articles) {
    if (!a.title) continue;
    const cats = classify(a.title);
    if (!cats.length || isExcluded(a.title)) continue;

    const tok = tokens(a.title);
    const hit = stories.find(
      (s) =>
        Math.abs(s.time - a.seen) <= windowHours * 3600000 &&
        s.categories.some((c) => cats.includes(c)) &&
        jaccard(s.tokens, tok) >= similarity,
    );

    if (hit) {
      hit.articles.push(a);
      hit.time = Math.max(hit.time, a.seen);
      for (const t of tok) hit.tokens.add(t);
      for (const c of cats) if (!hit.categories.includes(c)) hit.categories.push(c);
    } else {
      stories.push({
        title: a.title,
        tokens: tok,
        categories: cats,
        time: a.seen,
        articles: [a],
      });
    }
  }

  for (const s of stories) {
    s.domains = [...new Set(s.articles.map((a) => a.domain).filter(Boolean))];
    s.countries = [...new Set(s.articles.map((a) => a.sourceCountry).filter(Boolean))];
    s.articles.sort((a, b) => b.seen - a.seen);
    // A legrövidebb cím általában a legkevésbé bulváros.
    s.title = s.articles.map((a) => a.title).sort((a, b) => a.length - b.length)[0];
    s.primary = s.articles[0];
    s.category = HAZARD_KEYWORDS[s.categories[0]];
  }

  return stories.sort((a, b) => b.domains.length - a.domains.length || b.time - a.time);
}

/**
 * Összeveti a sztorikat a hivatalos veszélyeseményekkel.
 * Egyezés akkor van, ha a téma típusa megegyezik, és az esemény a sztori
 * megjelenése körüli időablakban, a figyelt körzeten belül történt.
 */
export function corroborateWithOfficial(stories, hazardClusters, place) {
  for (const s of stories) {
    const wantedTypes = s.categories.map((c) => HAZARD_KEYWORDS[c]?.type).filter(Boolean);

    const match = (hazardClusters || []).find((h) => {
      if (!wantedTypes.includes(h.type)) return false;
      const dt = Math.abs(h.time - s.time) / 3600000;
      if (dt > 96) return false;
      const d = haversineKm(place.lat, place.lon, h.lat, h.lon);
      return d <= Math.max(300, h.feltRadius || 0) || h.countryMatch;
    });

    s.official = match || null;

    const domains = s.domains.length;
    if (match) {
      s.verification = 'hivatalos';
      s.verificationLabel = `Hivatalos forrás is megerősíti (${match.sources.join(', ').toUpperCase()})`;
      s.verificationStatus = 'good';
    } else if (domains >= 3) {
      s.verification = 'tobb-forras';
      s.verificationLabel = `${domains} független szerkesztőség írja, hivatalos megerősítés nélkül`;
      s.verificationStatus = 'warning';
    } else if (domains === 2) {
      s.verification = 'ket-forras';
      s.verificationLabel = '2 forrás írja — hivatalos megerősítés nincs';
      s.verificationStatus = 'serious';
    } else {
      s.verification = 'egy-forras';
      s.verificationLabel = 'Egyetlen forrás, semmilyen megerősítés nélkül';
      s.verificationStatus = 'critical';
    }

    // Rangsor: a megerősítettség és a frissesség számít, nem a szenzáció.
    const ageH = (Date.now() - s.time) / 3600000;
    const trust = { hivatalos: 1, 'tobb-forras': 0.7, 'ket-forras': 0.45, 'egy-forras': 0.25 }[s.verification];
    s.rank = trust * Math.exp(-ageH / 120);
  }

  return stories.sort((a, b) => b.rank - a.rank);
}

/** A teljes hírlánc egy lépésben. */
export async function buildNews(place, hazardClusters, opts = {}) {
  const raw = await fetchNews(place, opts);
  const stories = clusterStories(raw.articles);
  const ranked = corroborateWithOfficial(stories, hazardClusters, place);
  return {
    query: raw.query,
    total: raw.articles.length,
    kept: ranked.length,
    stories: ranked,
    fetchedAt: raw.fetchedAt,
  };
}
