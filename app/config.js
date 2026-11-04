// Impostazioni di Casa mia. Il repository è pubblico: qui NON vanno mai password, chiavi segrete o indirizzi segreti.
window.CASA_CONFIG = {
  // Posizione per il meteo (Roma)
  lat: 41.9028,
  lon: 12.4964,
  luogo: "Roma",
  // Dalle 18 la scheda meteo mostra domani
  oraSera: 18,
  // Diretta video
  videoUrl: "https://www.raiplay.it/dirette/rainews24",
  videoNome: "RaiNews24 in diretta",
  // Lista della spesa su Google Tasks.
  // googleClientId: l'ID client OAuth "Applicazione web" creato su Google Cloud (non è segreto). Vuoto = lista non collegata.
  googleClientId: "",
  listaSpesa: "Spesa",
  // Versione di casa (servizio sul tablet), raggiungibile solo dal Wi-Fi di casa
  homeUrl: "http://192.168.1.47:8080",
  // Repository (per il link che aggiorna l'elenco delle scuole della mensa)
  repoUrl: "https://github.com/lucaalbanesi/homemate",
  // Riposo dello schermo (solo sul tablet con Fully Kiosk o con ?kiosk nell'indirizzo)
  riposoMinuti: 2,
};
