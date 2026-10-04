#!/bin/bash
# Quita Tablero de este Mac. Las tareas se conservan en
# ~/Library/Application Support/Tablero/datos por si vuelves a instalarlo.
set -uo pipefail

BASE="$HOME/Library/Application Support/Tablero"
AGENTES="$HOME/Library/LaunchAgents"
DOMINIO="gui/$(id -u)"

for label in com.tablero.servidor com.tablero.avisos; do
  launchctl bootout "$DOMINIO/$label" 2>/dev/null
  rm -f "$AGENTES/$label.plist"
done
rm -rf "$BASE/app"

echo "✓ Tablero se ha desinstalado."
echo "  Tus tareas siguen en: $BASE/datos"
echo "  Si también tenías la app de Chrome, quítala desde Chrome (chrome://apps)."
