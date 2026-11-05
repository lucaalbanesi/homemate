# HomeMate

HomeMate (sull'icona "Casa mia") è la pagina di casa: orologio, meteo, notizie e lista della spesa. Si apre da ovunque e si installa sul telefono come app.
La domotica (tapparelle e luci Shelly) funziona solo nella **versione di casa**, che gira sul tablet e risponde solo dal Wi-Fi di casa.

- **Sito**: https://lucaalbanesi.github.io/homemate/
- **Versione di casa**: http://192.168.1.47:8080 dai dispositivi sul Wi-Fi di casa; sul tablet `http://localhost:8080/?kiosk`.
- **Prova da fuori casa**: https://lucaalbanesi.github.io/homemate/#prova mostra anche la sezione Casa con dispositivi simulati.

## Come è fatta

| Parte | Da dove arriva | Dove |
|---|---|---|
| Meteo | Open-Meteo, chiesto direttamente dal browser | `app/app.js` |
| Notizie | 6 feed ANSA, scelte da un job ogni 30 minuti e salvate in `data/news.json` | `scripts/news.mjs`, `.github/workflows/pubblica.yml` |
| Diretta video | link a RaiNews24 | `app/config.js` |
| Mensa | sito del Comune (MESIS), per le scuole in `config/mensa.json`, letto una volta a settimana (il sabato) e salvato in `data/menu.json` | `scripts/menu.mjs`, `.github/workflows/menu.yml` |
| Spesa | Google Tasks, lista "Spesa": online con l'accesso Google di chi usa la pagina, sul tablet collegata una volta sola | `app/app.js` |

Il repository è pubblico: in `app/config.js` non vanno mai password o chiavi segrete. L'ID client Google non è un segreto.

### Come vengono scelte le notizie

Punti per ogni notizia: +3 se è in primo piano su ANSA, +3 se riguarda Roma o il Lazio, +2 se ha effetti sulla vita di tutti
i giorni (scioperi, trasporti, maltempo, bollette, tasse, mutui, scuola, sanità…), +1 se compare in più feed, −1 ogni 3 ore di età.
Restano le 10 con più punti delle ultime 24 ore; la pagina ne mostra 2 e le altre toccando la scheda.
Ogni notizia ha un'immagine: quella del feed ANSA, altrimenti quella dell'articolo (og:image); se manca o non si carica, un riquadro neutro.

## Da fare una volta

### 1. Pubblicazione
Settings → Pages → Source: **GitHub Actions**. Dopo il primo push il sito è online in un paio di minuti.

### 2. Menu della mensa
Ogni dispositivo, al primo avvio, chiede municipio e ciclo e li ricorda; si cambiano dall'icona Impostazioni (o "cambia" sulla scheda).
Il job scarica però solo le scuole elencate in `config/mensa.json`. Per cambiare o aggiungere una scuola non serve toccare il file:
Actions → **Menu mensa** → Run workflow → scegli municipio e ciclo, e "sostituisci" (al posto della precedente) o "aggiungi".
Il job aggiorna l'elenco e scarica subito il menu. In alternativa si modifica `combinazioni` a mano, es. `{ "municipio": 9, "ciclo": 5 }`.

| Municipio | I | II | III | IV | V | VI | VII | VIII | IX | X | XI | XII | XIII | XIV | XV |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Codice | 1 | 2 | 4 | 5 | 6 | 8 | 9 | 11 | 12 | 13 | 15 | 16 | 18 | 19 | 20 |

Ciclo: 1 nido medi, 2 nido grandi, 3 ponte, 4 infanzia, 5 primaria, 6 secondaria di I grado.

Il job gira il sabato mattina e scarica la settimana dopo, da lunedì a venerdì: 5 richieste a settimana per scuola, con una pausa
tra l'una e l'altra. Quando cambia `config/mensa.json` riparte subito e scarica i giorni rimasti della settimana in corso.
Elenco e menu sono pubblici come tutto il repository: si vede quale municipio e ciclo si seguono, non la scuola né chi la frequenta.

### 3. Lista della spesa (Google Tasks)
1. Vai su https://console.cloud.google.com, crea un progetto "Casa mia".
2. API e servizi → Libreria → abilita **Google Tasks API**.
3. Schermata di consenso OAuth (Google Auth Platform) → Esterno → nome "Casa mia", la tua email come supporto e contatto.
   In **Pubblico** premi **Pubblica app** (In produzione): in "Test" l'accesso del tablet scadrebbe ogni 7 giorni.
4. Client → Crea client → tipo **Applicazione web**, nome "Casa mia":
   - Origini JavaScript autorizzate: `https://lucaalbanesi.github.io`
   - URI di reindirizzamento autorizzati: `http://localhost:8080/google/fatto`
5. Copia l'**ID client** (finisce con `.apps.googleusercontent.com`) in `app/config.js`, alla voce `googleClientId`.
   Il **client secret** (inizia con `GOCSPX-`) NON va nel repository: si incolla solo sul tablet (sotto).

Al primo accesso Google mostra "Google non ha verificato questa app": è normale per un'app personale, si continua con Avanzate → Vai a Casa mia.

- **Online** (telefono, PC): la scheda Spesa mostra "Accedi con Google"; l'accesso dura circa un'ora, poi si ritocca il pulsante.
- **Tablet di casa**: si collega una volta sola e resta collegato. Sul tablet apri **Chrome** (non Fully Kiosk: Google lì non fa entrare)
  all'indirizzo `http://localhost:8080/google`, incolla il client secret, tocca **Collega Google** e approva.
  Il collegamento resta in `~/.homemate/google.json` sul tablet. Dalla stessa pagina si può scollegare.

## Versione di casa (tablet)

Il servizio `tablet/server.mjs` gira in Termux sul tablet, porta 8080. Serve la stessa pagina del sito, in più la sezione Casa:
legge e comanda le Shelly elencate in `config/casa.json` (tapparelle Plus 2PM con l'API locale, il Dimmer 2 del soggiorno)
e prende notizie e menu dal sito online. In `riquadri` si decide come la pagina raggruppa le tapparelle: ogni riga comanda
insieme le sue tapparelle con i pulsanti indicati (es. Apri · 50% · Chiudi), le etichette 1, 2, 3 muovono una tapparella alla volta.

- **Riscaldamento Tado** (API cloud di Tado: valvole V3/V3+ e tado X, riconosciute da sole): sul tablet, nella scheda Riscaldamento, "Collega Tado" mostra un link
  da aprire (anche dal telefono) per approvare con il proprio account. Il collegamento resta solo sul tablet in `~/.homemate/tado.json`.
  Stato aggiornato ogni minuto (con AI Assist Tado concede 20.000 richieste al giorno). Comandi: Max per 30 min (25 °C),
  Ripristina programma, Spegni tutto (fino a Ripristina), e per ogni stanza una temperatura fino a ora+1, +2 o +3 ore.
- **Installazione o aggiornamento** (in Termux, una riga):
  `curl -fsSL "https://raw.githubusercontent.com/lucaalbanesi/homemate/main/tablet/installa.sh?t=$(date +%s)" | bash`
- **Avvio automatico**: installa Termux:Boot da F-Droid e aprilo una volta. Termux, Termux:Boot e Fully Kiosk con batteria "Senza restrizioni".
- **Aggiornamenti**: a ogni avvio e ogni notte alle 4 il tablet scarica le novità da GitHub e si riavvia da solo.
- **Registro**: `~/homemate.log` sul tablet (in Termux: `tail -n 30 ~/homemate.log`).
- **Sicurezza**: non aprire mai la porta 8080 nel router. Chiunque sia sul Wi-Fi di casa può comandare le tapparelle: per gli ospiti usa la rete ospiti.
- **Indirizzi**: gli indirizzi delle Shelly e del tablet vanno riservati nel router, altrimenti possono cambiare.

## Prove in locale

- `node scripts/test.mjs` prova la scelta delle notizie.
- `node scripts/news.mjs app/data/news.json` scarica le notizie vere, poi apri `app/` con un server qualsiasi.
