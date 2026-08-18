# Familie App

Een lichtgewicht familie-webapp met een **weekoverzicht** gekoppeld aan Google Calendar en een **boodschappenlijst**. Puur HTML, CSS en vanilla JavaScript — geen build-stap of eigen server nodig.

## Functies

- 📅 **Weekoverzicht** (maandag t/m zondag) met navigatie *vorige / vandaag / volgende*; vandaag is gemarkeerd.
- 🔗 **Google Calendar**: log in met je Google-account en zie de afspraken van de zichtbare week (alleen-lezen).
- 🛒 **Boodschappenlijst**: items toevoegen, afvinken en verwijderen — persistent in je browser, werkt ook offline en zonder Google-login.

## Lokaal draaien

De Google-bibliotheken vereisen dat de app via `http(s)` wordt geserveerd (niet via `file://`). Start een simpele webserver in de projectmap:

```bash
python3 -m http.server 8000
# of: npx serve .
```

Open daarna <http://localhost:8000>.

## Google Calendar koppelen

De app bevat bewust **geen** API-keys of Client-ID's. Je maakt ze eenmalig zelf aan en voert ze in via het ⚙️-paneel in de app; ze worden alleen lokaal in je browser bewaard.

1. Ga naar de [Google Cloud Console](https://console.cloud.google.com/) en maak een project aan (bijv. "familie-app").
2. Zet de **Google Calendar API** aan: *APIs & Services → Library → Google Calendar API → Enable*.
3. Configureer het **OAuth consent screen** (*APIs & Services → OAuth consent screen*):
   - User type: **External**, publishing status mag **Testing** blijven.
   - Voeg de Google-accounts van je gezinsleden toe als **test users**.
4. Maak een **OAuth Client-ID** aan (*APIs & Services → Credentials → Create credentials → OAuth client ID*):
   - Application type: **Web application**.
   - Voeg bij **Authorized JavaScript origins** de URL toe waar de app draait, bijv. `http://localhost:8000` en/of je GitHub Pages-URL.
5. Maak een **API-key** aan (*Create credentials → API key*). Beperk de key bij voorkeur tot de Calendar API en je eigen domein.
6. Open de app, klik op **⚙️**, plak de Client-ID en API-key en klik op **Opslaan**.
7. Klik op **Verbind met Google Calendar** en log in.

## Bestandsstructuur

```
├── index.html      # Structuur: weekoverzicht, boodschappenlijst, instellingen-dialog
├── css/style.css   # Responsive layout (mobiel eerst)
├── js/app.js       # Opstart, weeknavigatie, weekgrid renderen
├── js/calendar.js  # Google-login en events per week ophalen
├── js/shopping.js  # Boodschappenlijst met localStorage
└── PLAN.md         # Ontwerp en stappenplan
```

## Privacy & veiligheid

- De agenda wordt **alleen-lezen** benaderd (`calendar.readonly`).
- Client-ID, API-key en de boodschappenlijst blijven in `localStorage` van je eigen browser; er is geen backend en er worden geen gegevens naar derden gestuurd.
