# Plan: Familie-app met weekoverzicht, Google Calendar en boodschappenlijst

## Doel

Een lichtgewicht HTML-webapp voor het gezin met:

1. **Weekoverzicht** — de agenda per week (ma t/m zo), gevoed door Google Calendar.
2. **Boodschappenlijst** — items toevoegen, afvinken en verwijderen, lokaal bewaard.

## Uitgangspunten

- **Puur front-end**: HTML + CSS + vanilla JavaScript, geen build-stap en geen eigen server nodig. De app kan als statische site gehost worden (bijv. GitHub Pages).
- **Google Calendar integratie** via de officiële Google-bibliotheken in de browser:
  - **Google Identity Services (GIS)** voor OAuth2-login (scope: `calendar.readonly`).
  - **Google Calendar API v3** om events van de gekozen week op te halen.
- **Geen API-keys of secrets in de code.** De OAuth Client-ID en API-key worden bij eerste gebruik door de gebruiker ingevoerd en in `localStorage` bewaard (een Client-ID is publiek, maar we committen hem bewust niet).
- **Boodschappenlijst in `localStorage`**: werkt offline, geen backend nodig. (Delen tussen gezinsleden kan later als uitbreiding.)

## Bestandsstructuur

```
familie-app/
├── index.html      # Structuur: header, weeknavigatie, agenda-grid, boodschappenlijst
├── css/
│   └── style.css   # Responsive layout (mobiel eerst), weekgrid, lijststijlen
├── js/
│   ├── app.js      # Opstart, weeknavigatie, koppeling tussen modules
│   ├── calendar.js # Google auth + events per week ophalen en renderen
│   └── shopping.js # Boodschappenlijst: toevoegen/afvinken/verwijderen + localStorage
├── PLAN.md
└── README.md       # Setup-instructies (Google Cloud project, Client-ID aanmaken)
```

## Functioneel ontwerp

### Weekoverzicht
- Kop met de actuele week ("Week 34 · 17–23 aug 2026") en knoppen **◀ vorige / vandaag / volgende ▶**.
- Zeven kolommen (mobiel: zeven rijen onder elkaar), vandaag visueel gemarkeerd.
- Per dag de events uit Google Calendar: tijd + titel, hele-dag-events bovenaan.
- Status zonder login: knop "Verbind met Google Calendar"; na login worden events geladen en blijft de sessie via token-refresh bruikbaar.

### Boodschappenlijst
- Invoerveld + knop (en Enter) om items toe te voegen.
- Afvinken (doorgestreept), verwijderen per item en "gekochte items wissen".
- Teller ("3 van 8 gedaan"); alles persistent in `localStorage`.

## Stappenplan

1. **Basisskelet** — `index.html`, `style.css`, `app.js`: layout met twee secties (agenda + boodschappen), weeknavigatie die zonder Google al werkt (lege dagen tonen).
2. **Boodschappenlijst** — `shopping.js` volledig werkend met `localStorage`.
3. **Google Calendar** — `calendar.js`: GIS-login, instellingenpaneel voor Client-ID/API-key, events van de zichtbare week ophalen (`timeMin`/`timeMax`) en in het grid renderen; nette foutafhandeling (niet ingelogd, quota, offline).
4. **Afwerking** — responsive styling, laad-/foutmeldingen, README met stap-voor-stap Google Cloud-instructies (OAuth consent screen, Client-ID, toegestane origins).

## Mogelijke uitbreidingen (later)

- Boodschappenlijst delen via een kleine backend of Firebase.
- Events aanmaken/bewerken (scope `calendar.events`).
- Meerdere agenda's (per gezinslid) met kleurcodering.
- PWA maken (offline + "installeren" op telefoon).
