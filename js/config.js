/**
 * config.js — Adatforrás-regiszter és alapbeállítások.
 *
 * Minden modell egy önálló, független meteorológiai intézet numerikus
 * előrejelzése. A `skill` a hosszú távú, szakirodalomból ismert relatív
 * beválás (1.00 = a legjobb globális modell), a `tau` azt írja le, milyen
 * gyorsan romlik a modell előnye az előrejelzési idő növekedésével.
 * A `family` a korrelációkezeléshez kell: azonos intézet modelljei nem
 * számítanak független véleménynek.
 */

export const APP = {
  name: 'Konszenzus Időjárás',
  version: '1.0.0',
  forecastDays: 7,
  /** Hány napra visszamenőleg kérjük az adatot (talajtelítettséghez). */
  pastDays: 3,
  /** Csapadék-küszöb (mm/óra), ami fölött "esik" eseménynek számít. */
  precipThreshold: 0.1,
  /** Outlier-határ szórásban mérve. */
  outlierSigma: 2.5,
  /** Élő kalibráció (visszamenőleges beválás-mérés) alapból bekapcsolva. */
  calibrationEnabled: true,
  /** Hány napra visszamenőleg mérjük a modellek beválását. */
  calibrationDays: 3,
  /** Kalibrációs eredmény érvényessége (óra). */
  calibrationTtlHours: 12,
  /** Előrejelzési adat cache érvényessége (perc). */
  forecastTtlMinutes: 20,
};

/** Órás változók, amiket minden modelltől lekérünk. */
export const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'surface_pressure',
  'weather_code',
];

/**
 * Változó-metaadatok: megjelenítés, mértékegység, és a bizonytalanság
 * értelmezéséhez szükséges skála (`sigmaScale` = mekkora szórásnál
 * tekintjük az előrejelzést teljesen bizonytalannak).
 */
export const VARS = {
  temperature_2m:       { label: 'Hőmérséklet',  unit: '°C',   dec: 1, sigmaScale: 3.5, icon: '🌡️' },
  apparent_temperature: { label: 'Hőérzet',      unit: '°C',   dec: 1, sigmaScale: 4.5, icon: '🧥' },
  dew_point_2m:         { label: 'Harmatpont',   unit: '°C',   dec: 1, sigmaScale: 3.0, icon: '💧' },
  relative_humidity_2m: { label: 'Páratartalom', unit: '%',    dec: 0, sigmaScale: 18,  icon: '💦' },
  precipitation:        { label: 'Csapadék',     unit: 'mm',   dec: 1, sigmaScale: 2.0, icon: '🌧️' },
  snowfall:             { label: 'Hó',           unit: 'cm',   dec: 1, sigmaScale: 2.0, icon: '❄️' },
  cloud_cover:          { label: 'Felhőzet',     unit: '%',    dec: 0, sigmaScale: 35,  icon: '☁️' },
  wind_speed_10m:       { label: 'Szél',         unit: 'km/h', dec: 0, sigmaScale: 10,  icon: '💨' },
  wind_gusts_10m:       { label: 'Széllökés',    unit: 'km/h', dec: 0, sigmaScale: 18,  icon: '🌬️' },
  wind_direction_10m:   { label: 'Szélirány',    unit: '°',    dec: 0, sigmaScale: 60,  icon: '🧭', circular: true },
  surface_pressure:     { label: 'Légnyomás',    unit: 'hPa',  dec: 0, sigmaScale: 5,   icon: '📊' },
  weather_code:         { label: 'Időjárás',     unit: '',     dec: 0, sigmaScale: 0,   icon: '🌤️', categorical: true },
};

/** Globális modellek — egyetlen közös kéréssel lekérhetők. */
export const GLOBAL_MODELS = [
  { id: 'ecmwf_ifs025', short: 'ECMWF IFS', org: 'ECMWF',
    orgFull: 'Európai Középtávú Időjárás-előrejelző Központ', flag: '🇪🇺', country: 'Európa',
    res: '25 km', maxLead: 360, family: 'ecmwf', scope: 'global', skill: 1.00, tau: 1000,
    note: 'A világ referenciamodellje; a független verifikációk többségében ez a legpontosabb globális előrejelzés.' },

  { id: 'ecmwf_aifs025_single', short: 'ECMWF AIFS', org: 'ECMWF',
    orgFull: 'ECMWF — mesterséges intelligencia alapú modell', flag: '🇪🇺', country: 'Európa',
    res: '25 km', maxLead: 360, family: 'ecmwf', scope: 'global', skill: 0.93, tau: 1000,
    note: 'Gépi tanulással készült modell. Hőmérsékletben már veri a fizikai modelleket, széllökést nem ad.' },

  { id: 'ukmo_seamless', short: 'UKMO', org: 'Met Office',
    orgFull: 'Brit Nemzeti Meteorológiai Szolgálat', flag: '🇬🇧', country: 'Egyesült Királyság',
    res: '10 km', maxLead: 240, family: 'ukmo', scope: 'global', skill: 0.92, tau: 800,
    note: 'A második legjobb globális modell, különösen az atlanti térségben erős.' },

  { id: 'icon_seamless', short: 'ICON', org: 'DWD',
    orgFull: 'Német Meteorológiai Szolgálat', flag: '🇩🇪', country: 'Németország',
    res: '11 km', maxLead: 180, family: 'dwd', scope: 'global', skill: 0.93, tau: 700,
    note: 'Európa fölött kiváló; Közép-Európában gyakran pontosabb a globális átlagnál.' },

  { id: 'gfs_seamless', short: 'GFS', org: 'NOAA',
    orgFull: 'Amerikai Óceán- és Légkörkutató Hivatal', flag: '🇺🇸', country: 'USA',
    res: '11 km', maxLead: 384, family: 'noaa', scope: 'global', skill: 0.87, tau: 550,
    note: 'A legelterjedtebb nyílt modell. Nagyon hosszú távra lát, de gyorsabban pontatlanodik.' },

  { id: 'gem_seamless', short: 'GEM', org: 'ECCC',
    orgFull: 'Kanadai Környezetvédelmi Minisztérium', flag: '🇨🇦', country: 'Kanada',
    res: '15 km', maxLead: 240, family: 'eccc', scope: 'global', skill: 0.85, tau: 650,
    note: 'Független kanadai fejlesztés — értékes, mert máshogy téved, mint az európai modellek.' },

  { id: 'meteofrance_seamless', short: 'ARPEGE', org: 'Météo-France',
    orgFull: 'Francia Meteorológiai Szolgálat', flag: '🇫🇷', country: 'Franciaország',
    res: '11 km', maxLead: 240, family: 'mf', scope: 'global', skill: 0.88, tau: 700,
    note: 'Nyugat-Európa fölött sűrített rácsú; a Kárpát-medencére is jó minőségű.' },

  { id: 'jma_seamless', short: 'JMA', org: 'JMA',
    orgFull: 'Japán Meteorológiai Ügynökség', flag: '🇯🇵', country: 'Japán',
    res: '11 km', maxLead: 264, family: 'jma', scope: 'global', skill: 0.83, tau: 600,
    note: 'Erős a monszun- és tájfunhelyzetekben; széllökést nem szolgáltat.' },

  { id: 'cma_grapes_global', short: 'GRAPES', org: 'CMA',
    orgFull: 'Kínai Meteorológiai Igazgatóság', flag: '🇨🇳', country: 'Kína',
    res: '15 km', maxLead: 240, family: 'cma', scope: 'global', skill: 0.70, tau: 500,
    note: 'Gyengébb beválású, de teljesen független forrás — a szórás méréséhez hasznos.' },
];

/**
 * Regionális, nagy felbontású modellek. Csak akkor kérdezzük le őket, ha a
 * hely a domainjükben van, és külön kéréssel, hogy egy hiba ne dönthesse el
 * a teljes lekérést. Rövid távon ezek a legpontosabbak.
 */
export const REGIONAL_MODELS = [
  { id: 'icon_d2', short: 'ICON-D2', org: 'DWD', orgFull: 'Német Szolgálat — konvekciót feloldó modell',
    flag: '🇩🇪', country: 'Közép-Európa', res: '2,2 km', maxLead: 48, family: 'dwd', scope: 'regional',
    skill: 0.96, tau: 400, bbox: [43.4, -3.5, 57.5, 18.0],
    note: 'A zivatarokat külön számolja, nem becsli — rövid távon verhetetlen. Nyugat-Magyarországig ér el.' },

  { id: 'meteofrance_arome_france_hd', short: 'AROME-HD', org: 'Météo-France',
    orgFull: 'Francia nagy felbontású modell', flag: '🇫🇷', country: 'Franciaország',
    res: '1,5 km', maxLead: 48, family: 'mf', scope: 'regional', skill: 0.96, tau: 400,
    bbox: [41.0, -6.0, 52.0, 10.0], note: 'A legfinomabb rácsú operatív modell Európában.' },

  { id: 'ukmo_uk_deterministic_2km', short: 'UKV', org: 'Met Office',
    orgFull: 'Brit nagy felbontású modell', flag: '🇬🇧', country: 'Egyesült Királyság',
    res: '2 km', maxLead: 54, family: 'ukmo', scope: 'regional', skill: 0.95, tau: 400,
    bbox: [48.0, -12.0, 61.5, 4.0], note: 'A brit szigetek zápor- és ködhelyzeteire hangolva.' },

  { id: 'knmi_harmonie_arome_europe', short: 'HARMONIE (NL)', org: 'KNMI',
    orgFull: 'Holland Meteorológiai Intézet', flag: '🇳🇱', country: 'Nyugat-Európa',
    res: '5,5 km', maxLead: 60, family: 'knmi', scope: 'regional', skill: 0.90, tau: 450,
    bbox: [43.0, -12.0, 64.0, 22.0], note: 'Tengerparti és szélhelyzetekre optimalizált.' },

  { id: 'dmi_harmonie_arome_europe', short: 'HARMONIE (DK)', org: 'DMI',
    orgFull: 'Dán Meteorológiai Intézet', flag: '🇩🇰', country: 'Észak-Európa',
    res: '5,5 km', maxLead: 60, family: 'dmi', scope: 'regional', skill: 0.90, tau: 450,
    bbox: [44.0, -20.0, 68.0, 30.0], note: 'Skandináv és balti térségre hangolt futtatás.' },

  { id: 'italia_meteo_arpae_icon_2i', short: 'ICON-2I', org: 'ARPAE',
    orgFull: 'Olasz Regionális Környezetvédelmi Ügynökség', flag: '🇮🇹', country: 'Olaszország',
    res: '2,2 km', maxLead: 48, family: 'arpae', scope: 'regional', skill: 0.90, tau: 400,
    bbox: [34.0, 2.0, 52.0, 25.0], note: 'Mediterrán és alpesi helyzetekre specializált.' },

  { id: 'meteoswiss_icon_ch2', short: 'ICON-CH2', org: 'MeteoSwiss',
    orgFull: 'Svájci Meteorológiai Szolgálat', flag: '🇨🇭', country: 'Alpok',
    res: '2 km', maxLead: 120, family: 'meteoswiss', scope: 'regional', skill: 0.92, tau: 450,
    bbox: [43.0, 2.0, 50.0, 13.0], note: 'Hegyvidéki terepre a legjobb domborzati felbontás.' },

  { id: 'metno_nordic', short: 'MET Nordic', org: 'MET Norway',
    orgFull: 'Norvég Meteorológiai Intézet', flag: '🇳🇴', country: 'Skandinávia',
    res: '1 km', maxLead: 60, family: 'metno', scope: 'regional', skill: 0.93, tau: 450,
    bbox: [52.0, -10.0, 73.0, 42.0], note: 'Mérőállomás-adatokkal utókorrigált, 1 km-es rács.' },

  { id: 'gfs_hrrr', short: 'HRRR', org: 'NOAA', orgFull: 'Amerikai nagy felbontású modell',
    flag: '🇺🇸', country: 'USA', res: '3 km', maxLead: 48, family: 'noaa', scope: 'regional',
    skill: 0.93, tau: 400, bbox: [21.0, -134.0, 53.0, -60.0],
    note: 'Óránként frissül, zivatarokra a világ egyik legjobbja.' },

  { id: 'gem_hrdps_continental', short: 'HRDPS', org: 'ECCC',
    orgFull: 'Kanadai nagy felbontású modell', flag: '🇨🇦', country: 'Észak-Amerika',
    res: '2,5 km', maxLead: 48, family: 'eccc', scope: 'regional', skill: 0.92, tau: 400,
    bbox: [27.0, -142.0, 70.0, -50.0], note: 'Kanada és az USA északi része, finom rácson.' },

  { id: 'jma_msm', short: 'JMA MSM', org: 'JMA', orgFull: 'Japán mezoskálájú modell',
    flag: '🇯🇵', country: 'Japán', res: '5 km', maxLead: 78, family: 'jma', scope: 'regional',
    skill: 0.90, tau: 450, bbox: [22.0, 120.0, 48.0, 150.0],
    note: 'Japán és környéke, tájfunhelyzetekre hangolva.' },
];

export const ALL_MODELS = [...GLOBAL_MODELS, ...REGIONAL_MODELS];

/** Gyors kereséshez. */
export const MODEL_BY_ID = Object.fromEntries(ALL_MODELS.map((m) => [m.id, m]));

/** Benne van-e a koordináta a modell domainjében? */
export function inDomain(model, lat, lon) {
  if (!model.bbox) return true;
  const [s, w, n, e] = model.bbox;
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

/** Az adott helyen egyáltalán szóba jövő modellek. */
export function candidateModels(lat, lon) {
  return ALL_MODELS.filter((m) => inDomain(m, lat, lon));
}

/** WMO időjárási kód → magyar leírás + ikon. */
export const WMO = {
  0:  ['Derült', '☀️'],
  1:  ['Túlnyomóan derült', '🌤️'],
  2:  ['Változóan felhős', '⛅'],
  3:  ['Borult', '☁️'],
  45: ['Köd', '🌫️'],
  48: ['Zúzmarás köd', '🌫️'],
  51: ['Gyenge szitálás', '🌦️'],
  53: ['Szitálás', '🌦️'],
  55: ['Erős szitálás', '🌧️'],
  56: ['Ónos szitálás', '🌧️'],
  57: ['Erős ónos szitálás', '🌧️'],
  61: ['Gyenge eső', '🌦️'],
  63: ['Eső', '🌧️'],
  65: ['Erős eső', '🌧️'],
  66: ['Ónos eső', '🌧️'],
  67: ['Erős ónos eső', '🌧️'],
  71: ['Gyenge havazás', '🌨️'],
  73: ['Havazás', '🌨️'],
  75: ['Erős havazás', '❄️'],
  77: ['Hószemcsék', '🌨️'],
  80: ['Gyenge zápor', '🌦️'],
  81: ['Zápor', '🌧️'],
  82: ['Felhőszakadás', '⛈️'],
  85: ['Hózápor', '🌨️'],
  86: ['Erős hózápor', '❄️'],
  95: ['Zivatar', '⛈️'],
  96: ['Zivatar jégesővel', '⛈️'],
  99: ['Heves zivatar jégesővel', '⛈️'],
};

/** Az időkódok durvább csoportosítása a konszenzus-szavazáshoz. */
export function wmoGroup(code) {
  if (code == null) return null;
  if (code === 0) return 'derult';
  if (code <= 2) return 'kisse_felhos';
  if (code === 3) return 'borult';
  if (code <= 48) return 'kodos';
  if (code <= 57) return 'szitalas';
  if (code <= 67) return 'eso';
  if (code <= 77) return 'havazas';
  if (code <= 82) return 'zapor';
  if (code <= 86) return 'hozapor';
  return 'zivatar';
}

export const GROUP_LABEL = {
  derult:       ['Derült', '☀️'],
  kisse_felhos: ['Kissé felhős', '🌤️'],
  borult:       ['Borult', '☁️'],
  kodos:        ['Ködös', '🌫️'],
  szitalas:     ['Szitálás', '🌦️'],
  eso:          ['Eső', '🌧️'],
  havazas:      ['Havazás', '🌨️'],
  zapor:        ['Zápor', '🌦️'],
  hozapor:      ['Hózápor', '🌨️'],
  zivatar:      ['Zivatar', '⛈️'],
};
