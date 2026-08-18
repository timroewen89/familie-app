# Familie App

Een lichtgewicht familie-webapp met een **weekoverzicht** gekoppeld aan Google Calendar en een **boodschappenlijst**. Puur HTML, CSS en vanilla JavaScript — geen build-stap of eigen server nodig.

## Functies

- 📅 **Dag- én weekoverzicht** met een schakelaar, pijltjesnavigatie (*vorige / vandaag / volgende*) en veeggebaren op mobiel; vandaag is gemarkeerd.
- 🔗 **Google Calendar**: log in met je (persoonlijke) Google-account en zie de afspraken van de zichtbare periode.
- ➕ **Afspraken toevoegen**: maak via "＋ Afspraak" een nieuwe afspraak aan — met titel, datum, tijd (of hele dag), doelagenda én direct persoonstags erbij.
- 📆 **Meerdere agenda's**: kies via de 📆-knop welke agenda's uit je account meedoen (bijv. je eigen agenda, een gedeelde gezinsagenda en verjaardagen). Elke afspraak krijgt de kleur van zijn agenda uit Google Calendar. Standaard doen de agenda's mee die je in Google Calendar zichtbaar hebt staan.
- 🏷️ **Persoonstags**: tik op een afspraak om gezinsleden (standaard Tim, Renate, Mick en Davi — aanpasbaar via ⚙️) te taggen, elk met een eigen kleur. Filter de agenda per persoon via de chips boven het overzicht. Tags worden lokaal bewaard (Google Calendar blijft alleen-lezen).
- 🛒 **Boodschappenlijst**: items toevoegen, afvinken en verwijderen — persistent in je browser, werkt ook offline en zonder Google-login.
- ⭐ **Favorieten**: markeer vaste boodschappen met de ster; via de favorietenbalk zet je ze in elke week met één tik terug op de lijst (en, als het een Picnic-product is en je bent ingelogd, meteen in je Picnic-mandje).
- 📱 **Mobiel & installeerbaar (PWA)**: voeg de app toe aan je beginscherm (Android: menu → *App installeren*; iOS: deelknop → *Zet op beginscherm*). Dankzij een service worker start de app snel en werkt de boodschappenlijst ook offline.
- 🎨 Kleurstelling gebaseerd op het Google Material-palet (blauw, rood, geel, groen).

## Lokaal draaien

De Google-bibliotheken vereisen dat de app via `http(s)` wordt geserveerd (niet via `file://`). Start een simpele webserver in de projectmap:

```bash
python3 -m http.server 8000
# of: npx serve .
```

Open daarna <http://localhost:8000>.

## Google Calendar koppelen

De app bevat bewust **geen** geheimen en gebruikt **geen API-key** — de agenda wordt rechtstreeks met het OAuth-token opgehaald. Het enige dat je nodig hebt is een OAuth Client-ID (een publiek gegeven, beschermd via de toegestane origins). Die maak je eenmalig aan en voer je in via het ⚙️-paneel; hij wordt alleen lokaal in je browser bewaard.

1. Ga naar de [Google Cloud Console](https://console.cloud.google.com/) en maak een project aan (bijv. "familie-app").
2. Zet de **Google Calendar API** aan: *APIs & Services → Library → Google Calendar API → Enable*.
3. Configureer het **OAuth consent screen** (*APIs & Services → OAuth consent screen*):
   - User type: **External**, publishing status mag **Testing** blijven.
   - Voeg de Google-accounts van je gezinsleden toe als **test users** — alleen zij kunnen dan inloggen.
4. Maak een **OAuth Client-ID** aan (*APIs & Services → Credentials → Create credentials → OAuth client ID*):
   - Application type: **Web application**.
   - Voeg bij **Authorized JavaScript origins** de URL toe waar de app draait, bijv. `http://localhost:8000` en/of je GitHub Pages-URL. Alleen vanaf die origins werkt de Client-ID.
5. Open de app, klik op **⚙️**, plak de Client-ID en klik op **Opslaan**.
6. Klik op **Verbind met Google** en log in.

## Bestandsstructuur

```
├── index.html      # Structuur: weekoverzicht, boodschappenlijst, instellingen-dialog
├── css/style.css   # Responsive layout (mobiel eerst)
├── js/app.js       # Opstart, weeknavigatie, weekgrid renderen
├── js/calendar.js  # Google-login en events per week ophalen
├── js/shopping.js  # Boodschappenlijst met localStorage
├── manifest.webmanifest  # PWA-manifest (installeerbaar op mobiel)
├── sw.js           # Service worker: offline cache van de app-schil
├── icons/          # App-iconen (SVG + PNG)
└── PLAN.md         # Ontwerp en stappenplan
```

### Scopes in Data Access

Voeg op de pagina *Google Auth Platform → Data Access* deze twee scopes toe (beide "sensitive"):

- `https://www.googleapis.com/auth/calendar.readonly` — agenda's en afspraken lezen
- `https://www.googleapis.com/auth/calendar.events` — afspraken aanmaken

Had je al verbonden vóór het toevoegen van de events-scope, dan vraagt de app je eenmalig opnieuw te verbinden zodra je een afspraak wilt toevoegen.

## Picnic koppelen (optioneel)

Met de Picnic-koppeling zoek je een boodschappenitem rechtstreeks op in Picnic en leg je het met één tik in je échte Picnic-mandje (rode **P**-knop naast elk open item).

**Belangrijk om te weten:** Picnic heeft geen officiële API; deze koppeling gebruikt de endpoints van hun eigen app (zoals ook de Home Assistant-community doet) en kan dus breken als Picnic iets wijzigt. De 📤 deel-knop blijft in dat geval gewoon werken.

### Stap 1: proxy deployen (eenmalig, gratis)

Browsers mogen de Picnic-API niet rechtstreeks aanroepen; daarom draait er een piepklein doorgeefluik als [Cloudflare Worker](https://workers.cloudflare.com/) (gratis, ruim voldoende voor een gezin). Controleer vooraf dat jouw app-URL in `ALLOWED_ORIGINS` staat in [`worker/picnic-proxy.js`](worker/picnic-proxy.js).

**Optie A — rechtstreeks vanuit GitHub (aanbevolen):** elke push naar `main` deployt de Worker automatisch opnieuw.

1. Maak een gratis account op [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Ga naar **Workers & Pages → Create → Import a repository**, koppel je GitHub-account en kies deze repo.
3. Cloudflare leest [`wrangler.toml`](wrangler.toml) uit de repo; laat het build command leeg en het deploy command op `npx wrangler deploy` staan. Klik **Deploy**.
4. Kopieer na de eerste build de Worker-URL (bijv. `https://picnic-proxy.jouwnaam.workers.dev`).

**Optie B — handmatig plakken:**

1. Ga naar **Workers & Pages → Create → Start with Hello World** en klik **Deploy**.
2. Klik **Edit code**, vervang de inhoud door [`worker/picnic-proxy.js`](worker/picnic-proxy.js) en klik **Deploy**.
3. Kopieer de Worker-URL. (Let op: bij deze optie moet je wijzigingen aan de Worker later zelf opnieuw plakken.)

De Worker geeft verzoeken alleen door en voegt de headers toe die Picnic verwacht. De `ALLOWED_ORIGINS` (CORS) beschermt tegen andere websites in een browser, maar niet tegen scripts die de Origin-header vervalsen — daarom is er ook een **gedeelde sleutel**.

### Stap 1b: stel een proxy-sleutel in (belangrijk)

Zonder sleutel is de proxy een open relay: iedereen die de URL raadt kan er ongelimiteerd Picnic-inlogpogingen doorheen sturen, op jouw Cloudflare-account. Stel daarom een geheim in:

1. In de Cloudflare-dashboard bij je Worker: **Settings → Variables and Secrets → Add** → naam `PROXY_KEY`, type **Secret**, waarde een lange willekeurige tekst (bijv. uit een wachtwoordmanager). Of via de CLI: `npx wrangler secret put PROXY_KEY`.
2. Dezelfde waarde vul je in de app in bij **⚙️ → Picnic → Proxy-sleutel**.

Zolang `PROXY_KEY` niet is ingesteld werkt de proxy nog (alleen op origin), maar dat is onveilig. Overweeg daarnaast een Cloudflare rate-limiting-regel op `/api/*/user/login`.

### Stap 2: in de app

1. Open **⚙️ → Picnic** en vul de Worker-URL en de proxy-sleutel in.
2. Tik op de rode **P** naast een boodschappenitem → log eenmalig in met je Picnic-account (SMS-code wordt ondersteund). Je wachtwoord wordt nooit opgeslagen; alleen het inlogtoken blijft lokaal in je browser (~30 dagen geldig, daarna log je gewoon opnieuw in).
3. Kies een product uit de zoekresultaten en tik **＋ Mandje** — het staat direct in je Picnic-winkelmand.

## Privacy & veiligheid

- De agenda wordt benaderd met de scopes `calendar.readonly` (lezen) en `calendar.events` (afsprakenbeheer — de app gebruikt dit alleen om afspraken **aan te maken**; verwijderen of bewerken zit niet in de app). Agenda-instellingen of delen wijzigen kan met deze scopes sowieso niet.
- Er is **geen API-key**: de Calendar API wordt aangeroepen met alleen het kortlevende OAuth-token, dat uitsluitend in het geheugen van de pagina leeft.
- Client-ID, boodschappenlijst en persoonstags blijven in `localStorage` van je eigen browser; er is geen backend en er worden geen gegevens naar derden gestuurd.
- De optionele Picnic-koppeling gebruikt jouw eigen proxy. Je Picnic-wachtwoord wordt alleen tijdens het inloggen (binnen TLS) doorgestuurd en nooit bewaard; alleen het inlogtoken staat lokaal in je browser. Let op: het verkeer passeert wél jouw Cloudflare-Worker — de beheerder daarvan zou technisch logging kunnen inschakelen. Voor gebruik binnen je eigen gezin is dat vertrouwensmodel prima; deel de Worker niet met anderen.
- De Client-ID is per ontwerp publiek en alleen bruikbaar vanaf de origins die jij in de Google Cloud Console toestaat.
