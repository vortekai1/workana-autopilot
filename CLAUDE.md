# Workana Autopilot

Sistema de automatización para enviar propuestas en Workana. Scrappea proyectos, genera propuestas con IA y las envía automáticamente o las notifica por WhatsApp.

## Arquitectura

```
n8n (cron 30min) → Puppeteer Service (:3500) → Workana.com
                 → OpenAI (gpt-4o) genera propuestas
                 → Supabase (crm-vortek) persiste datos
                 → Evolution API → WhatsApp notificaciones
```

## Stack Tecnológico

- **Puppeteer Service**: Node.js + Express + Puppeteer + Stealth Plugin
- **Orquestación**: n8n workflow (cron cada 30 min)
- **Base de datos**: Supabase (proyecto crm-vortek: `zcmqcosuvjndgcwylzna`)
- **IA**: OpenAI GPT-4o para generación de propuestas y scoring
- **Notificaciones**: Evolution API (WhatsApp)
- **Despliegue**: Docker (Dockerfile + docker-compose.yml)

## Estructura del Proyecto

```
workana-autopilot/
├── CLAUDE.md                 # Este archivo
├── SETUP.md                  # Guía de instalación detallada
├── package.json              # Dependencias Node.js
├── Dockerfile                # Imagen Docker con Chromium
├── docker-compose.yml        # Orquestación Docker
├── .env.example              # Variables de entorno requeridas
├── n8n-workflow.json         # Workflow completo de n8n
└── src/
    ├── server.js             # API Express (7 endpoints, puerto 3500)
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

## Base de Datos (Supabase crm-vortek)

4 tablas en schema `public`:

- **workana_projects** — Proyectos scrapeados + relevance_score (0-100) + status
- **workana_proposals** — Propuestas generadas por IA (texto, presupuesto, plazo, skills)
- **workana_config** — Configuración del sistema (auto_mode, horarios, límites)
- **workana_logs** — Registro de todas las acciones

RPCs: `get_new_workana_projects()`, `get_workana_daily_stats()`

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

## Variables de Entorno Requeridas

```env
WORKANA_EMAIL=tu-email@workana.com
WORKANA_PASSWORD=tu-password
PORT=3500
HEADLESS=true
USER_DATA_DIR=./chrome-data
```

Variables adicionales configuradas en el nodo CONFIG de n8n:
- `SUPABASE_URL`, `SUPABASE_KEY`
- `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `WHATSAPP_NUMBER`
- `OPENAI_MODEL` (gpt-4o)
- `SEARCH_CATEGORIES`, `SEARCH_PAGES`
- `MIN_RELEVANCE_AUTO`, `MAX_PROPOSALS_DAY`, `MAX_PROPOSALS_ON_PROJECT`

## Anti-Detección (9 medidas)

1. puppeteer-extra-plugin-stealth
2. Delays aleatorios (1-6s entre acciones)
3. Escritura humana (30-110ms entre teclas, pausas aleatorias)
4. Movimientos de ratón naturales (curvas de Bezier)
5. Sesión persistente (cookies guardadas en volumen Docker)
6. Horario humano (8:00-22:00, sin domingos)
7. User Agent real (Chrome 125 Windows)
8. Headless con stealth flags
9. Rate limiting entre páginas

## Notas de Desarrollo

- Los selectores CSS del scraper usan múltiples fallbacks por si Workana cambia su HTML
- Usar `/screenshot` para debugging visual cuando algo falla
- La primera ejecución puede requerir ajustar selectores en `scraper.js` y `submitter.js`
- El volumen `chrome-data` mantiene la sesión de Workana entre reinicios
- Empezar siempre en modo manual para verificar calidad de propuestas
