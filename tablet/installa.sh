#!/data/data/com.termux/files/usr/bin/bash
# Installa (o aggiorna) la versione di casa di HomeMate sul tablet e la fa partire a ogni accensione.
# Si lancia in Termux con:
#   curl -fsSL "https://raw.githubusercontent.com/lucaalbanesi/homemate/main/tablet/installa.sh?t=$(date +%s)" | bash
set -e
echo ""
echo "== HomeMate: installazione della versione di casa =="
export DEBIAN_FRONTEND=noninteractive
if command -v node >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  echo "1/4 Node.js e git già presenti"
else
  echo "1/4 Installo Node.js e git (qualche minuto)..."
  pkg update -y
  pkg upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
  pkg install -y nodejs git
fi

echo "2/4 Scarico HomeMate da GitHub..."
if [ -d "$HOME/homemate/.git" ]; then
  git -C "$HOME/homemate" pull --ff-only -q
else
  git clone -q --depth 1 https://github.com/lucaalbanesi/homemate "$HOME/homemate"
fi

echo "2b/4 Componente del robot Dreame (Python, solo la prima volta qualche minuto)..."
set +e
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import cryptography.x509.verification" >/dev/null 2>&1; then
  pkg install -y python python-cryptography >/dev/null 2>&1 || echo "   (non riesco a installare Python: il robot non sarà disponibile)"
fi
python3 -c "import requests, certifi, paho.mqtt" >/dev/null 2>&1 || pip install -q requests certifi paho-mqtt >/dev/null 2>&1 || pip install -q --break-system-packages requests certifi paho-mqtt >/dev/null 2>&1 || echo "   (non riesco a installare le librerie Python del robot)"
# protocollo cloud Dreamehome dal progetto open source Tasshack/dreame-vacuum (MIT)
if [ -d "$HOME/dreame-vacuum/.git" ]; then
  git -C "$HOME/dreame-vacuum" pull --ff-only -q >/dev/null 2>&1
else
  git clone -q --depth 1 https://github.com/Tasshack/dreame-vacuum "$HOME/dreame-vacuum" >/dev/null 2>&1 || echo "   (non riesco a scaricare il componente Dreame)"
fi
if printf '' | python3 "$HOME/homemate/tablet/dreame_bridge.py" 2>/dev/null | grep -q '"ok": true'; then echo "   Robot: pronto"; else echo "   Robot: componente non pronto (il resto funziona)"; fi
set -e

echo "3/4 Preparo l'avvio automatico..."
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/homemate.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Avvio di HomeMate (Termux:Boot lo lancia a ogni accensione del tablet).
termux-wake-lock
cd "$HOME/homemate" || exit 1
while true; do
  [ -f "$HOME/homemate.log" ] && [ "$(wc -c < "$HOME/homemate.log")" -gt 1000000 ] && mv "$HOME/homemate.log" "$HOME/homemate.log.1"
  git pull --ff-only -q >/dev/null 2>&1 || true
  node tablet/server.mjs >> "$HOME/homemate.log" 2>&1
  sleep 5
done
BOOT
chmod +x "$HOME/.termux/boot/homemate.sh"

echo "4/4 Avvio..."
pkill -f "termux/boot/homemate.sh" 2>/dev/null || true
pkill -f "tablet/server.mjs" 2>/dev/null || true
pkill -f "prova.mjs" 2>/dev/null || true
sleep 1
nohup bash "$HOME/.termux/boot/homemate.sh" >/dev/null 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if curl -fs http://localhost:8080/api/casa >/dev/null 2>&1; then break; fi
done
echo ""
if curl -fs http://localhost:8080/api/casa >/dev/null 2>&1; then
  echo "HomeMate di casa è acceso."
  echo "  Sul tablet (Fully Kiosk):   http://localhost:8080/?kiosk"
  echo "  Dai telefoni sul Wi-Fi:     http://192.168.1.47:8080"
  echo ""
  tail -n 12 "$HOME/homemate.log"
  echo ""
  echo "Ultimo passo, una volta sola: installa Termux:Boot da F-Droid e aprilo una volta."
  echo "Così HomeMate riparte da solo quando il tablet si riaccende."
  echo "Puoi chiudere questa finestra (non toccare 'Exit' nella notifica di Termux)."
else
  echo "Non riesco ad avviare HomeMate. Mandami queste righe:"
  tail -n 30 "$HOME/homemate.log" 2>/dev/null || true
fi
