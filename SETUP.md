# Workana Autopilot - Guía de Setup

## Arquitectura

```
┌─────────────────────────────────┐
│ Puppeteer Service (:3500)       │
│ - Scrape proyectos Workana      │
│ - Envío automático propuestas   │
│ - Sesión persistente Chrome     │
└──────────────┬──────────────────┘
               │ HTTP
┌──────────────┴──────────────────┐
│ n8n Workflow (cada 30 min)      │
│ 1. Scrape via Puppeteer API     │
│ 2. Filtrar proyectos nuevos     │
│ 3. IA genera propuesta (GPT-4o) │
│ 4. Guarda en Supabase           │
│ 5. Auto-envía O notifica WhatsApp│
└──────────────┬──────────────────┘
               │
┌──────────────┴──────────────────┐
│ Supabase (crm-vortek)           │
│ - workana_projects              │
│ - workana_proposals             │
│ - workana_config                │
│ - workana_logs                  │
└─────────────────────────────────┘
```

## Paso 1: Servicio Puppeteer

### Opción A: Docker (recomendado para VPS)

```bash
cd workana-autopilot

# Crear .env
cp .env.example .env
# Editar con tus credenciales de Workana

# Arrancar
docker compose up -d

# Ver logs
docker logs -f workana-autopilot
```

### Opción B: Node.js directo

```bash
cd workana-autopilot
npm install
cp .env.example .env
# Editar .env con credenciales

# Arrancar
npm start

# O en desarrollo (auto-reload)
npm run dev
```

### Verificar que funciona

```bash
# Health check
curl http://localhost:3500/health

# Test scraping
curl "http://localhost:3500/scrape-projects?category=it-programming&page=1"
```

## Paso 2: Importar Workflow en n8n

1. Abre n8n: `https://n8n.vortekai.es`
2. Crear nuevo workflow
3. Menú ≡ → Import from file → seleccionar `n8n-workflow.json`
4. **Configurar el nodo CONFIG:**
   - `PUPPETEER_URL`: URL donde corre el servicio Puppeteer (ej: `http://localhost:3500` o `http://tu-vps:3500`)
   - `SUPABASE_KEY`: Tu anon key de crm-vortek
   - `WHATSAPP_NUMBER`: Tu número (formato: `34600123456`)
   - `EVOLUTION_INSTANCE`: Nombre de tu instancia Evolution
   - `AUTO_MODE`: `false` para empezar (manual)
5. **Configurar credenciales:**
   - Nodo "IA Genera Propuesta" → Credencial OpenAI API
   - Nodo "Enviar WhatsApp" → Credencial Evolution API (HTTP Header Auth)
6. Activar el workflow

## Paso 3: Configuración Inicial

### En Supabase (tabla workana_config)

Ajustar estos valores según tu preferencia:

| Key | Valor | Qué hace |
|-----|-------|----------|
| `auto_mode` | `false` | `true` = envía solo, `false` = solo notifica |
| `min_relevance_auto` | `80` | Score mínimo para envío automático |
| `max_proposals_day` | `35` | Límite diario de propuestas |
| `search_categories` | `["it-programming"]` | Categorías Workana |
| `search_keywords` | `[...]` | Keywords para filtrar |
| `min_budget` | `150` | Presupuesto mínimo EUR |
| `max_proposals_on_project` | `30` | Ignorar saturados |
| `schedule_hours` | `{"start":8,"end":22}` | Horario activo |

### Crear instancia Evolution API

Si no tienes una instancia para Workana:
1. Ve a tu Evolution API: `https://evo.vortekai.es`
2. Crea instancia `WorkanaBot`
3. Conecta tu WhatsApp

## Modo de Uso

### Modo Manual (recomendado al principio)
- `AUTO_MODE = false`
- Recibes WhatsApp con cada proyecto + propuesta generada
- Abres el link, pegas la propuesta, envías
- ~1-2 min por propuesta vs ~10 min antes

### Modo Autopiloto (cuando confíes en el sistema)
- `AUTO_MODE = true`
- El sistema envía solo las propuestas con relevancia ≥ 80
- Te notifica por WhatsApp de lo que envió
- Las de < 80 te las manda para revisión manual

### Ejemplo de notificación WhatsApp

```
📋 PENDIENTE DE ENVÍO

🎯 Desarrollo de chatbot WhatsApp para clínica dental
Relevancia: ████████░░ 82/100

💰 Presupuesto: $500-1000 USD
📊 Propuestas: 7
🌍 Cliente: Carlos M. (Argentina)
⭐ Rating: 4.8
✅ Verificado: Sí

---

📝 PROPUESTA:
El problema no es solo responder mensajes fuera de horario,
es cada consulta que se enfría porque nadie atendió a tiempo.

Montamos un sistema similar para una clínica dental hace 2
semanas: WhatsApp + IA + Google Calendar, citas automáticas
24/7 y 60% menos llamadas de seguimiento al mes.

¿Tenéis ya WhatsApp Business o seguís con número personal?
Eso define el punto de arranque.

¿Hablamos 15 min esta semana?
Alex

💶 Precio sugerido: €700
📅 Plazo: 10 días

🔗 https://www.workana.com/job/chatbot-clinica-dental
```

## Ajuste de Selectores

Si Workana cambia su HTML, hay que ajustar los selectores CSS en:
- `src/scraper.js` → selectores de proyectos y detalles
- `src/submitter.js` → selectores del formulario de propuesta

Para debuggear, usa el endpoint de screenshot:
```bash
curl "http://localhost:3500/screenshot?url=https://www.workana.com/jobs" --output test.png
```

## Seguridad Anti-Baneo

El sistema implementa estas medidas:
- **puppeteer-extra-plugin-stealth**: Oculta que es un bot
- **Delays aleatorios**: 1-6 segundos entre acciones
- **Escritura humana**: Velocidad variable al escribir
- **Movimientos de ratón**: Curvas naturales
- **Sesión persistente**: Mismas cookies que un usuario real
- **Horario humano**: Solo 8:00-22:00
- **User Agent real**: Chrome 125 Windows
- **Sin headless detectable**: Chrome real con stealth
- **Rate limiting**: Delays entre páginas scrapeadas

## Mantenimiento

- **Sesión expirada**: `curl -X POST http://localhost:3500/login`
- **Ver estado**: `curl http://localhost:3500/health`
- **Reiniciar servicio**: `docker compose restart`
- **Ver logs n8n**: Pestaña "Executions" del workflow
- **Estadísticas diarias**: Consulta `SELECT * FROM get_workana_daily_stats()` en Supabase
