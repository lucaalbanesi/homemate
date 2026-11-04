#!/data/data/com.termux/files/usr/bin/bash
# Prova di HomeMate sul tablet: installa Node.js, avvia un server di prova e cerca le Shelly in casa.
# Si lancia in Termux con:  curl -fsSL https://raw.githubusercontent.com/lucaalbanesi/homemate/main/tablet/prova.sh | bash
set -e
echo ""
echo "== HomeMate: prova del tablet =="
echo "1/3 Aggiorno Termux e installo Node.js (qualche minuto la prima volta)..."
yes | pkg update -y >/dev/null 2>&1 || true
pkg upgrade -y -o Dpkg::Options::="--force-confnew" >/dev/null 2>&1 || true
pkg install -y nodejs curl >/dev/null 2>&1
echo "    Node.js $(node -v) installato"
echo "2/3 Scarico la prova..."
mkdir -p "$HOME/homemate-prova"
curl -fsSL https://raw.githubusercontent.com/lucaalbanesi/homemate/main/tablet/prova.mjs -o "$HOME/homemate-prova/prova.mjs"
echo "3/3 Avvio. Per fermare: tasto CTRL e poi C."
termux-wake-lock 2>/dev/null || true
cd "$HOME/homemate-prova" && node prova.mjs
