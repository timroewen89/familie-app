# Familie App

Een lichtgewicht familie-webapp met een **weekoverzicht** gekoppeld aan Google Calendar en een **boodschappenlijst**. Puur HTML, CSS en vanilla JavaScript — geen build-stap of eigen server nodig.

## Functies

- 📅 **Dag- én weekoverzicht** met een schakelaar, pijltjesnavigatie (*vorige / vandaag / volgende*) en veeggebaren op mobiel; vandaag is gemarkeerd.
- 🔗 **Google Calendar**: log in met je (persoonlijke) Google-account en zie de afspraken van de zichtbare periode (alleen-lezen).
- 📆 **Meerdere agenda's**: kies via de 📆-knop welke agenda's uit je account meedoen (bijv. je eigen agenda, een gedeelde gezinsagenda en verjaardagen). Elke afspraak krijgt de kleur van zijn agenda uit Google Calendar. Standaard doen de agenda's mee die je in Google Calendar zichtbaar hebt staan.
- 🏷️ **Persoonstags**: tik op een afspraak om gezinsleden (standaard Tim, Renate, Mick en Davi — aanpasbaar via ⚙️) te taggen, elk met een eigen kleur. Filter de agenda per persoon via de chips boven het overzicht. Tags worden lokaal bewaard (Google Calendar blijft alleen-lezen).
- 🛒 **Boodschappenlijst**: items toevoegen, afvinken en verwijderen — persistent in je browser, werkt ook offline en zonder Google-login.
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

## Privacy & veiligheid

- De agenda wordt **alleen-lezen** benaderd (`calendar.readonly`).
- Er is **geen API-key**: de Calendar API wordt aangeroepen met alleen het kortlevende OAuth-token, dat uitsluitend in het geheugen van de pagina leeft.
- Client-ID, boodschappenlijst en persoonstags blijven in `localStorage` van je eigen browser; er is geen backend en er worden geen gegevens naar derden gestuurd.
- De Client-ID is per ontwerp publiek en alleen bruikbaar vanaf de origins die jij in de Google Cloud Console toestaat.
