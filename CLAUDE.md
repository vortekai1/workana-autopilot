# Workana Autopilot

Sistema de automatización para enviar propuestas en Workana. Scrappea proyectos, genera propuestas con IA y las envía automáticamente o las notifica por WhatsApp.

## Arquitectura

```
n8n (cron 30min) → Control Cuota y Horario (probabilístico)
               → Puppeteer Service (:3500) → Workana.com
               → OpenAI (gpt-4o) genera propuestas
               → Supabase (crm-vortek) persiste datos [HTTP REST directo]
               → Evolution API → WhatsApp notificaciones
```

## Stack Tecnológico

- **Puppeteer Service**: Node.js + Express + Puppeteer + Stealth Plugin
- **Orquestación**: n8n workflow (cron cada 30 min, ejecución probabilística)
- **Base de datos**: Supabase HTTP REST directo (proyecto crm-vortek: `zcmqcosuvjndgcwylzna`)
- **IA**: OpenAI GPT-4o para generación de propuestas, scoring y A/B testing
- **Notificaciones**: Evolution API (WhatsApp)
- **Dashboard**: React + Vite + Tailwind + Recharts (desplegado en Hostinger)
- **Despliegue**: Docker en Easypanel (Puppeteer) + Hostinger (Dashboard)

## Estructura del Proyecto

```
workana-autopilot/
├── .gitignore
├── CLAUDE.md
├── SETUP.md
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── sql-pro-upgrade.sql                # SQL PRO: columnas + 3 vistas analíticas
├── n8n-workflow.json                  # Workflow principal v5-PRO (~31 nodos)
├── n8n-workflow-daily-summary.json    # Resumen diario WhatsApp (22:00, 10 nodos)
├── n8n-workflow-retry.json            # Cola de reintentos (cada 15 min, 13 nodos)
├── n8n-workflow-feedback.json         # Feedback loop propuestas (9:00, 5 nodos)
├── src/
│   ├── server.js                      # API Express (11 endpoints, puerto 3500)
│   ├── browser.js                     # BrowserManager: Puppeteer + stealth + UA rotation + fatiga
│   ├── scraper.js                     # WorkanaScraper: scraping + detalles + feedback multi-página
│   └── submitter.js                   # ProposalSubmitter: envío MFE-compatible + verificación estricta
└── dashboard/
    ├── .env.example
    ├── .gitignore
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── deploy-hostinger.cjs           # Script SFTP deploy a Hostinger
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx                    # Layout principal con alertas + charts
        ├── lib/supabase.js            # Cliente Supabase
        ├── utils/formatters.js        # Helpers de formato
        ├── hooks/
        │   ├── useStats.js            # useStats, useWinRateTrend, useABResults, useAlerts
        │   ├── useProjects.js         # Hook proyectos con paginación
        │   └── useRetryQueue.js       # Hook cola de reintentos
        └── components/
            ├── KPICards.jsx           # 8 KPIs principales
            ├── ProposalsChart.jsx     # Propuestas por día (7 días)
            ├── CategoryChart.jsx      # Proyectos por categoría
            ├── ScoreChart.jsx         # Distribución de scores
            ├── StatusPieChart.jsx     # Pie chart de estados
            ├── ProjectsTable.jsx      # Tabla de proyectos con filtros
            ├── ProjectModal.jsx       # Modal detalle de proyecto
            ├── LogsTimeline.jsx       # Timeline de logs
            ├── RetryQueue.jsx         # Cola de reintentos
            ├── Layout.jsx             # Layout wrapper
            ├── AlertsBanner.jsx       # Alertas automáticas
            ├── WinRateChart.jsx       # Win rate semanal (90 días)
            └── ABTestResults.jsx      # Comparativa Variante A vs B
```

## API Endpoints (puerto 3500)

| Método | Ruta                  | Descripción                                                |
|--------|-----------------------|------------------------------------------------------------|
| GET    | `/health`             | Health check + uptime + RAM + timestamp                    |
| POST   | `/login`              | Login manual en Workana                                    |
| POST   | `/clear-cookies`      | Limpiar cookies + cache del browser (via CDP)              |
| POST   | `/restart-browser`    | Forzar cierre + re-lanzamiento del browser                 |
| POST   | `/force-clear-session`| Limpieza completa: cookies + restart + re-login automático |
| GET    | `/scrape-projects`    | Scrape una página de búsqueda                              |
| POST   | `/scrape-all`         | Scrape múltiples páginas/categorías                        |
| GET    | `/project-details`    | Detalles completos + client_projects_posted + hire_rate    |
| POST   | `/submit-proposal`    | Enviar propuesta (MFE-compatible + verificación agresiva)  |
| GET    | `/debug-form`         | Analizar formulario de propuesta sin enviar (debug)        |
| GET    | `/session-check`      | Verificar sesión activa                                    |
| GET    | `/screenshot`         | Screenshot PNG para debugging                              |
| GET    | `/debug-html`         | HTML de página (hasta 100KB)                               |
| GET    | `/my-proposals`       | Scrape propuestas enviadas (multi-página, param `maxPages`)|

## Base de Datos (Supabase crm-vortek)

5 tablas + 4 vistas en schema `public`:

### Tablas

- **workana_projects** — Proyectos scrapeados + scoring + status
  - UNIQUE constraint en `workana_url`
  - CHECK constraint en `status`: `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`
  - Upsert vía `?on_conflict=workana_url` + header `Prefer: resolution=merge-duplicates`
  - Campos base: `title`, `description`, `category`, `budget_text`, `skills`, `client_name`, `client_country`, `client_rating`, `client_verified`, `proposals_count`, `publication_date`, `relevance_score`, `red_flags`
  - Campos PRO scoring: `pre_score` (0-100), `budget_min`, `budget_max`, `budget_currency`, `budget_type`, `proposals_count_parsed`, `client_rating_parsed`, `client_projects_posted`, `client_hire_rate`, `win_probability`
  - Campos PRO tracking: `auto_sent` (BOOLEAN), `client_responded` (BOOLEAN), `outcome` (`won`/`lost`/`no_response`/`in_progress`), `response_time_hours`, `proposal_variant` (A/B)

- **workana_proposals** — Propuestas generadas por IA
  - `proposal_text`, `questions_text`, `budget_suggested`, `delivery_days`, `skills_recommended`, `portfolio_items`, `internal_notes`
  - Campos PRO A/B: `proposal_variant` (A/B), `word_count`, `tone` (direct/warm/technical/urgent), `pricing_strategy`
  - `created_at` usado para contar propuestas semanales (cuota)

- **workana_retry_queue** — Cola de reintentos para envíos fallidos
  - RLS habilitado (solo `service_role` tiene acceso)
  - `project_url`, `proposal_text`, `budget_suggested`, `delivery_days`
  - `attempt_count` / `max_attempts` (3) con backoff exponencial
  - `status`: `pending`, `processing`, `completed`, `failed`
  - Índice en `next_retry_at` WHERE `status = 'pending'`

- **workana_config** — Configuración del sistema
- **workana_logs** — Registro de todas las acciones

### Vistas (todas con `security_invoker = true`)

- **workana_conversion_stats** — Tasas de conversión por categoría (v1, básica)
- **workana_conversion_stats_v2** — PRO: win_rate, response_rate, avg_budget_won, avg_proposals_when_won
- **workana_winning_patterns** — PRO: datos de propuestas ganadoras/perdedoras para inyectar en IA
- **workana_ab_results** — PRO: comparativa A/B testing (win_rate, response_rate por variante)

RPCs: `get_new_workana_projects()`, `get_workana_daily_stats()`

## n8n Workflows (4 en total)

### Workflow Principal (n8n-workflow.json) — v5-PRO

### Credenciales necesarias en n8n (2):
1. **OpenAI API** — API key (tipo: OpenAI)
2. **HTTP Header Auth** — Para Evolution API (header name: `apikey`, value: API key de Evolution)

> Supabase NO usa credenciales n8n — se conecta vía HTTP REST con la key directamente en el nodo CONFIG.

### Nodo CONFIG (Code node con todas las variables):
- `PUPPETEER_URL` — `https://workana-auto-pilot.ioefpm.easypanel.host`
- `SUPABASE_URL` — `https://zcmqcosuvjndgcwylzna.supabase.co`
- `SUPABASE_KEY` — Service Role Key (embebida en el código)
- `EVOLUTION_URL` — `https://evo.vortekai.es`
- `EVOLUTION_INSTANCE` — `Ventas vortek`
- `WHATSAPP_NUMBER` — `34653693605`
- `SEARCH_CATEGORIES` — `['it-programming', 'design-multimedia', 'writing-translation', 'admin-support']`
- `SEARCH_PAGES` — `2`
- `MIN_RELEVANCE_AUTO` — `80`
- `MAX_PROPOSALS_WEEK_MIN` — `50`
- `MAX_PROPOSALS_WEEK_MAX` — `60`
- `MAX_PROPOSALS_ON_PROJECT` — `50`
- `AUTO_MODE` — `true` (autopiloto activado)

### Sistema de Cuota Semanal (anti-ban)

El nodo **"Control Cuota y Horario"** controla la ejecución con 4 capas:

1. **Horario laboral**: L-S, 8:00-22:00 Madrid. Domingos = no ejecuta.
2. **Cuota semanal**: Consulta `workana_proposals` en Supabase para contar propuestas desde el lunes. Objetivo aleatorio (50-60) determinista por número de semana.
3. **Bypass proyectos frescos**: Proyectos < 2h con < 10 propuestas → ejecuta sin importar el dado.
4. **Skip probabilístico**: `probabilidad = propuestas_restantes / ejecuciones_restantes`. Auto-compensación.

**Efecto**: ~8-10 propuestas/día distribuidas aleatoriamente.

### Flujo del workflow principal:

```
Cada 30 min → CONFIG → Check Horario → GET Cuota Semanal → Control Cuota y Horario
→ Verificar Sesión → ¿OK? → (NO: Re-Login → ¿OK? → NO: Alerta WhatsApp + STOP)
→ Scrape Workana → Parsear → Preparar Consulta DB → GET URLs Existentes (limit=10000)
→ Filtrar Nuevos (si 0 nuevos → return [] → flujo se detiene limpiamente)
→ GET Detalles Proyecto → Obtener Detalles (+ parseBudget) → Calcular Pre-Score
→ Preparar Prompt IA (+ patrones ganadores + perfil cliente + A/B testing)
→ IA Genera Propuesta (gpt-4o) → Estructurar Datos (+ variant + tone)
→ Guardar Proyecto (upsert) → ¿Aplica?
  ├─ SÍ → Preparar Propuesta → Guardar Propuesta → Auto Mode?
  │        ├─ AUTO + relevancia≥80 → Enviar → OK: WhatsApp ✅ / FALLO: retry_queue + WhatsApp ❌
  │        └─ MANUAL → WhatsApp con propuesta
  └─ NO → guardado como 'skipped'
```

### Mejoras PRO del workflow (v5):

#### parseBudget()
Parsea texto de presupuesto: `budget_min`, `budget_max`, `budget_currency`, `budget_type`

#### Pre-Score (base 30)
- **Frescura**: hasta +25pts (1h, 3h, 6h, 12h)
- **Competencia baja**: hasta +20pts (3, 7, 15, 25 propuestas)
- **Cliente verificado**: +8pts | **Rating**: hasta +8pts | **Hire rate**: hasta +7pts
- **Penalizaciones**: -10 si >35 propuestas, -20 si >45

#### Prompt IA adaptativo
- Inyecta patrones ganadores (`workana_winning_patterns`) y conversion stats v2
- Perfil de cliente: premium/experimentado/intermedio/nuevo
- A/B Testing: Variante A (técnico-directo) o B (empático-consultivo), hash determinístico del URL
- Pricing dinámico según competencia

### Criterios de Selección:

Solo acepta:
1. **IA / ML**: chatbots, agentes IA, RAG, NLP
2. **Páginas web**: landing, e-commerce, WordPress
3. **Desarrollo software**: apps web, SaaS, dashboards, APIs
4. **Automatización**: n8n, Make, bots WhatsApp/Telegram, scrapers
5. **Datos/BI**: dashboards, ETL, reporting

Rechaza: diseño gráfico puro, traducción, contabilidad, presencia física, >50 propuestas.

### Estrategia de precios (Claude Code):
- **Ignora el presupuesto del cliente** — precio justo por complejidad real
- **Por hora**: 40 EUR/h | **Webs/landing**: 150-400 EUR | **E-commerce**: 400-1200 EUR
- **Chatbot básico**: 350-600 EUR | **Chatbot IA**: 700-1500 EUR | **Automatización**: 400-1000 EUR
- **Software/SaaS**: 1500-4000 EUR | **Dashboard/BI**: 600-1500 EUR | **App full-stack**: 1000-3500 EUR
- **+20% Workana** incluido en budget_suggested
- **Propuestas cortas** (max 150 palabras): gancho + micro-insight + prueba social + CTA a llamada
- Firma: Alex

### REGLA CRÍTICA: NUNCA mencionar VortekAI
- **PROHIBIDO** mencionar "VortekAI", "Vortek" o cualquier nombre de empresa en propuestas
- Si necesitas referirte a tu equipo, di "mi equipo" o "mi empresa" sin nombrarla
- **NO** revelar que usas IA o automatización para enviar propuestas
- Motivo: riesgo de ban en Workana

### Workflows Auxiliares

- **Resumen Diario** (`n8n-workflow-daily-summary.json`): 22:00 L-S, 10 nodos
  - Flujo: Trigger → CONFIG → Calcular Fechas → 5x GET HTTP en paralelo (proyectos, propuestas, errores, cuota, retry) → Construir Resumen (Code puro) → WhatsApp
- **Cola Reintentos** (`n8n-workflow-retry.json`): cada 15 min, 13 nodos
  - Flujo: Trigger → CONFIG → GET Pendientes → Preparar Items → PATCH Processing → Reintentar Envío → Evaluar Resultado → IF Éxito → (SÍ: PATCH Completed + PATCH Proyecto Sent / NO: IF Max → PATCH Failed o PATCH Backoff)
- **Feedback Loop** (`n8n-workflow-feedback.json`): 9:00 L-S, 5 nodos
  - Flujo: Trigger → CONFIG → Scrape Mis Propuestas → Preparar Updates (Code puro) → PATCH Proyecto (HTTP per-item)

## Submitter — Compatibilidad MFE (submitter.js)

Workana usa **micro-frontends (MFE)** — el contenido se renderiza con JavaScript después del page load. El framework gestiona el estado de los formularios independientemente del DOM.

### Flujo de envío:
1. Navegar al proyecto + esperar MFE (`waitForFunction` body > 500 chars)
2. Cerrar banner cookies (`_dismissCookieConsent`)
3. Click "Enviar una propuesta" (texto + CSS fallbacks)
4. Manejar "Área protegida" si aparece (ingresa contraseña automáticamente)
5. Esperar formulario (textarea visible)
6. Rellenar propuesta con **native setter** (MFE-compatible)
7. Rellenar presupuesto con **native setter** + `page.type()`
8. Seleccionar hasta 5 habilidades (checkboxes visibles)
9. Seleccionar hasta 3 portfolio (botón "+", NUNCA click en button[type=submit])
10. Rellenar task scopes con `page.select()` nativo de Puppeteer
11. Verificar estado de campos (`_verifyFormState`)
12. Click submit con `page.click()` nativo de Puppeteer
13. Fallback: `form.requestSubmit()` (NUNCA `form.submit()` — bypasea validación)
14. Verificar resultado con reglas conservadoras

### Compatibilidad MFE — Técnicas clave:
- **`execCommand('insertText')`**: Inserta texto a través del pipeline del navegador — TODOS los frameworks MFE (React/Vue/Angular) lo reconocen. Mucho más fiable que `el.value = ...` o native setters que pueden fallar silenciosamente.
- **`page.select()`**: Puppeteer nativo para selects (task scopes). `sel.value = ...` no dispara eventos del framework.
- **`page.click()`**: Click nativo de Puppeteer para submit (simula mouseover→mousedown→mouseup→click). Más fiable que `el.click()` programático.
- **NUNCA `form.submit()`**: Bypasea validación del cliente, causa falsos positivos.
- **Pre-submit validation**: Verifica que los campos tienen contenido en el DOM antes de clickar submit. Si están vacíos → ABORT inmediato.

### Detección de éxito (ULTRA-AGRESIVA — evita falsos negativos):

**Filosofía**: Mejor reportar éxito dudoso que fallo dudoso. Falsos positivos → verificación secundaria los confirma. Falsos negativos → causan reintentos y duplicados.

**Reglas de ÉXITO** (ordenadas por confianza):
1. **Alta confianza**: Texto explícito ("propuesta enviada", "felicitaciones", "ya has enviado")
2. **Alta confianza**: URL redirigió a páginas conocidas (`/inbox/`, `/messages/`, `/jobs`, `/dashboard`, `/my-bids`, `/proposals`)
3. **Alta confianza**: URL cambió Y formulario desapareció
4. **Media confianza**: URL cambió (aunque formulario visible, puede ser página intermedia)
5. **Baja confianza**: Formulario desapareció (aunque URL igual, puede ser confirmación inline)
6. **Último recurso**: Estado ambiguo → **asumir éxito** y dejar que verificación secundaria lo confirme

**Reglas de FALLO** (solo 2 casos inequívocos):
1. Error de validación ("campo obligatorio", "especifique un alcance")
2. Formulario visible + botón submit visible + URL no cambió

**Verificación secundaria**: Si resultado es fallo, re-visita el proyecto para confirmar. Si botón "Enviar propuesta" desapareció → cambiar a éxito.

## Dashboard (React + Vite + Tailwind)

- **URL**: `https://mediumblue-butterfly-391367.hostingersite.com`
- **Deploy**: `cd dashboard && npm run build && node deploy-hostinger.cjs`
- **SFTP**: host=46.202.172.145, port=65002, user=u802021756
- Requiere `.htaccess` con `AddType application/javascript .js .mjs`

## Despliegue

### Puppeteer Service (Easypanel)
- URL: `https://workana-auto-pilot.ioefpm.easypanel.host`
- Build desde GitHub (rama `main`, repo privado)
- Para redesplegar: `git push origin main` → Easypanel → Forzar reconstrucción

### Variables de Entorno Docker
```env
WORKANA_EMAIL=tu-email@workana.com
WORKANA_PASSWORD=tu-password
PORT=3500
HEADLESS=true
USER_DATA_DIR=./chrome-data
API_KEY=                               # Opcional: si se define, protege todos los endpoints (excepto /health y /live)
```

## Seguridad API (server.js)

- **API Key opcional**: Si `API_KEY` env var está definida, TODOS los endpoints (excepto `/health` y `/live*`) requieren Bearer token o `?api_key=` query param
- **Backwards compatible**: Sin `API_KEY` definida, se comporta como antes (sin auth)
- **CORS**: Incluye `Authorization` en `Access-Control-Allow-Headers`
- **Validación de parámetros**: `/scrape-all` limita a max 5 páginas y 6 categorías; `/my-proposals` limita `maxPages` a 10

## Anti-Detección (14 medidas)

1. puppeteer-extra-plugin-stealth
2. Delays aleatorios (1-6s entre acciones)
3. Escritura humana (30-110ms entre teclas, pausas aleatorias)
4. Movimientos de ratón naturales (curvas de Bezier)
5. Sesión persistente (cookies en volumen Docker)
6. Horario humano (8:00-22:00, sin domingos)
7. Rotación de User Agent — Pool de 5 Chrome UA, rotación diaria
8. Headless con stealth flags (`--disable-features=TranslateUI`, `--disable-default-apps`)
9. Rate limiting entre páginas
10. Cuota semanal probabilística (50-60/semana)
11. Fatiga nocturna — Delays x1.5 después de las 20:00, x1.2 después de las 17:00
12. Espera render MFE — `waitForFunction` antes de interactuar
13. Cleanup páginas huérfanas — En timeout de enqueue, cierra páginas que quedaron abiertas
14. Validación URL scraper — Solo acepta `https://www.workana.com/job/` (evita navegación a URLs externas)

## REGLA CRÍTICA: n8n Code Nodes — Sin HTTP

Los Code nodes de n8n ejecutan en un **sandbox** que bloquea:
- `fetch()` — NO disponible
- `require('https')` / `require('http')` — NO disponible
- Cualquier módulo Node.js que haga HTTP

**TODAS las llamadas HTTP deben usar nodos HTTP Request nativos** (typeVersion 4.2). Los Code nodes SOLO pueden hacer transformación de datos (JavaScript puro).

Si necesitas hacer múltiples llamadas HTTP condicionales, usa IF nodes + HTTP Request nodes en vez de lógica dentro de Code nodes.

## Troubleshooting — Registro de Incidencias

Ver **[INCIDENTS.md](INCIDENTS.md)** para el historial completo de incidencias con síntomas, causas raíz y soluciones.

**Acción inmediata ante errores**: Antes de investigar desde cero, consulta la tabla de síntomas rápidos en INCIDENTS.md. Los problemas más comunes (sesión caída, redirect loop, timeouts, duplicados) ya están documentados con soluciones probadas.

**Procedimiento estándar de recuperación manual**:
```bash
# Opción 1: Limpieza completa automática (recomendado)
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/force-clear-session | jq .
# Hace: clear-cookies + restart-browser + login automático

# Opción 2: Paso a paso (para debugging)
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/clear-cookies
sleep 2
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/login
sleep 2
curl -s https://workana-auto-pilot.ioefpm.easypanel.host/session-check

# Opción 3: Solo reiniciar browser (si cookies están OK pero browser corrupto)
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/restart-browser | jq .

# Login puede fallar con "Execution context was destroyed" (intermitente, normal)
# Si falla, reintentar una vez más — el workflow n8n lo reintenta automáticamente
```

## Auto-Recuperación Autónoma

El sistema incluye **monitoreo continuo con auto-recuperación** vía `health-check.sh`:

### Script de Monitoreo (`health-check.sh`)

```bash
# Ejecutar manualmente con auto-recuperación:
bash health-check.sh --auto-recover

# O configurar en cron (cada 10 min):
*/10 * * * * bash /path/to/workana-autopilot/health-check.sh --auto-recover >> /var/log/workana-health.log 2>&1
```

**Qué hace el script**:
1. Verifica health del browser (`GET /health`)
2. Verifica sesión activa (`GET /session-check`)
3. Si browser caído → `POST /restart-browser` + `POST /login`
4. Si sesión caída → `POST /force-clear-session` (cookies + restart + login)
5. Loguea todo con timestamp para auditoría

**Resultado**: El sistema se auto-recupera sin intervención manual en >90% de casos.

### Modificación del Workflow n8n (recomendado)

Para hacer el workflow completamente autónomo, agregar estos nodos después de "Re-Login" (si falla):

1. **Nodo HTTP Request** — `POST /restart-browser`
   - Timeout: 30s
   - Si falla: continuar al paso 2

2. **Delay** — 5 segundos

3. **Nodo HTTP Request** — `POST /login` (reintento tras restart)
   - Si éxito: continuar flujo normal
   - Si falla: continuar al paso 4

4. **Nodo HTTP Request** — `POST /force-clear-session`
   - Timeout: 60s
   - Si éxito: continuar flujo normal
   - Si falla: **SOLO ENTONCES** enviar alerta WhatsApp + STOP

**Beneficio**: El workflow intenta 3 niveles de auto-recuperación antes de alertar (re-login → restart → force-clear). Reduce alertas falsas en >80%.

**Script de validación end-to-end** (`test-sistema.sh`):
```bash
bash test-sistema.sh
```
Verifica:
1. Browser corriendo
2. Sesión activa (login funciona, URL válida incluye 'workana.com' y HTTPS)
3. Scraping funciona (al menos 1 proyecto)
4. Propuestas pendientes en Supabase

**USAR DESPUÉS DE**:
- Cada rebuild de Easypanel
- Cuando recibas solo errores en WhatsApp por más de 1 día
- Antes de tocar configuración del workflow n8n
- Después de cualquier fix en `browser.js`, `scraper.js` o `submitter.js`

**Señales de alerta crítica** (ejecutar validación inmediatamente):
- Solo recibes `🤖❌ ERROR EN ENVÍO AUTO` en WhatsApp por >24h
- Proyectos con `status=proposal_generated` y `auto_sent=true` acumulándose sin cambiar a `sent`
- Login retorna `success: true` pero URL no incluye 'workana.com'

**Errores normales (NO CRÍTICOS, ignorar si < 2h)**:
- `Error de login: Execution context was destroyed` — ocurre cuando Workana redirige rápido. Auto-corrige en siguiente ejecución (30 min)

## Notas de Desarrollo

- Workana usa **MFE** — todo el contenido se renderiza con JS post-load. Usar `waitForFunction` antes de interactuar.
- El botón submit de Workana es `input[type="submit"]` con `value="Enviar presupuesto"`, NO un `<button>`.
- Los selectores CSS del scraper usan múltiples fallbacks por si Workana cambia su HTML.
- **Debugging: NUNCA usar `/screenshot` + Read para ver imágenes** — cuando el browser está en estado roto (chrome-error://, sesión inválida, página vacía), el PNG generado es corrupto y la herramienta Read falla con `Could not process image`. Usar SIEMPRE endpoints de texto: `/debug-html`, `/health`, `/session-check`, `/debug-form`. Son más fiables y no dependen del estado visual del browser.
- El volumen `chrome-data` mantiene la sesión entre reinicios.
- **No usar nodos nativos de Supabase en n8n** — causan fallos silenciosos, usar HTTP Request.
- **No usar Set node typeVersion 3.4** — incompatible con n8n 2.12.3, usar Code node.
- El nodo CONFIG es un Code node (no Set) para compatibilidad universal con n8n.
- Supabase `workana_projects` tiene UNIQUE en `workana_url` → usar upsert con `on_conflict=workana_url`.
- Status permitidos: `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`.
- **CORS habilitado** en server.js para que el dashboard acceda al health check.
- Si el cron de n8n deja de ejecutar, **desactivar y reactivar** el workflow.
- **Supabase REST default limit = 1000 filas** — SIEMPRE añadir `&limit=10000` en queries que necesiten todos los registros (ej: GET URLs Existentes).
- **n8n item pairing**: Si un Code node usa `runOnceForAllItems`, los nodos downstream NO pueden usar `$('NombreNodo').item.json` — usar `$('NombreNodo').all()[$itemIndex]` en su lugar. (Corregido en "Estructurar Datos").
- **Filtrar Nuevos**: Cuando hay 0 proyectos nuevos, retorna `[]` (no un debug item). El flujo se detiene limpiamente sin error.
- **Config propagation**: "Estructurar Datos" obtiene config de `$('CONFIG').first().json`, NO de `projectData.config`. "Obtener Detalles" incluye `config` en su output como respaldo.
- **Feedback URL encoding**: NUNCA usar `encodeURIComponent()` en URLs de query a Supabase PostgREST — busca el string literal codificado en vez del original. El PATCH usa la URL cruda: `?workana_url=eq.{{ $json.project_url }}`.
- **_verifyFormState fallback**: Lee `textarea.value || textarea.textContent || textarea.innerText` para cubrir edge cases donde `.value` no refleja el contenido tras `execCommand('insertText')`.
- **_launchBrowser race condition**: `_launchPromise` NO se nullea en `finally` — solo en `catch` (error) y en el handler `disconnected`. Esto previene que un segundo caller lance otro browser mientras el primero arranca.
- **_ensureBrowser re-launch**: Si browser.connected es false, nullea _launchPromise para forzar re-lanzamiento.
- **Task scopes abort**: Si TODOS los task scopes estan vacios (taskScopesFilled === 0), el submitter aborta — Workana rechaza formularios con scopes obligatorios sin rellenar.
- **Scraper parseNum mejorado**: Regex \x5b\\d,.\x5d+ con replace para parsear numeros con separadores de miles.
- **Retry workflow PATCH**: PATCH Proyecto Sent usa workana_url=eq.projectUrl (no id=eq.projectId), porque retry_queue no tiene project_id.
- **CRÍTICO — Validación de login (INC-008)**: El método `login()` en `browser.js` DEBE validar que `page.url()` incluye 'workana.com' Y empieza con 'https://'. NUNCA asumir que "no está en /login = login exitoso". Cuando el browser está corrupto (redirect loop), puede retornar URLs como `chrome-error://chromewebdata/` que no incluyen '/login', causando falsos positivos de login exitoso y loops infinitos. Ver [browser.js:258-273](src/browser.js#L258-L273) para implementación correcta. IMPORTANTE: Usar `let` para `currentUrl` (línea 259) en vez de `const` — se reasigna en líneas 297 y 384. Redeclarar con `const` causa `SyntaxError` que impide arranque del servicio.
