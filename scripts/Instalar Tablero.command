#!/bin/bash
# Instala o actualiza Tablero en este Mac. Las tareas guardadas no se tocan.
#
# Copia la app a ~/Library/Application Support/Tablero/app, guarda los datos en
# ~/Library/Application Support/Tablero/datos y deja el servidor local arrancando
# solo al iniciar sesión.
set -euo pipefail

ORIGEN="$(cd "$(dirname "$0")" && pwd)/app"
BASE="$HOME/Library/Application Support/Tablero"
APP="$BASE/app"
DATOS="$BASE/datos"
AGENTES="$HOME/Library/LaunchAgents"
PUERTO="${TABLERO_PUERTO:-4747}"
URL="http://127.0.0.1:$PUERTO/"
DOMINIO="gui/$(id -u)"
SERVIDOR="com.tablero.servidor"
AVISOS="com.tablero.avisos"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
responde() { curl -fs --max-time 1 "${URL}api/health" 2>/dev/null | grep -q '"tablero"'; }

detener() {
  launchctl bootout "$DOMINIO/$1" 2>/dev/null || true
  for _ in $(seq 1 25); do
    launchctl print "$DOMINIO/$1" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
}

echo "Instalando Tablero…"

if [ ! -x "$ORIGEN/bin/node" ] || [ ! -f "$ORIGEN/server/index.mjs" ]; then
  echo "Este paquete está incompleto: falta $ORIGEN" >&2
  exit 1
fi

# Lo que llega por internet o AirDrop viene en cuarentena y macOS no lo dejaría arrancar.
xattr -dr com.apple.quarantine "$ORIGEN" 2>/dev/null || true
mkdir -p "$DATOS" "$AGENTES"

# 1. Para la versión anterior, y cualquier servidor de Tablero arrancado a mano.
detener "$SERVIDOR"
detener "$AVISOS"
if responde; then
  for pid in $(lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN -t 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  sleep 0.5
fi

# 2. Copia la app nueva. Los datos viven aparte y se conservan.
rm -rf "$APP.nueva"
cp -Rc "$ORIGEN" "$APP.nueva" 2>/dev/null || cp -R "$ORIGEN" "$APP.nueva"
rm -rf "$APP"
mv "$APP.nueva" "$APP"

# 3. Servidor local: arranca al iniciar sesión y se reinicia si se cae.
cat > "$AGENTES/$SERVIDOR.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVIDOR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$APP/bin/node")</string>
    <string>$(xml "$APP/server/index.mjs")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TABLERO_DATA_DIR</key>
    <string>$(xml "$DATOS")</string>
    <key>PORT</key>
    <string>$PUERTO</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$(xml "$APP")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$(xml "$DATOS/servidor.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$DATOS/servidor.log")</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$DOMINIO" "$AGENTES/$SERVIDOR.plist"

for _ in $(seq 1 50); do
  responde && break
  sleep 0.2
done
if ! responde; then
  echo "El servidor no ha arrancado. Revisa: $DATOS/servidor.log" >&2
  exit 1
fi

# 4. Avisos en el iPhone: copia las tareas con hora a Recordatorios (si el paquete trae el ayudante).
AYUDANTE="$APP/Tablero Avisos.app/Contents/MacOS/Tablero Avisos"
if [ -x "$AYUDANTE" ]; then
  cat > "$AGENTES/$AVISOS.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$AVISOS</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$AYUDANTE")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TABLERO_DATA_DIR</key>
    <string>$(xml "$DATOS")</string>
    <key>PORT</key>
    <string>$PUERTO</string>
  </dict>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$(xml "$DATOS/avisos.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$DATOS/avisos.log")</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "$DOMINIO" "$AGENTES/$AVISOS.plist"
  AVISOS_OK=1
else
  rm -f "$AGENTES/$AVISOS.plist"
  AVISOS_OK=0
fi

echo
echo "✓ Tablero está instalado y arrancará solo cada vez que inicies sesión."
echo "  Datos: $DATOS"
if [ "$AVISOS_OK" = "1" ]; then
  echo "✓ Avisos en el iPhone activados. Si macOS pregunta si «Tablero Avisos» puede"
  echo "  acceder a Recordatorios, pulsa «Permitir»."
fi
echo

if [ "${TABLERO_SIN_ABRIR:-}" != "1" ]; then
  if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "$URL"
    echo "Se ha abierto en Chrome. Para tenerlo en el Dock, pulsa «Instalar» en la barra de Tablero"
    echo "(o el icono de instalar que aparece a la derecha de la barra de direcciones)."
  else
    open "$URL"
    echo "Tablero funciona mejor con Google Chrome: https://www.google.com/chrome/"
  fi
fi
