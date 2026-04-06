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
├── CLAUDE.md                 # Este archivo
├── SETUP.md                  # Guía de instalación detallada
├── package.json              # Dependencias Node.js
├── Dockerfile                # Imagen Docker con Chromium
├── docker-compose.yml        # Orquestación Docker
├── .env.example              # Variables de entorno requeridas
├── n8n-workflow.json         # Workflow v3 (cuota semanal + selección focalizada)
└── src/
    ├── server.js             # API Express (9 endpoints, puerto 3500)
    ├── browser.js            # BrowserManager: Puppeteer + stealth + login
    ├── scraper.js            # WorkanaScraper: scraping de búsquedas y detalles
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

## Base de Datos (Supabase crm-vortek)

4 tablas en schema `public`:

- **workana_projects** — Proyectos scrapeados + relevance_score (0-100) + status
  - UNIQUE constraint en `workana_url`
  - CHECK constraint en `status`: valores permitidos = `new`, `proposal_generated`, `sent`, `skipped`, `applied`, `won`, `lost`
  - Upsert vía `?on_conflict=workana_url` + header `Prefer: resolution=merge-duplicates`
- **workana_proposals** — Propuestas generadas por IA (texto, presupuesto, plazo, skills)
  - Campo `created_at` usado para contar propuestas semanales (cuota)
- **workana_config** — Configuración del sistema (auto_mode, horarios, límites)
- **workana_logs** — Registro de todas las acciones

RPCs: `get_new_workana_projects()`, `get_workana_daily_stats()`

## n8n Workflow v3

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
- `SEARCH_CATEGORIES` — `it-programming`
- `SEARCH_PAGES` — `2`
- `MIN_RELEVANCE_AUTO` — `80`
- `MAX_PROPOSALS_WEEK_MIN` — `50` (mínimo propuestas/semana)
- `MAX_PROPOSALS_WEEK_MAX` — `60` (máximo propuestas/semana)
- `MAX_PROPOSALS_ON_PROJECT` — `50`
- `AUTO_MODE` — `false` (manual) / `true` (autopiloto)

### Sistema de Cuota Semanal (anti-ban)

El nodo **"Control Cuota y Horario"** controla la ejecución con 3 capas:

1. **Horario laboral**: L-S, 8:00-22:00 Madrid. Domingos = no ejecuta.
2. **Cuota semanal**: Consulta `workana_proposals` en Supabase para contar propuestas desde el lunes. Genera un objetivo semanal aleatorio (50-60) determinista por número de semana (mismo objetivo toda la semana).
3. **Skip probabilístico**: Calcula `probabilidad = propuestas_restantes / ejecuciones_restantes`. Lanza un dado. Si no toca, devuelve `[]` y el workflow para.

**Efecto**: ~8-10 propuestas/día distribuidas aleatoriamente. Auto-compensación: si va retrasado, aumenta probabilidad; si va adelantado, la baja.

### Flujo del workflow:

```
Cada 30 min → CONFIG → Control Cuota y Horario → Scrape Workana → Parsear Proyectos
→ Filtrar Nuevos (batch query Supabase) → Obtener Detalles → Combinar Datos
→ Preparar Prompt IA → IA Genera Propuesta (OpenAI gpt-4o)
→ Estructurar Datos → Guardar Proyecto (upsert) → ¿Aplica?
  ├─ SÍ → Preparar Propuesta → Guardar Propuesta → Auto Mode?
  │        ├─ AUTO + relevancia≥80 → Enviar Automático → Resultado Auto → Actualizar Estado → Formatear WhatsApp → Enviar WhatsApp → Log
  │        └─ MANUAL → Ruta Manual → Formatear WhatsApp → Enviar WhatsApp → Log
  └─ NO → (fin, proyecto guardado como 'skipped')
```

### Nodos del workflow:
- **4 nodos HTTP Request Supabase** — REST directo (sin credencial n8n)
- **1 nodo HTTP Request OpenAI** — credencial openAiApi, gpt-4o, JSON mode
- **3 nodos HTTP Request Puppeteer** — scrape, detalles, submit
- **1 nodo HTTP Request Evolution** — credencial httpHeaderAuth, WhatsApp
- **10 nodos Code** — lógica de negocio (incluyendo Control Cuota y Horario)
- **2 nodos IF** — ¿Aplica? + Auto Mode?
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
- Status permitidos en DB: `new`, `proposal_generated`, `sent`, `skipped` (no existe `rejected` ni `error_ia`)
- Proyectos rechazados por IA se guardan como `skipped` para no reprocesarlos
