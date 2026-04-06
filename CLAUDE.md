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
- **IA**: OpenAI GPT-4o para generación de propuestas y scoring
- **Notificaciones**: Evolution API (WhatsApp)
- **Despliegue**: Docker en Easypanel

## Estructura del Proyecto

```
workana-autopilot/
├── CLAUDE.md                          # Este archivo
├── SETUP.md                           # Guía de instalación detallada
├── package.json                       # Dependencias Node.js
├── Dockerfile                         # Imagen Docker con Chromium
├── docker-compose.yml                 # Orquestación Docker
├── .env.example                       # Variables de entorno requeridas
├── n8n-workflow.json                  # Workflow principal v4 (30 nodos)
├── n8n-workflow-daily-summary.json    # Workflow: resumen diario WhatsApp (22:00)
├── n8n-workflow-retry.json            # Workflow: cola de reintentos (cada 15 min)
├── n8n-workflow-feedback.json         # Workflow: feedback loop propuestas (9:00)
└── src/
    ├── server.js             # API Express (10 endpoints, puerto 3500)
    ├── browser.js            # BrowserManager: Puppeteer + stealth + login
    ├── scraper.js            # WorkanaScraper: scraping búsquedas, detalles y propuestas
    └── submitter.js          # ProposalSubmitter: envío automático de propuestas
```

## API Endpoints (puerto 3500)

| Método | Ruta               | Descripción                          |
|--------|---------------------|--------------------------------------|
| GET    | `/health`           | Health check del servicio            |
| POST   | `/login`            | Login manual en Workana              |
| GET    | `/scrape-projects`  | Scrape una página de búsqueda        |
| POST   | `/scrape-all`       | Scrape múltiples páginas/categorías  |
| GET    | `/project-details`  | Detalles completos de un proyecto    |
| POST   | `/submit-proposal`  | Enviar una propuesta                 |
| GET    | `/session-check`    | Verificar sesión activa              |
| GET    | `/screenshot`       | Screenshot para debugging            |
| GET    | `/debug-html`       | HTML de página para debugging        |
| GET    | `/my-proposals`     | Scrape propuestas enviadas (feedback) |

## Base de Datos (Supabase crm-vortek)

5 tablas + 1 vista en schema `public`:

- **workana_projects** — Proyectos scrapeados + relevance_score (0-100) + status
  - UNIQUE constraint en `workana_url`
  - CHECK constraint en `status`: valores permitidos = `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`
  - Upsert vía `?on_conflict=workana_url` + header `Prefer: resolution=merge-duplicates`
  - `pre_score` (INTEGER) — Score pre-IA calculado (0-100)
  - `client_responded` (BOOLEAN) — Si el cliente respondió a la propuesta
  - `outcome` (TEXT) — Resultado: `won`, `lost`, `no_response`, `in_progress`
- **workana_proposals** — Propuestas generadas por IA (texto, presupuesto, plazo, skills)
  - Campo `created_at` usado para contar propuestas semanales (cuota)
- **workana_retry_queue** — Cola de reintentos para envíos fallidos
  - `project_url`, `proposal_text`, `budget_suggested`, `delivery_days`
  - `attempt_count` / `max_attempts` (3) con backoff exponencial
  - `status`: `pending`, `processing`, `completed`, `failed`
  - Índice en `next_retry_at` WHERE `status = 'pending'`
- **workana_config** — Configuración del sistema (auto_mode, horarios, límites)
- **workana_logs** — Registro de todas las acciones

Vistas:
- **workana_conversion_stats** — Tasas de conversión por categoría (total_sent, won, responded, response_rate_pct)

RPCs: `get_new_workana_projects()`, `get_workana_daily_stats()`

## n8n Workflows (4 en total)

### Workflow Principal (n8n-workflow.json) — v4

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
- `AUTO_MODE` — `false` (manual) / `true` (autopiloto)

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
→ Obtener Detalles → Combinar Datos → Calcular Pre-Score
→ Preparar Prompt IA (con templates por categoría + stats conversión)
→ IA Genera Propuesta (OpenAI gpt-4o) → Estructurar Datos
→ Guardar Proyecto (upsert) → ¿Aplica?
  ├─ SÍ → Preparar Propuesta → Guardar Propuesta → Auto Mode?
  │        ├─ AUTO + relevancia≥80 → Enviar Automático → Resultado Auto
  │        │   ├─ OK → Actualizar Estado → WhatsApp → Log
  │        │   └─ FALLO → INSERT en retry_queue → WhatsApp → Log
  │        └─ MANUAL → Ruta Manual → WhatsApp → Log
  └─ NO → (fin, proyecto guardado como 'skipped')
```

### Nodos del workflow principal (~30 nodos):
- **5 nodos HTTP Request Supabase** — REST directo (sin credencial n8n)
- **1 nodo HTTP Request OpenAI** — credencial openAiApi, gpt-4o, JSON mode
- **4 nodos HTTP Request Puppeteer** — session-check, scrape, detalles, submit
- **2 nodos HTTP Request Evolution** — WhatsApp (propuesta + alerta sesión)
- **11 nodos Code** — lógica de negocio (Cuota, Pre-Score, Templates, etc.)
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

### Project Scoring (Pre-Score 0-100)

Nodo **"Calcular Pre-Score"** evalúa cada proyecto antes de la IA:
- **Frescura**: < 2h = +20pts, < 6h = +10pts
- **Competencia**: < 5 propuestas = +15pts, < 10 = +10pts
- **Cliente verificado**: +10pts
- **Rating cliente >= 4.5**: +5pts
- **Presupuesto definido**: +5pts

El score se inyecta en el prompt de IA para ayudar en la decisión.

### Templates por Categoría

El nodo "Preparar Prompt IA" detecta la categoría del proyecto y añade énfasis específico:
- **IA**: ROI, casos de uso concretos, vocabulario técnico IA
- **Web**: velocidad de entrega, SEO, conversión
- **Automatización**: ahorro de horas, escalabilidad, fiabilidad
- **Software**: arquitectura, testing, mantenibilidad
- **Datos/BI**: visualización accionable, real-time, insights predictivos

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
1. GET `/my-proposals` al Puppeteer (scrape de propuestas enviadas)
2. Clasifica outcomes: `won`, `lost`, `no_response`, `in_progress`
3. PATCH `workana_projects` con `client_responded` y `outcome`
4. Las stats de conversión se inyectan en el prompt de IA del workflow principal

## Modos de Operación

### Modo Manual (`AUTO_MODE = false`)
1. Scrape + IA genera propuesta → Guarda en DB
2. Notifica por WhatsApp con propuesta completa + link
3. Usuario revisa, entra a Workana y envía manualmente (~1-2 min/propuesta)

### Modo Autopiloto (`AUTO_MODE = true`)
1. Scrape + IA genera propuesta con relevancia
2. Si relevancia >= 80: envía automáticamente vía Puppeteer
3. Notifica por WhatsApp confirmando envío
4. Si relevancia < 80: notifica sin enviar (igual que modo manual)

## Variables de Entorno del Contenedor Docker

```env
WORKANA_EMAIL=tu-email@workana.com
WORKANA_PASSWORD=tu-password
PORT=3500
HEADLESS=true
USER_DATA_DIR=./chrome-data
```

## Despliegue

Servicio en **Easypanel** con build desde GitHub (rama `main`, repo privado).
- URL: `https://workana-auto-pilot.ioefpm.easypanel.host`
- Para redesplegar: push a main → Easypanel → Forzar reconstrucción
- El repo es **privado** (contiene credenciales en n8n-workflow.json). No afecta a Easypanel.

## Anti-Detección (10 medidas)

1. puppeteer-extra-plugin-stealth
2. Delays aleatorios (1-6s entre acciones)
3. Escritura humana (30-110ms entre teclas, pausas aleatorias)
4. Movimientos de ratón naturales (curvas de Bezier)
5. Sesión persistente (cookies guardadas en volumen Docker)
6. Horario humano (8:00-22:00, sin domingos)
7. User Agent real (Chrome 125 Windows)
8. Headless con stealth flags
9. Rate limiting entre páginas
10. **Cuota semanal probabilística** (50-60/semana, horarios aleatorios)

## Notas de Desarrollo

- Los selectores CSS del scraper usan múltiples fallbacks por si Workana cambia su HTML
- Usar `/screenshot` o `/debug-html` para debugging cuando algo falla
- La primera ejecución puede requerir ajustar selectores en `scraper.js` y `submitter.js`
- El volumen `chrome-data` mantiene la sesión de Workana entre reinicios
- **No usar nodos nativos de Supabase en n8n** — causan fallos silenciosos, usar HTTP Request
- **No usar Set node typeVersion 3.4** — incompatible con n8n 2.12.3, usar Code node
- El nodo CONFIG es un Code node (no Set) para compatibilidad universal con cualquier versión de n8n
- Supabase `workana_projects` tiene UNIQUE en `workana_url` → usar upsert con `on_conflict=workana_url`
- Status permitidos en DB: `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost` (no existe `rejected` ni `error_ia`)
- Proyectos rechazados por IA se guardan como `skipped` para no reprocesarlos
- El endpoint `/my-proposals` del Puppeteer scrappea la página de propuestas del usuario en Workana — los selectores CSS deben verificarse con `/debug-html` si dejan de funcionar

## SQL a ejecutar en Supabase (mejoras v4)

```sql
-- Pre-score
ALTER TABLE workana_projects ADD COLUMN IF NOT EXISTS pre_score INTEGER DEFAULT 0;

-- Feedback loop
ALTER TABLE workana_projects
  ADD COLUMN IF NOT EXISTS client_responded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS outcome TEXT CHECK (outcome IN ('won', 'lost', 'no_response', 'in_progress'));

-- Vista de conversión
CREATE OR REPLACE VIEW workana_conversion_stats AS
SELECT
  category,
  COUNT(*) FILTER (WHERE status IN ('sent', 'applied')) AS total_sent,
  COUNT(*) FILTER (WHERE outcome = 'won') AS won,
  COUNT(*) FILTER (WHERE client_responded = true) AS responded,
  ROUND(100.0 * COUNT(*) FILTER (WHERE client_responded = true) /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('sent', 'applied')), 0), 1) AS response_rate_pct
FROM workana_projects
WHERE status IN ('sent', 'applied', 'won', 'lost')
GROUP BY category;

-- Cola de reintentos
CREATE TABLE IF NOT EXISTS workana_retry_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES workana_projects(id),
  project_url TEXT NOT NULL,
  proposal_text TEXT NOT NULL,
  budget_suggested NUMERIC,
  delivery_days INTEGER,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retry_queue_next ON workana_retry_queue(next_retry_at) WHERE status = 'pending';
```
