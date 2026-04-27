#!/bin/bash
# Script de validación end-to-end del sistema Workana Autopilot
# Uso: bash test-sistema.sh

set -e

API="https://workana-auto-pilot.ioefpm.easypanel.host"

echo "🔍 === VALIDACIÓN WORKANA AUTOPILOT ==="
echo ""

# 1. Health check
echo "1️⃣  Health check..."
HEALTH=$(curl -s "$API/health")
echo "$HEALTH" | jq .
BROWSER_OK=$(echo "$HEALTH" | jq -r '.browser')
if [ "$BROWSER_OK" != "true" ]; then
  echo "❌ Browser no está corriendo"
  exit 1
fi
echo "✅ Browser corriendo"
echo ""

# 2. Session check
echo "2️⃣  Verificando sesión..."
SESSION=$(curl -s "$API/session-check")
echo "$SESSION" | jq .
LOGGED_IN=$(echo "$SESSION" | jq -r '.loggedIn')
if [ "$LOGGED_IN" != "true" ]; then
  echo "⚠️  Sesión caída — intentando login..."

  # Clear cookies
  echo "   - Limpiando cookies..."
  curl -s -X POST "$API/clear-cookies" > /dev/null
  sleep 2

  # Login
  echo "   - Haciendo login..."
  LOGIN_RESULT=$(curl -s -X POST "$API/login")
  echo "$LOGIN_RESULT" | jq .
  LOGIN_SUCCESS=$(echo "$LOGIN_RESULT" | jq -r '.success')
  LOGIN_URL=$(echo "$LOGIN_RESULT" | jq -r '.url')

  if [ "$LOGIN_SUCCESS" != "true" ]; then
    echo "❌ Login falló: $LOGIN_RESULT"
    exit 1
  fi

  # Validar URL
  if [[ "$LOGIN_URL" != *"workana.com"* ]]; then
    echo "❌ Login retornó URL inválida: $LOGIN_URL"
    echo "   ℹ️  Esto indica que el browser está en estado corrupto."
    echo "   🔧 Acción requerida: Rebuild en Easypanel"
    exit 1
  fi

  echo "✅ Login exitoso"
else
  echo "✅ Sesión activa"
fi
echo ""

# 3. Test scraping (1 proyecto)
echo "3️⃣  Test de scraping (1 proyecto de it-programming)..."
SCRAPE_RESULT=$(curl -s "$API/scrape-projects?category=it-programming&page=1")
PROJECT_COUNT=$(echo "$SCRAPE_RESULT" | jq '.projects | length')
echo "   Proyectos encontrados: $PROJECT_COUNT"
if [ "$PROJECT_COUNT" -eq "0" ]; then
  echo "⚠️  No se encontraron proyectos (puede ser normal si no hay nuevos)"
else
  echo "✅ Scraping funciona"
  echo "$SCRAPE_RESULT" | jq '.projects[0] | {title, url, budget_text}'
fi
echo ""

# 4. Verificar propuestas pendientes en Supabase
echo "4️⃣  Verificando propuestas pendientes..."
SUPABASE_URL="https://zcmqcosuvjndgcwylzna.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbXFjb3N1dmpuZGdjd3lsem5hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMxNTcwOCwiZXhwIjoyMDg4ODkxNzA4fQ.lgJ_VxIBAZMmTtjo3L4vUwsIGRD_glaYYsdhHkuUTHM"

PENDING=$(curl -s "$SUPABASE_URL/rest/v1/workana_projects?select=id,title,created_at,relevance_score&status=eq.proposal_generated&auto_sent=eq.true&order=created_at.desc&limit=50" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

PENDING_COUNT=$(echo "$PENDING" | jq '. | length')
echo "   Propuestas pendientes de envío: $PENDING_COUNT"

if [ "$PENDING_COUNT" -gt "0" ]; then
  echo "   📋 Últimas 5:"
  echo "$PENDING" | jq -r '.[:5] | .[] | "   - [\(.created_at | split("T")[0])] score=\(.relevance_score) | \(.title[:60])"'
fi
echo ""

echo "✅ === VALIDACIÓN COMPLETA ==="
echo ""
echo "📊 Resumen:"
echo "   - Browser: OK"
echo "   - Sesión: $([ "$LOGGED_IN" = "true" ] && echo "✅ Activa" || echo "⚠️  Requirió re-login")"
echo "   - Scraping: $([ "$PROJECT_COUNT" -gt "0" ] && echo "✅ Funciona" || echo "⚠️  Sin proyectos")"
echo "   - Propuestas pendientes: $PENDING_COUNT"
echo ""

if [ "$PENDING_COUNT" -gt "0" ]; then
  echo "ℹ️  Hay $PENDING_COUNT propuestas pendientes de envío."
  echo "   El workflow de n8n las procesará en las próximas ejecuciones (cada 30 min)."
  echo "   Monitorea los WhatsApp para confirmar envíos exitosos."
fi
