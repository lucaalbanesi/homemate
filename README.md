# HomeMate

HomeMate (sull'icona "Casa mia") è la pagina di casa: orologio, meteo, notizie e lista della spesa. Si apre da ovunque e si installa sul telefono come app.
La parte di domotica (tapparelle, Tado, luci) arriverà in una versione che funziona solo dal Wi-Fi di casa.

- **Sito**: https://lucaalbanesi.github.io/homemate/
- **Sul tablet** (Fully Kiosk): aggiungi `?kiosk` all'indirizzo per avere schermo a riposo e grandezza adattata.

## Come è fatta

| Parte | Da dove arriva | Dove |
|---|---|---|
| Meteo | Open-Meteo, chiesto direttamente dal browser | `app/app.js` |
| Notizie | 6 feed ANSA, scelte da un job ogni 30 minuti e salvate in `data/news.json` | `scripts/news.mjs`, `.github/workflows/pubblica.yml` |
| Diretta video | link a RaiNews24 | `app/config.js` |
| Spesa | Google Tasks, lista "Spesa", con l'accesso Google di chi usa la pagina | `app/app.js` |

Il repository è pubblico: in `app/config.js` non vanno mai password o chiavi segrete. L'ID client Google non è un segreto.

### Come vengono scelte le notizie

Punti per ogni notizia: +3 se è in primo piano su ANSA, +3 se riguarda Roma o il Lazio, +2 se ha effetti sulla vita di tutti
i giorni (scioperi, trasporti, maltempo, bollette, tasse, mutui, scuola, sanità…), +1 se compare in più feed, −1 ogni 3 ore di età.
Restano le 10 con più punti delle ultime 24 ore; la pagina ne mostra 2 e le altre toccando la scheda.

## Da fare una volta

### 1. Pubblicazione
Settings → Pages → Source: **GitHub Actions**. Dopo il primo push il sito è online in un paio di minuti.

### 2. Lista della spesa (Google Tasks)
1. Vai su https://console.cloud.google.com, crea un progetto "Casa mia".
2. API e servizi → Libreria → abilita **Google Tasks API**.
3. Schermata di consenso OAuth → Esterno → nome "Casa mia" → in "Utenti di prova" aggiungi la tua email e quella di Alessandra.
4. Credenziali → Crea credenziali → **ID client OAuth** → tipo **Applicazione web** →
   Origini JavaScript autorizzate: `https://lucaalbanesi.github.io`.
5. Copia l'ID client (finisce con `.apps.googleusercontent.com`) in `app/config.js`, alla voce `googleClientId`.

Al primo accesso Google mostra "app non verificata": è normale per un'app personale, si continua con Avanzate.
L'accesso dura circa un'ora; poi la scheda chiede di toccare "Accedi con Google" di nuovo (da migliorare per il tablet).

## Prove in locale

- `node scripts/test.mjs` prova la scelta delle notizie.
- `node scripts/news.mjs app/data/news.json` scarica le notizie vere, poi apri `app/` con un server qualsiasi.
