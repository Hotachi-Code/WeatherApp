# Konszenzus Időjárás

Telefonra készült időjárás-alkalmazás, ami **nem egy forrásból** dolgozik,
hanem a világ vezető meteorológiai intézeteinek modelljeit egyszerre kérdezi
le, súlyozza őket, és megmutatja, **mennyire értenek egyet**.

A lényeg nem a szám, hanem a szám melletti bizonytalanság: ha nyolc modell
esőt mond és négy nem, azt látni akarod, nem egy letisztázott „30% eső”
feliratot.

---

## Mit csinál

**Egy szám helyett egy mezőnyt mutat.** Minden értéknél látszik a súlyozott
konszenzus, a középső 80% sávja, a teljes szórás, és hogy hány forrásból jött.

**Megmondja, kitől származik.** Az Adatforrások szakasz modellenként felsorolja
az intézetet, a rács felbontását, az előrejelzési határt, a kapott súlyt
százalékban, és hogy az adott modell most éppen mit mond.

**Súlyoz, nem átlagol vakon.** Négy dolog dönti el, ki mennyit nyom a latban:

1. **Hosszú távú beválás** — az ECMWF IFS kapja a referenciasúlyt (1,00), a
   gyengébb modellek arányosan kevesebbet.
2. **Előrejelzési táv** — minden modell előnye kopik az idővel, de más ütemben.
   A 2 km-es ICON-D2 48 órán belül veri a globális modelleket, azon túl viszont
   már nincs is adata.
3. **Élő, helyi kalibráció** — az app lekéri, hogy az egyes modellek 1–3 nappal
   ezelőtt **mit jósoltak mostanra**, összeveti a tényleges alakulással, és a
   nálad mért hiba alapján igazít a súlyokon. Ez nem globális statisztika: a te
   koordinátádon mért beválás.
4. **Függetlenség** — az ECMWF IFS és az AIFS ugyanabból az adatasszimilációból
   indul, tehát nem két vélemény. Az azonos intézettől jövő modellek osztoznak
   a súlyon (1/√n), különben egy intézet többszörös szavazatot kapna.

**Igen/nem kérdéseknél szavaztat, nem átlagol.** Az „esik-e?” kérdésre nem a
csapadékmennyiségek átlaga a válasz — az félrevezető lenne —, hanem a súlyozott
szavazatarány. Innen jön a „talán”: 45–58% között az app ki is mondja, hogy a
források megosztottak.

**Kiszűri a kilógókat.** Ha egy modell 2,5 szórásnál messzebb jár a mezőnytől,
kimarad az átlagból — de a neve megjelenik, nem tűnik el csendben.

**Megmondja, mennyi az igazi forrás.** A Kish-féle effektív mintaszám azt
mutatja, hány *valóban független* vélemény van a 12 mögött. Ha ez 3 alá esik,
az app külön figyelmeztet.

---

## Biztonsági réteg

Az app négy külön kérdésre ad külön választ, és ezeket sosem mossa össze.

### 1. Mi fenyeget most? — hivatalos ügynökségek

Négy egymástól független hivatalos forrást kérdez le, és a **ugyanarról az
eseményről szóló jelentéseket összefésüli**:

| Forrás | Intézet | Mit ad |
|---|---|---|
| **USGS** 🇺🇸 | Amerikai Geológiai Szolgálat | földrengések, globálisan |
| **EMSC** 🇪🇺 | Európai-Mediterrán Szeizmológiai Központ | földrengések, Európában sűrűbb hálózattal |
| **NASA EONET** 🇺🇸 | NASA Föld-megfigyelés | erdőtűz, vulkán, árvíz, vihar, csuszamlás |
| **GDACS** 🌐 | ENSZ–EU riasztórendszer | nagy katasztrófák hatásbecsléssel |
| **NWS** 🇺🇸 | Amerikai Meteorológiai Szolgálat | hatósági riasztások (csak USA) |

Ha egy földrengést az USGS és az EMSC is bemér, akkor:
- **megerősített** eseménynek számít (két független hivatalos forrás),
- a két magnitúdóból **konszenzusérték** születik, a szórással együtt
  („5,6 mww — 2 ügynökség mérése: USGS 5,6, EMSC 5,6, teljes egyetértés"),
- ami csak egy forrásból jön, az is megjelenik, de kiírva, hogy **nincs
  megerősítve**.

Az app nem azt kérdezi, „történt-e valami", hanem hogy **elér-e idáig**.
Egy földrengésnél a magnitúdóból kiszámolja az érezhető és a károkozó
sugarat, és ehhez méri a te távolságodat:

> Általában **199 km**-ig érezhető, **20 km**-ig okoz kárt.
> Te **4 km**-re vagy — ez a károkozó zónán belül van.

Ami nem ér el idáig, az külön, összecsukott listába kerül („a környéken
történt még 14 esemény") — mert az is információ, hogy nem kell aggódni.

### 2. Mi jön az időjárásból? — a saját modellmezőny

Ugyanaz a 9–15 modell, de más kérdéssel: nem azt, hogy „hány fok lesz",
hanem hogy **„hány modell szerint lépi át a szél a 90 km/h-t"**. A válasz a
súlyozott szavazatarány.

Figyelt veszélyek: heves esőzés, viharos szél, zivatar, jégeső, ónos eső,
havazás, hőség, extrém hideg, sűrű köd — mindegyik három súlyossági
fokozattal. Plusz két összetett becslés:

- **Földcsuszamlás-kockázat**: a domborzatból (három léptéken mért
  legmeredekebb lejtő), az elmúlt 3 nap csapadékából (talajtelítettség) és
  az előrejelzett esőből.
- **Tűzveszély**: hőmérséklet, páratartalom, szél és a száraz napok száma.

A fokozat mindig a **konszenzusértékből** jön, nem a legszélsőségesebb
modellből — de a mezőny legrosszabb esetét külön is kiírja.

### 3. Mi van az égen? — űridőjárás

Három forrás, ugyanazzal a súlyozási elvvel, mint a földi modelleknél:

| Forrás | Súly | Mit ad |
|---|---|---|
| **NOAA SWPC** | 1,00 | hivatalos, emberi elemzők által kiadott előrejelzés |
| **NOAA GOES** | 0,62 | a ténylegesen mért kitörésekből számolt statisztikai becslés |
| **NASA DONKI** | 0,62 | a NASA független katalogizálása ugyanezekről |

A 2. és 3. ugyanarra a műholdra támaszkodik, ezért — a modellcsaládokhoz
hasonlóan — osztoznak a súlyon. A NASA katalógusa 2 nap késéssel teljes,
ezért a számolás csak a lezárt részét használja: e nélkül minden becslés
lefelé torzulna.

Amit mutat: C/M/X osztályú napkitörés valószínűsége 24 órára (a három
forrás értékével és a szórással), a NOAA R/S/G skálái most és 3 napra,
protonvihar-esély, és mindegyikhez **hogy ez neked mit jelent** —
rádiózavar, GPS-pontosság, repülési sugárdózis, áramhálózat.

Sarki fényhez kiszámolja a **geomágneses szélességedet**, és megmondja,
mekkora Kp-index kellene, hogy innen egyáltalán látszódjon.

### 4. Mit írnak a hírek? — és mennyire hihető

Ez a leggyengébb láncszem, és az app így is kezeli. A hírekre **három
mérőszámot** alkalmaz:

1. **Hány független szerkesztőség írja?** Egy domain egy szavazat.
2. **Megerősíti-e hivatalos forrás?** Ha ugyanarra a helyre és időre az
   USGS/GDACS/EONET is eseményt jelent, az más kategória.
3. **Érint-e engem?** Csak a kijelölt terület közelében, és csak testi
   biztonságot érintő témák.

Négy megerősítettségi szint, mindig kiírva:

| Szint | Mit jelent |
|---|---|
| ✔ **Hivatalos forrás is megerősíti** | ügynökségi adat támasztja alá |
| ◐ **N független szerkesztőség írja** | hivatalos megerősítés nélkül |
| ? **2 forrás írja** | gyenge megerősítés |
| ! **Egyetlen forrás** | semmilyen megerősítés — kezeld pletykaként |

A rangsor a megerősítettséget és a frissességet követi, **nem a
szenzációt**. Politika, sport, üzleti és bulvárhírek kiszűrve — akkor is,
ha véletlenül tartalmaznak veszélyre utaló szót.

> **Fontos korlát:** a hírréteg a GDELT nyílt hírindexét használja, amely
> IP-nként erősen korlátozza a lekérdezéseket. Az app ezért óránként
> legfeljebb néhányszor kérdez, és az eredményt 45 percig eltárolja. Ha a
> szolgáltatás épp korlátoz, a hírkártya ezt kiírja — **a többi réteg
> ettől függetlenül működik**. A fejlesztés során ez a korlát nem tette
> lehetővé a hírréteg végponttól végpontig való kipróbálását éles
> adatokkal; a feldolgozó és megerősítő logikát szintetikus tesztek
> igazolják.

---

## Adatforrások

Az adatok az [Open-Meteo](https://open-meteo.com/) szolgáltatásán keresztül
érkeznek, amely a nemzeti szolgálatok nyílt modellfuttatásait teszi elérhetővé.
Nem kell hozzá regisztráció és API-kulcs.

### Globális modellek (mindenhol elérhetők)

| Modell | Intézet | Ország | Felbontás | Max. táv | Alapsúly |
|---|---|---|---|---|---|
| ECMWF IFS | ECMWF | 🇪🇺 | 25 km | 360 ó | 1,00 |
| ECMWF AIFS | ECMWF (MI-modell) | 🇪🇺 | 25 km | 360 ó | 0,93 |
| ICON | DWD | 🇩🇪 | 11 km | 180 ó | 0,93 |
| UKMO | Met Office | 🇬🇧 | 10 km | 240 ó | 0,92 |
| ARPEGE | Météo-France | 🇫🇷 | 11 km | 240 ó | 0,88 |
| GFS | NOAA | 🇺🇸 | 11 km | 384 ó | 0,87 |
| GEM | ECCC | 🇨🇦 | 15 km | 240 ó | 0,85 |
| JMA | Japán Met. Ügynökség | 🇯🇵 | 11 km | 264 ó | 0,83 |
| GRAPES | CMA | 🇨🇳 | 15 km | 240 ó | 0,70 |

### Regionális, nagy felbontású modellek (helyfüggő)

Ezek csak a saját tartományukban érhetők el, és rövid távon a legpontosabbak.
Az app automatikusan megnézi, melyik vonatkozik a megadott helyre.

| Modell | Intézet | Terület | Felbontás | Max. táv |
|---|---|---|---|---|
| ICON-D2 | DWD 🇩🇪 | Közép-Európa (Nyugat-Magyarországig) | 2,2 km | 48 ó |
| AROME-HD | Météo-France 🇫🇷 | Franciaország | 1,5 km | 48 ó |
| UKV | Met Office 🇬🇧 | Brit-szigetek | 2 km | 54 ó |
| HARMONIE (NL) | KNMI 🇳🇱 | Nyugat-Európa | 5,5 km | 60 ó |
| HARMONIE (DK) | DMI 🇩🇰 | Észak-Európa | 5,5 km | 60 ó |
| ICON-2I | ARPAE 🇮🇹 | Olaszország, Mediterráneum | 2,2 km | 48 ó |
| ICON-CH2 | MeteoSwiss 🇨🇭 | Alpok | 2 km | 120 ó |
| MET Nordic | MET Norway 🇳🇴 | Skandinávia | 1 km | 60 ó |
| HRRR | NOAA 🇺🇸 | USA | 3 km | 48 ó |
| HRDPS | ECCC 🇨🇦 | Észak-Amerika | 2,5 km | 48 ó |
| JMA MSM | JMA 🇯🇵 | Japán | 5 km | 78 ó |

Budapesten tipikusan **12 forrás** aktív, Zürichben **15**, Sydney-ben **9**.

Ezen felül a levegőminőség és a pollen a CAMS (Copernicus) adataiból jön, a
helykeresés az Open-Meteo geokódolójából, a GPS-ből kapott koordináta
helynevesítése a BigDataCloud szolgáltatásából.

---

## Indítás

### Gyors próba a gépen

Kattints duplán a **`start.bat`** fájlra, vagy futtasd:

```
node serve.mjs
```

Megnyílik a `http://localhost:8080` cím, és a szerver kiírja azt a
`http://192.168.x.x:8080` címet is, amit a **telefonodról** beírhatsz,
ha ugyanazon a Wi-Fi-n vagy.

Más port: `node serve.mjs 9000`

### Telefonra, rendesen

Sima `http://` címen a böngésző **letiltja a helymeghatározást és a
főképernyőre telepítést** — ez biztonsági szabály, nem az app hibája.
A LAN-os cím tehát próbára jó, de a kereső használatával.

Teljes működéshez tedd ki a mappát bármelyik ingyenes statikus tárhelyre:

- **Netlify Drop** — [app.netlify.com/drop](https://app.netlify.com/drop):
  húzd rá a `WeatherApp` mappát, kapsz egy https címet. Semmi más teendő.
- **Cloudflare Pages** vagy **GitHub Pages** — ugyanígy, a mappa tartalmát kell feltölteni.

### Ha más hálózaton vagy, de a gépről akarod futtatni

Az app teljesen statikus — **nincs szerveroldali része**, minden adatot maga a
böngésző kér le a nyilvános API-któl. Ezért a gépedre általában semmi szükség:
a fenti tárhelyes megoldás jobb minden szempontból (akkor is működik, ha a gép
ki van kapcsolva).

Ha mégis a gépedről akarod kiszolgálni, futtasd a **`tunnel.bat`**-ot. Ez
elindítja a helyi szervert, és nyit hozzá egy nyilvános https-címet
(`ssh`-n keresztül, telepítés és regisztráció nélkül). A megjelenő
`Forwarding HTTP traffic from https://…` sorban lévő címet írd be a telefonon.

Amit tudnod kell róla:

- **A cím nyilvános.** Aki ismeri a linket, megnyithatja — nincs rajta belépés.
  Az app nem tárol rólad adatot a gépen, de a szervered elérhetővé válik.
- **A cím minden indításnál más**, és csak addig él, amíg az ablak nyitva van.
- A gépnek végig bekapcsolva kell maradnia.
- Az ingyenes alagút első megnyitáskor egy figyelmeztető oldalt mutat, amit át
  kell kattintani.

Ezután a telefonon nyisd meg az így kapott https címet, és:

- **Androidon (Chrome):** menü → *Alkalmazás telepítése* / *Hozzáadás a kezdőképernyőhöz*
- **iPhone-on (Safari):** Megosztás ikon → *Főképernyőhöz adás*

Innentől saját ikonnal, böngészősáv nélkül indul, és offline is megnyílik a
legutóbbi adatokkal.

---

## Használat

- **🔍** — helykeresés. Város, község vagy cím; korábbi helyeid megjegyzi.
- **📍** — jelenlegi helyzet GPS-ből (csak https alatt működik).
- **↻** — frissítés. Egyébként 20 percenként magától frissül, ha visszatérsz.
- **Bármelyik mérőszámra koppintva** kinyílik a teljes forrásbontás: melyik
  modell mit mond, mennyit nyom a latban, mennyivel tér el a konszenzustól.
- **Bármelyik napra koppintva** részletes napi elemzés, órás bontással és
  azzal, hogy pontosan kik mondanak esőt és kik nem.
- **Beállítások**: az élő kalibráció és a kilógó-szűrés külön ki-be kapcsolható
  — érdemes kipróbálni, mennyit változik tőlük a végeredmény.

Megosztható link is működik:
`index.html?lat=47.4979&lon=19.0402&name=Budapest`

---

## Hogyan olvasd a bizonytalanságot

A megbízhatósági jelvény négy fokozatú. A színe mellett mindig van ikon és
szöveg is, tehát színvakság mellett is olvasható.

| Jelvény | Mit jelent |
|---|---|
| ✔ **Biztos** | A források lényegében ugyanazt mondják. |
| ◐ **Enyhén bizonytalan** | Nagyjából egyetértenek, pár egységnyi elmozdulás fér bele. |
| ? **Bizonytalan** | Érdemben eltérnek. Irányadó becslés, nem pontos érték. |
| ! **Erősen megosztott** | Komolyan ellentmondanak. Itt tényleg csak „talán” van. |

A hőmérséklet-diagramon a **sötétebb sáv** a források középső 80%-a, a
**halványabb** a teljes mezőny, a **vonal** a súlyozott konszenzus.
Ha a sáv széles, az nem hiba — az az információ.

---

## Felépítés

```
WeatherApp/
├── index.html              a felület váza
├── manifest.webmanifest    telepíthetőség (PWA)
├── sw.js                   offline működés
├── serve.mjs               fejlesztői szerver (Node, függőség nélkül)
├── start.bat               indítás Windowson
├── css/styles.css          világos és sötét téma
├── icons/                  alkalmazásikonok
└── js/
    ├── config.js           modell-regiszter, súlyok, tartományok
    ├── api.js              lekérések, cache, kalibrációs adatok
    ├── ensemble.js         a konszenzus-matematika magja
    ├── hazards.js          hivatalos veszélyesemények, kereszt-ellenőrzés
    ├── hazardforecast.js   veszély-előrejelzés a modellmezőnyből
    ├── space.js            űridőjárás, napkitörés-konszenzus
    ├── news.js             hírek gyűjtése és megerősítés-ellenőrzése
    ├── narrative.js        a számokból magyar mondat
    ├── charts.js           SVG diagramok, könyvtár nélkül
    ├── ui.js               időjárás-megjelenítés
    ├── ui-safety.js        biztonsági, űr- és hírblokkok
    └── app.js              állapot és eseménykezelés
```

Nincs build-lépés, nincs `node_modules`, nincs API-kulcs. A `js/` mappa
tiszta ES-modul, a böngésző közvetlenül futtatja.

---

## Korlátok, őszintén

- **Ez modellkonszenzus, nem mérés.** Az „aktuális” érték is modellelemzés,
  nem a szomszéd utcában álló hőmérő.
- **A súlyok becslések.** A hosszú távú beválás irodalmi értékeken alapul, az
  élő kalibráció pedig mindössze 3 nap adatából dolgozik — ez zajos. Ezért
  korlátozott a hatása (×0,55 és ×1,8 között), és kikapcsolható.
- **Az egyetértés nem igazság.** Ha minden modell ugyanabban téved (például egy
  lokális hatást egyik sem lát), a felület magabiztos lesz, és tévedni fog. A
  bizonytalanság mérése a modellek közti szórást méri, nem a valósághoz mért
  hibát.
- **A 7. napon túl** minden előrejelzés inkább éghajlati statisztika, mint
  előrejelzés. Ezért az app 7 napnál nem megy tovább.
- **A veszélyesemények hatósugara közelítés.** A földrengés érezhető és
  károkozó sugara magnitúdóból számolt tapasztalati képlet; a valóságban a
  talajviszonyok, a mélység és az épületállomány sokat számítanak. Irányt
  ad, nem szakvéleményt.
- **A földcsuszamlás-becslés nem geológia.** Domborzatot, csapadékot és
  előrejelzett esőt ismer; talajtípust, növényzetet, emberi bevágást vagy
  feltöltést nem. Figyelemfelhívás, semmi több.
- **A hírek megerősítettsége nem igazságtartalom.** Azt méri, hányan írják
  és van-e hivatalos alátámasztás — nem azt, hogy a hír igaz-e. Több
  szerkesztőség is átvehet egyetlen téves forrást.
- **Vészhelyzetben a hatósági csatorna az elsődleges.** Ez az app
  tájékozódásra való; a hivatalos riasztás, a 112 és a katasztrófavédelem
  utasítása mindig előbbre való.
