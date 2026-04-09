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
├── n8n-workflow.json                  # Workflow principal v5-PRO (~30 nodos)
├── n8n-workflow-daily-summary.json    # Resumen diario WhatsApp (22:00)
├── n8n-workflow-retry.json            # Cola de reintentos (cada 15 min)
├── n8n-workflow-feedback.json         # Feedback loop propuestas (9:00)
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

| Método | Ruta               | Descripción                                                |
|--------|--------------------|------------------------------------------------------------|
| GET    | `/health`          | Health check + uptime + RAM + timestamp                    |
| POST   | `/login`           | Login manual en Workana                                    |
| GET    | `/scrape-projects` | Scrape una página de búsqueda                              |
| POST   | `/scrape-all`      | Scrape múltiples páginas/categorías                        |
| GET    | `/project-details` | Detalles completos + client_projects_posted + hire_rate    |
| POST   | `/submit-proposal` | Enviar propuesta (MFE-compatible + verificación estricta)  |
| GET    | `/debug-form`      | Analizar formulario de propuesta sin enviar (debug)        |
| GET    | `/session-check`   | Verificar sesión activa                                    |
| GET    | `/screenshot`      | Screenshot PNG para debugging                              |
| GET    | `/debug-html`      | HTML de página (hasta 100KB)                               |
| GET    | `/my-proposals`    | Scrape propuestas enviadas (multi-página, param `maxPages`)|

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
- `WHATSAPP_NUMBER` — `34628706539`
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
Cada 30 min → CONFIG → Control Cuota y Horario
→ Verificar Sesión → ¿OK? → (NO: Re-Login → ¿OK? → NO: Alerta WhatsApp + STOP)
→ Scrape → Parsear → Filtrar Nuevos (batch Supabase)
→ Obtener Detalles → Combinar Datos (+ parseBudget) → Calcular Pre-Score (base 30)
→ Preparar Prompt IA (+ patrones ganadores + perfil cliente + A/B testing)
→ IA Genera Propuesta (gpt-4o) → Estructurar Datos (+ variant + tone)
→ Guardar Proyecto (upsert) → ¿Aplica?
  ├─ SÍ → Guardar Propuesta → Auto Mode?
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

- **Resumen Diario** (`n8n-workflow-daily-summary.json`): 22:00 L-S, WhatsApp con resumen del día
- **Cola Reintentos** (`n8n-workflow-retry.json`): cada 15 min, reintenta envíos fallidos (máx 3 intentos, backoff exponencial)
- **Feedback Loop** (`n8n-workflow-feedback.json`): 9:00 L-S, scrape `/my-proposals?maxPages=3`, clasifica outcomes, actualiza DB

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

### Detección de éxito (ULTRA-CONSERVADORA — solo 3 vías):
- Texto explícito: "propuesta enviada", "felicitaciones", etc. → éxito
- "ya has enviado" → éxito
- URL contiene `/inbox/` → éxito
- **TODO lo demás → FALLO** (prefiere falso negativo a falso positivo)
- NO hay heurísticas de "URL cambió" o "formulario desapareció" — causaban falsos positivos masivos

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
```

## Anti-Detección (12 medidas)

1. puppeteer-extra-plugin-stealth
2. Delays aleatorios (1-6s entre acciones)
3. Escritura humana (30-110ms entre teclas, pausas aleatorias)
4. Movimientos de ratón naturales (curvas de Bezier)
5. Sesión persistente (cookies en volumen Docker)
6. Horario humano (8:00-22:00, sin domingos)
7. Rotación de User Agent — Pool de 5 Chrome UA, rotación diaria
8. Headless con stealth flags
9. Rate limiting entre páginas
10. Cuota semanal probabilística (50-60/semana)
11. Fatiga nocturna — Delays x1.5 después de las 20:00, x1.2 después de las 17:00
12. Espera render MFE — `waitForFunction` antes de interactuar

## Notas de Desarrollo

- Workana usa **MFE** — todo el contenido se renderiza con JS post-load. Usar `waitForFunction` antes de interactuar.
- El botón submit de Workana es `input[type="submit"]` con `value="Enviar presupuesto"`, NO un `<button>`.
- Los selectores CSS del scraper usan múltiples fallbacks por si Workana cambia su HTML.
- Usar `/screenshot`, `/debug-html` o `/debug-form` para debugging.
- El volumen `chrome-data` mantiene la sesión entre reinicios.
- **No usar nodos nativos de Supabase en n8n** — causan fallos silenciosos, usar HTTP Request.
- **No usar Set node typeVersion 3.4** — incompatible con n8n 2.12.3, usar Code node.
- El nodo CONFIG es un Code node (no Set) para compatibilidad universal con n8n.
- Supabase `workana_projects` tiene UNIQUE en `workana_url` → usar upsert con `on_conflict=workana_url`.
- Status permitidos: `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`.
- **CORS habilitado** en server.js para que el dashboard acceda al health check.
- Si el cron de n8n deja de ejecutar, **desactivar y reactivar** el workflow.
