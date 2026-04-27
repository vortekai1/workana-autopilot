#!/bin/bash
# Script de monitoreo y auto-recuperación para Workana Autopilot
# Uso: bash health-check.sh [--auto-recover]
# Cron: */10 * * * * bash /path/to/health-check.sh --auto-recover >> /var/log/workana-health.log 2>&1

set -e

API="https://workana-auto-pilot.ioefpm.easypanel.host"
AUTO_RECOVER=false

# Parse args
if [ "$1" == "--auto-recover" ]; then
  AUTO_RECOVER=true
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') — Health check iniciado"

# 1. Health check
HEALTH=$(curl -s "$API/health" || echo '{"status":"error"}')
BROWSER_OK=$(echo "$HEALTH" | jq -r '.browser // false')
LOGGED_IN=$(echo "$HEALTH" | jq -r '.loggedIn // false')

echo "  Browser: $BROWSER_OK"
echo "  Logged in: $LOGGED_IN"

# 2. Si browser caído, intentar auto-recuperación
if [ "$BROWSER_OK" != "true" ]; then
  echo "❌ Browser caído"

  if [ "$AUTO_RECOVER" == "true" ]; then
    echo "🔧 Auto-recuperación: reiniciando browser..."
    RESTART_RESULT=$(curl -s -X POST "$API/restart-browser")
    RESTART_OK=$(echo "$RESTART_RESULT" | jq -r '.success // false')

    if [ "$RESTART_OK" == "true" ]; then
      echo "✅ Browser reiniciado correctamente"
      sleep 5
      # Intentar login
      echo "🔑 Intentando login..."
      LOGIN_RESULT=$(curl -s -X POST "$API/login")
      LOGIN_OK=$(echo "$LOGIN_RESULT" | jq -r '.success // false')
      if [ "$LOGIN_OK" == "true" ]; then
        echo "✅ Login exitoso tras reinicio"
        exit 0
      else
        echo "⚠️  Login falló tras reinicio"
        exit 1
      fi
    else
      echo "❌ Restart browser falló"
      exit 1
    fi
  else
    echo "ℹ️  Auto-recuperación desactivada. Ejecutar con --auto-recover para habilitar."
    exit 1
  fi
fi

# 3. Si browser OK pero sesión caída, intentar auto-recuperación
if [ "$LOGGED_IN" != "true" ]; then
  echo "⚠️  Sesión caída"

  # Session check detallado
  SESSION=$(curl -s "$API/session-check")
  SESSION_STATUS=$(echo "$SESSION" | jq -r '.loggedIn // false')
  SESSION_URL=$(echo "$SESSION" | jq -r '.url // "unknown"')

  echo "  Session check: $SESSION_STATUS"
  echo "  URL: $SESSION_URL"

  if [ "$AUTO_RECOVER" == "true" ]; then
    echo "🔧 Auto-recuperación: limpiando sesión completa..."
    CLEAR_RESULT=$(curl -s -X POST "$API/force-clear-session")
    CLEAR_OK=$(echo "$CLEAR_RESULT" | jq -r '.success // false')
    LOGIN_OK=$(echo "$CLEAR_RESULT" | jq -r '.loginSuccess // false')

    if [ "$CLEAR_OK" == "true" ] && [ "$LOGIN_OK" == "true" ]; then
      echo "✅ Sesión limpiada y login exitoso"
      exit 0
    else
      echo "⚠️  Limpieza de sesión completada pero login falló"
      echo "  Login message: $(echo "$CLEAR_RESULT" | jq -r '.loginMessage // "unknown"')"
      echo "  Login URL: $(echo "$CLEAR_RESULT" | jq -r '.loginUrl // "unknown"')"
      exit 1
    fi
  else
    echo "ℹ️  Auto-recuperación desactivada. Ejecutar con --auto-recover para habilitar."
    exit 1
  fi
fi

# 4. Todo OK
echo "✅ Sistema operativo"
exit 0
