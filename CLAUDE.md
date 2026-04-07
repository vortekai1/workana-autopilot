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
├── CLAUDE.md                          # Este archivo
├── SETUP.md                           # Guía de instalación detallada
├── package.json                       # Dependencias Node.js
├── Dockerfile                         # Imagen Docker con Chromium
├── docker-compose.yml                 # Orquestación Docker
├── .env.example                       # Variables de entorno requeridas
├── sql-pro-upgrade.sql                # SQL PRO: columnas + 3 vistas analíticas
├── n8n-workflow.json                  # Workflow principal v5-PRO (30 nodos)
├── n8n-workflow-daily-summary.json    # Workflow: resumen diario WhatsApp (22:00)
├── n8n-workflow-retry.json            # Workflow: cola de reintentos (cada 15 min)
├── n8n-workflow-feedback.json         # Workflow: feedback loop propuestas (9:00)
├── src/
│   ├── server.js             # API Express (10 endpoints, puerto 3500, CORS habilitado)
│   ├── browser.js            # BrowserManager: Puppeteer + stealth + UA rotation + fatiga
│   ├── scraper.js            # WorkanaScraper: scraping + detalles enriquecidos + feedback multi-página
│   └── submitter.js          # ProposalSubmitter: envío con espera MFE + reintento automático
└── dashboard/
    ├── src/
    │   ├── App.jsx                    # Layout principal con 3 filas de charts + alertas
    │   ├── hooks/useStats.js          # Hooks: useStats, useWinRateTrend, useABResults, useAlerts
    │   └── components/
    │       ├── KPICards.jsx           # 8 KPIs: propuestas, enviadas, pendientes, score, win rate, resp. media...
    │       ├── ProposalChart.jsx      # Chart propuestas por día (7 días)
    │       ├── CategoryChart.jsx      # Chart proyectos por categoría
    │       ├── RecentProjects.jsx     # Tabla últimos proyectos
    │       ├── AlertsBanner.jsx       # Alertas automáticas (0 propuestas, retry queue, win rate bajo)
    │       ├── WinRateChart.jsx       # Evolución win rate semanal (90 días)
    │       └── ABTestResults.jsx      # Comparativa Variante A vs B
    ├── deploy-hostinger.cjs           # Script SFTP deploy a Hostinger
    └── dist/                          # Build producción (desplegado en Hostinger)
```

## API Endpoints (puerto 3500)

| Método | Ruta               | Descripción                          |
|--------|---------------------|--------------------------------------|
| GET    | `/health`           | Health check + uptime + RAM + timestamp |
| POST   | `/login`            | Login manual en Workana              |
| GET    | `/scrape-projects`  | Scrape una página de búsqueda        |
| POST   | `/scrape-all`       | Scrape múltiples páginas/categorías  |
| GET    | `/project-details`  | Detalles completos + client_projects_posted + client_hire_rate |
| POST   | `/submit-proposal`  | Enviar propuesta (espera MFE + reintento) |
| GET    | `/session-check`    | Verificar sesión activa              |
| GET    | `/screenshot`       | Screenshot para debugging            |
| GET    | `/debug-html`       | HTML de página (hasta 100KB)         |
| GET    | `/my-proposals`     | Scrape propuestas enviadas (multi-página, param `maxPages`) |

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
  - `project_url`, `proposal_text`, `budget_suggested`, `delivery_days`
  - `attempt_count` / `max_attempts` (3) con backoff exponencial
  - `status`: `pending`, `processing`, `completed`, `failed`
  - Índice en `next_retry_at` WHERE `status = 'pending'`

- **workana_config** — Configuración del sistema
- **workana_logs** — Registro de todas las acciones

### Vistas

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
- `MAX_PROPOSALS_WEEK_MIN` — `50` (mínimo propuestas/semana)
- `MAX_PROPOSALS_WEEK_MAX` — `60` (máximo propuestas/semana)
- `MAX_PROPOSALS_ON_PROJECT` — `50`
- `AUTO_MODE` — `true` (autopiloto activado)

### Sistema de Cuota Semanal (anti-ban)

El nodo **"Control Cuota y Horario"** controla la ejecución con 4 capas:

1. **Horario laboral**: L-S, 8:00-22:00 Madrid. Domingos = no ejecuta.
2. **Cuota semanal**: Consulta `workana_proposals` en Supabase para contar propuestas desde el lunes. Genera un objetivo semanal aleatorio (50-60) determinista por número de semana (mismo objetivo toda la semana).
3. **Bypass proyectos frescos**: Antes del dado, consulta Supabase para proyectos < 2h con < 10 propuestas. Si hay frescos y queda cuota → ejecuta sin importar el dado.
4. **Skip probabilístico**: Calcula `probabilidad = propuestas_restantes / ejecuciones_restantes`. Lanza un dado. Si no toca, devuelve `[]` y el workflow para.

**Efecto**: ~8-10 propuestas/día distribuidas aleatoriamente. Auto-compensación: si va retrasado, aumenta probabilidad; si va adelantado, la baja. Proyectos frescos con poca competencia nunca se pierden.

### Flujo del workflow principal:

```
Cada 30 min → CONFIG → Control Cuota y Horario
→ Verificar Sesión → ¿Sesión OK?
  ├─ SÍ → Scrape Workana
  └─ NO → Re-Login → ¿Login OK?
           ├─ SÍ → Scrape Workana
           └─ NO → Alerta WhatsApp + STOP
→ Scrape Workana → Parsear Proyectos → Filtrar Nuevos (batch Supabase)
→ Obtener Detalles → Combinar Datos (+ parseBudget) → Calcular Pre-Score (base 30)
→ Preparar Prompt IA (+ patrones ganadores + perfil cliente + A/B testing)
→ IA Genera Propuesta (OpenAI gpt-4o) → Estructurar Datos (+ variant + tone)
→ Guardar Proyecto (upsert con campos PRO) → ¿Aplica?
  ├─ SÍ → Preparar Propuesta → Guardar Propuesta (+ variant/tone/word_count) → Auto Mode?
  │        ├─ AUTO + relevancia≥80 → Enviar Automático → Resultado Auto
  │        │   ├─ OK → Actualizar Estado → WhatsApp → Log
  │        │   └─ FALLO → INSERT en retry_queue → WhatsApp → Log
  │        └─ MANUAL → Ruta Manual → WhatsApp → Log
  └─ NO → (fin, proyecto guardado como 'skipped')
```

### Mejoras PRO del workflow (v5):

#### Combinar Datos — parseBudget()
Parsea texto de presupuesto a campos numéricos:
- `budget_min` / `budget_max` — rango numérico
- `budget_currency` — EUR/USD
- `budget_type` — fixed/hourly/open
- Pasa `client_projects_posted` y `client_hire_rate` del scraper enriquecido

#### Calcular Pre-Score — Recalibrado (base 30)
- **Base**: 30 (antes 50, permite mayor diferenciación)
- **Frescura**: hasta +25pts (1h, 3h, 6h, 12h)
- **Competencia baja**: hasta +20pts (3, 7, 15, 25 propuestas)
- **Cliente verificado**: +8pts
- **Rating**: hasta +8pts (3 niveles: 4.0, 4.5, 4.8)
- **Hire rate del cliente**: hasta +7pts (nuevo)
- **Penalizaciones**: -10 si >35 propuestas, -20 si >45
- Clamp: `Math.max(0, Math.min(100, score))`

#### Preparar Prompt IA — Inteligencia adaptativa
- **Patrones ganadores**: Consulta `workana_winning_patterns` para incluir datos de propuestas ganadoras
- **Conversion stats v2**: Consulta `workana_conversion_stats_v2` con win rate
- **Perfil de cliente**: 4 niveles (premium/experimentado/intermedio/nuevo) basado en rating, verified, projects_posted, hire_rate
- **A/B Testing**: Variante A (gancho técnico-directo) o B (gancho empático-consultivo), asignación determinística por hash del URL
- **Pricing dinámico**: Ajuste de competitividad según nivel de competencia del proyecto

#### Estructurar Datos — Campos A/B
- `proposal_variant`: variante A/B asignada
- `word_count`: conteo de palabras
- `tone`: tono dominante (direct/warm/technical/urgent)

### Nodos del workflow principal (~30 nodos):
- **5 nodos HTTP Request Supabase** — REST directo (sin credencial n8n)
- **1 nodo HTTP Request OpenAI** — credencial openAiApi, gpt-4o, JSON mode
- **4 nodos HTTP Request Puppeteer** — session-check, scrape, detalles, submit
- **2 nodos HTTP Request Evolution** — WhatsApp (propuesta + alerta sesión)
- **11 nodos Code** — lógica de negocio (Cuota, Pre-Score, Templates, A/B, etc.)
- **4 nodos IF** — ¿Sesión OK? + ¿Login OK? + ¿Aplica? + Auto Mode?
- **1 nodo Schedule Trigger** — cada 30 min
- **1 nodo Sticky Note** — info del workflow

### Criterios de Selección (focalizado):

Solo acepta proyectos en estas categorías:
1. **IA / Machine Learning**: chatbots, agentes IA, RAG, NLP, integración APIs de IA
2. **Páginas web**: landing pages, corporativas, e-commerce, WordPress, tiendas online
3. **Desarrollo de software**: apps web, SaaS, dashboards, CRM, ERP, APIs, backends
4. **Automatización y bots**: n8n, Make, bots WhatsApp/Telegram, scrapers
5. **Datos y análisis**: dashboards, BI, ETL, bases de datos, reporting

Rechaza: diseño gráfico puro, traducción, contabilidad, presencia física, >50 propuestas.

### Estrategia de precios (precio justo con Claude Code):
- **Ignora el presupuesto del cliente** — la IA pone precio justo basado en complejidad real
- **Claude Code**: usamos IA para desarrollo rápido, lo que permite precios competitivos
- **Por hora**: siempre 40 EUR/h
- **Webs/landing**: 150-400 EUR (muy rápidas con Claude Code)
- **E-commerce**: 400-1200 EUR
- **Chatbot básico**: 350-600 EUR
- **Chatbot IA**: 700-1500 EUR
- **Automatización**: 400-1000 EUR
- **Agente IA complejo**: 1200-2500 EUR
- **Software/SaaS**: 1500-4000 EUR
- **Web scraping**: 300-800 EUR
- **Dashboard/BI**: 600-1500 EUR
- **Integración APIs**: 300-900 EUR
- **App web full-stack**: 1000-3500 EUR
- **+20% Workana** siempre incluido en budget_suggested
- **Propuestas cortas** (max 150 palabras): gancho + micro-insight + prueba social + CTA a llamada
- Firma: Alex

### Session Health Check

5 nodos verifican la sesión antes de cada scrape:
1. GET `/session-check` al Puppeteer
2. Si OK → continúa al scrape
3. Si NO → POST `/login` (re-login automático)
4. Si re-login OK → continúa al scrape
5. Si re-login falla → alerta WhatsApp + workflow PARA

### Workflow: Resumen Diario (n8n-workflow-daily-summary.json)

Ejecuta a las 22:00 L-S. Envía por WhatsApp:
- Proyectos analizados del día
- Propuestas generadas y enviadas
- Errores del día
- Cuota semanal actual vs objetivo
- Items pendientes en retry queue

### Workflow: Cola de Reintentos (n8n-workflow-retry.json)

Ejecuta cada 15 min. Reintenta envíos fallidos:
1. Obtiene items `pending` de `workana_retry_queue` (máx 3)
2. POST `/submit-proposal` al Puppeteer
3. Si éxito → marca `completed` + PATCH proyecto a `sent`
4. Si fallo → incrementa `attempt_count`, backoff exponencial (15min, 60min, 240min)
5. Si max_attempts (3) alcanzado → marca `failed`

### Workflow: Feedback Loop (n8n-workflow-feedback.json)

Ejecuta a las 9:00 L-S. Aprende de resultados:
1. GET `/my-proposals?maxPages=3` al Puppeteer (scrape multi-página)
2. Clasifica outcomes: `won`, `lost`, `no_response`, `in_progress`
3. PATCH `workana_projects` con `client_responded` y `outcome`
4. Las stats de conversión se inyectan en el prompt de IA del workflow principal

## Modos de Operación

### Modo Autopiloto (`AUTO_MODE = true`) — ACTIVO
1. Scrape + IA genera propuesta con relevancia y A/B testing
2. Si relevancia >= 80: envía automáticamente vía Puppeteer
3. Notifica por WhatsApp confirmando envío (o error)
4. Si relevancia < 80: notifica sin enviar
5. Fallos van a retry_queue para reintento automático

### Modo Manual (`AUTO_MODE = false`)
1. Scrape + IA genera propuesta → Guarda en DB
2. Notifica por WhatsApp con propuesta completa + link
3. Usuario revisa, entra a Workana y envía manualmente (~1-2 min/propuesta)

## Dashboard (React + Vite + Tailwind)

URL: `https://mediumblue-butterfly-391367.hostingersite.com`

### Componentes:
- **KPICards**: 8 tarjetas — propuestas hoy, enviadas, pendientes, score medio, tasa envío, tasa skipped, win rate, resp. media
- **ProposalChart**: Propuestas generadas por día (últimos 7 días)
- **CategoryChart**: Distribución de proyectos por categoría
- **RecentProjects**: Tabla de últimos proyectos con status
- **AlertsBanner**: Alertas automáticas (0 propuestas, retry queue, win rate bajo)
- **WinRateChart**: Evolución del win rate semanal (90 días)
- **ABTestResults**: Comparativa Variante A (Técnica-Directa) vs B (Empática-Consultiva)

### Deploy:
```bash
cd dashboard && npm run build && node deploy-hostinger.cjs
```
SFTP a `mediumblue-butterfly-391367.hostingersite.com` en Hostinger.

## Variables de Entorno del Contenedor Docker

```env
WORKANA_EMAIL=tu-email@workana.com
WORKANA_PASSWORD=tu-password
PORT=3500
HEADLESS=true
USER_DATA_DIR=./chrome-data
```

## Despliegue

### Puppeteer Service (Easypanel)
- URL: `https://workana-auto-pilot.ioefpm.easypanel.host`
- Build desde GitHub (rama `main`, repo privado)
- Para redesplegar: push a main → Easypanel → Forzar reconstrucción

### Dashboard (Hostinger)
- URL: `https://mediumblue-butterfly-391367.hostingersite.com`
- SFTP: host=46.202.172.145, port=65002, user=u802021756
- Path: `/home/u802021756/domains/mediumblue-butterfly-391367.hostingersite.com/public_html`
- Requiere `.htaccess` con `AddType application/javascript .js .mjs` (Apache MIME para ES modules)

## Anti-Detección (12 medidas)

1. puppeteer-extra-plugin-stealth
2. Delays aleatorios (1-6s entre acciones)
3. Escritura humana (30-110ms entre teclas, pausas aleatorias)
4. Movimientos de ratón naturales (curvas de Bezier)
5. Sesión persistente (cookies guardadas en volumen Docker)
6. Horario humano (8:00-22:00, sin domingos)
7. **Rotación de User Agent** — Pool de 5 Chrome UA, rotación diaria por `getDate() % 5`
8. Headless con stealth flags
9. Rate limiting entre páginas
10. **Cuota semanal probabilística** (50-60/semana, horarios aleatorios)
11. **Fatiga nocturna** — Delays multiplicados x1.5 después de las 20:00, x1.2 después de las 17:00
12. **Espera render MFE** — `waitForFunction` para que el JS de Workana renderice antes de interactuar

## Submitter — Robustez (submitter.js)

El ProposalSubmitter tiene varias capas de protección:
1. **Espera MFE**: `waitForFunction(() => document.body.innerText.length > 500)` — espera a que Workana renderice su SPA
2. **Reintento de botón**: Si no encuentra "Enviar propuesta" al primer intento, espera 5s y reintenta
3. **Múltiples selectores**: CSS (`a[href*="/bid/"]`, `.btn-primary`, etc.) + texto (`Enviar una propuesta`, `Send a proposal`, etc.)
4. **Verificación de resultado**: Comprueba URL final + texto de éxito/error en la página

## Notas de Desarrollo

- Los selectores CSS del scraper usan múltiples fallbacks por si Workana cambia su HTML
- Workana usa **micro-frontends (MFE)** — el contenido se renderiza con JavaScript después del page load, por eso el submitter necesita `waitForFunction`
- Usar `/screenshot` o `/debug-html` para debugging cuando algo falla
- El volumen `chrome-data` mantiene la sesión de Workana entre reinicios
- **No usar nodos nativos de Supabase en n8n** — causan fallos silenciosos, usar HTTP Request
- **No usar Set node typeVersion 3.4** — incompatible con n8n 2.12.3, usar Code node
- El nodo CONFIG es un Code node (no Set) para compatibilidad universal con cualquier versión de n8n
- Supabase `workana_projects` tiene UNIQUE en `workana_url` → usar upsert con `on_conflict=workana_url`
- Status permitidos en DB: `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`
- Proyectos rechazados por IA se guardan como `skipped` para no reprocesarlos
- El endpoint `/my-proposals` soporta param `maxPages` (default 3) para scraping multi-página
- **CORS habilitado** en server.js (`Access-Control-Allow-Origin: *`) para que el dashboard acceda al health check
- Si el cron de n8n deja de ejecutar tras editar el workflow, **desactivar y reactivar** el workflow resuelve el problema
- `toLocaleString` con timezone en Docker puede no funcionar en imágenes Alpine sin ICU — verificar que la hora Madrid es correcta en los logs
