# Registro de Incidencias — Workana Autopilot

> **Para Claude Code**: Cuando el usuario reporte un error, busca primero aquí por síntoma (alerta WhatsApp, error n8n, comportamiento). Si coincide con una incidencia pasada, aplica la solución documentada antes de investigar desde cero.

---

## Índice de Síntomas Rápidos

| Síntoma | Incidencia | Solución rápida |
|---------|------------|-----------------|
| `🚨 SESIÓN DE WORKANA CAÍDA` | [INC-001](#inc-001), [INC-005](#inc-005) | `POST /clear-cookies` → `POST /login` |
| `ERR_TOO_MANY_REDIRECTS` | [INC-002](#inc-002) | `POST /clear-cookies` (si persiste → rebuild) |
| `The service was not able to process your request` (Scrape) | [INC-003](#inc-003) | Timeout insuficiente en enqueue/n8n |
| `timeout of 600000ms exceeded` (Submit) | [INC-004](#inc-004) | Safety timeout Express + reducir intentos |
| `🤖❌ ERROR EN ENVÍO AUTO` pero propuesta SÍ enviada | [INC-006](#inc-006) | Detección de éxito demasiado conservadora |
| Propuestas duplicadas en Workana | [INC-006](#inc-006), [INC-007](#inc-007) | Submitter: MAX_SUBMIT_ATTEMPTS=1. n8n: retryOnFail=false |
| Login falla tras rebuild (URL sigue en `/login`) | [INC-005](#inc-005) | Cookie banner bloquea submit → rebuild con fix |
| Solo errores en WhatsApp, 0 propuestas enviadas por días | [INC-008](#inc-008) | Bug login acepta URLs corruptas → fix en browser.js:258 |

---

## INC-001: Sesión caída tras rebuild de Easypanel
**Fecha**: 2026-04-15
**Severidad**: Alta
**Síntoma**: WhatsApp envía `🚨 ALERTA: SESIÓN DE WORKANA CAÍDA`. Health check: `loggedIn: false`, uptime bajo (rebuild reciente).
**Causa raíz**: Cada rebuild de Easypanel reinicia el contenedor Docker. Aunque `chrome-data` persiste en volumen, las cookies pueden quedar en estado inconsistente.
**Solución aplicada**:
1. `POST /clear-cookies` — limpia cookies vía CDP
2. `POST /login` — re-login
**Prevención**: El código de `login()` y `checkSession()` en `browser.js` ahora detecta `ERR_TOO_MANY_REDIRECTS` y limpia cookies automáticamente antes de reintentar.
**Archivos**: `src/browser.js` (login, checkSession), `src/server.js` (/clear-cookies)

---

## INC-002: Redirect loop (`ERR_TOO_MANY_REDIRECTS`)
**Fecha**: 2026-04-15
**Severidad**: Crítica (bloquea todo el servicio)
**Síntoma**: Cualquier navegación a `workana.com` falla con `net::ERR_TOO_MANY_REDIRECTS`. Los endpoints `/screenshot`, `/debug-html`, `/login` todos fallan.
**Causa raíz**: Cookies corruptas en el volumen persistente `chrome-data`. Ocurre tras rebuilds o si Workana cambia sus cookies de sesión.
**Solución aplicada**:
1. Endpoint `POST /clear-cookies` — usa CDP (`Network.clearBrowserCookies` + `Network.clearBrowserCache`)
2. Detección automática en `login()`: si `goto()` falla con redirect loop → clear cookies → reintentar
3. Detección automática en `checkSession()`: misma lógica
**Código clave** (`browser.js`):
```javascript
// Dentro de login() y checkSession():
if (navError && navError.message.includes('ERR_TOO_MANY_REDIRECTS')) {
  const client = await page.createCDPSession();
  await client.send('Network.clearBrowserCookies');
  await client.send('Network.clearBrowserCache');
  await client.detach();
  // reintentar navegación...
}
```
**Archivos**: `src/browser.js`, `src/server.js`

---

## INC-003: Timeout en nodo "Scrape Workana" de n8n
**Fecha**: 2026-04-15
**Severidad**: Alta
**Síntoma**: n8n muestra `The service was not able to process your request` en el nodo Scrape Workana. El endpoint `/scrape-all` devuelve 0 bytes tras timeout.
**Causa raíz**: `enqueue()` en `browser.js` tenía timeout fijo de 120s. Scraping de 4 categorías × 2 páginas toma ~200s. La operación moría silenciosamente y Express nunca enviaba respuesta.
**Solución aplicada**:
1. `enqueue()` ahora acepta timeout configurable: `enqueue(fn, timeoutMs = 120000)`
2. `/scrape-all` usa `enqueue(fn, 300000)` (5 min)
3. `/submit-proposal` usa `enqueue(fn, 300000)` (5 min)
4. `/my-proposals` usa `enqueue(fn, 180000)` (3 min)
5. n8n workflow retry: timeout del nodo HTTP subido a 600s
6. n8n workflow feedback: timeout añadido de 180s
**Archivos**: `src/browser.js` (enqueue), `src/server.js` (todos los endpoints), `n8n-workflow-retry.json`, `n8n-workflow-feedback.json`

---

## INC-004: Timeout de 600s en submit-proposal (n8n AxiosError)
**Fecha**: 2026-04-16
**Severidad**: Crítica
**Síntoma**: n8n muestra `timeout of 600000ms exceeded` (AxiosError) en el nodo de envío. WhatsApp: `🤖❌ ERROR EN ENVÍO AUTO` en TODAS las propuestas del día.
**Causa raíz**: El submitter con `MAX_SUBMIT_ATTEMPTS=3` + verificación multi-paso + delays acumulaba ~600s total. Si el enqueue moría, Express nunca enviaba respuesta HTTP → n8n esperaba hasta su propio timeout de 600s.
**Solución aplicada**:
1. **Safety timeout en Express** (240s): `setTimeout` que GARANTIZA respuesta HTTP aunque enqueue falle
2. `MAX_SUBMIT_ATTEMPTS`: 3 → 1 (sin reintentos internos)
3. `MAX_TOTAL_TIME_MS`: 210s — abort global si se excede
4. Navegación: `networkidle2` → `domcontentloaded` (más rápido)
5. Delays y waits reducidos en todo el submitter
6. `_verifyAlreadySent` simplificado (eliminó check de `/my_projects` que añadía ~60s)
**Código clave** (`server.js`):
```javascript
app.post('/submit-proposal', async (req, res) => {
  const SAFETY_TIMEOUT_MS = 240000;
  const safetyTimer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ success: false, error: 'Server safety timeout (240s)' });
    }
  }, SAFETY_TIMEOUT_MS);
  // ... enqueue + clearTimeout ...
});
```
**Archivos**: `src/submitter.js`, `src/server.js`

---

## INC-005: Login falla tras rebuild — cookie banner bloquea submit
**Fecha**: 2026-04-16
**Severidad**: Crítica (bloquea todo)
**Síntoma**: `POST /login` retorna `{"success":false,"message":"Login fallido. URL: https://www.workana.com/login"}`. La página carga correctamente (campos email/password visibles), pero el login no procede.
**Causa raíz**: Workana muestra un banner de cookies ("Aceptar todas las cookies") que se superpone al botón de submit del formulario de login. `humanClick()` calcula coordenadas del botón pero el click impacta en el banner overlay.
**Diagnóstico**: Confirmado vía `/debug-html` que la página muestra: `"Al hacer clic en "Aceptar todas las cookies"..."` junto con los campos `name="email"`, `type="password"`, `type="submit"`.
**Solución aplicada**:
1. Nuevo método `_dismissCookieBanner(page)` en `browser.js` — busca botones por texto ("Aceptar todas las cookies", etc.) y hace click
2. Se ejecuta ANTES de interactuar con el formulario de login
3. Fallback de submit por texto: busca botones con texto "Ingresa", "Iniciar sesión", etc.
4. Diagnóstico mejorado cuando falla: detecta captchas, errores visibles, muestra snippet de página
**Archivos**: `src/browser.js` (login, _dismissCookieBanner)
**Estado**: Código en `main` (commit `634f0c8`), pendiente rebuild en Easypanel.

---

## INC-006: Propuestas duplicadas — detección de éxito ultra-conservadora
**Fecha**: 2026-04-16
**Severidad**: Crítica (daño reputacional en Workana)
**Síntoma**: WhatsApp reporta `🤖❌ ERROR EN ENVÍO AUTO` pero las propuestas SÍ se enviaron en Workana. Algunos proyectos reciben 2 propuestas idénticas.
**Proyectos afectados**: "Optimización Rendimiento Web" (×2), "Automatización y Agentes IA" (×2), "Tienda Dropshipping" (×1), "App Móvil Flutter" (×2).
**Causa raíz**: Tras enviar la propuesta, Workana redirige a `/messages/index/...` (no a `/inbox/`). La detección ultra-conservadora solo reconocía `/inbox/` como éxito. Todo lo demás → reportaba fallo → reintento → duplicado.
**Solución aplicada** — Reescritura completa de `_checkSubmissionResult`:
1. `MAX_SUBMIT_ATTEMPTS = 1` (NUNCA reintentar — preferir falso negativo)
2. URLs de éxito: `/inbox/` + `/messages/index/`
3. **Éxito probable**: URL cambió Y formulario desapareció → éxito (no reintenta)
4. **Fallo claro**: Error de validación visible O formulario sigue visible con botón submit
5. **Ambiguo**: Todo lo demás → terminal (nunca reintenta)
**Filosofía**: Anti-duplicados > detección perfecta. Es mejor reportar un falso negativo (❌ pero sí se envió) que causar un duplicado.
**Código clave** (`submitter.js`):
```javascript
// Éxito: URL redirigió a mensajes
if (currentUrl.includes('/inbox/') || currentUrl.includes('/messages/index/')) {
  return { success: true, ... };
}
// Éxito probable: URL cambió Y formulario desapareció
if (currentUrl !== formUrl && !pageState.hasVisibleTextarea) {
  return { success: true, message: 'Propuesta probablemente enviada (URL cambió)', ... };
}
// Fallo claro: formulario sigue visible
if (pageState.hasVisibleTextarea && pageState.hasSubmitBtn) {
  return { success: false, _terminal: false };
}
// Ambiguo → terminal (nunca reintenta)
return { success: false, _terminal: true };
```
**Archivos**: `src/submitter.js`

---

## INC-007: Duplicados por retryOnFail de n8n (capa externa)
**Fecha**: 2026-04-16
**Severidad**: Crítica (duplicados incluso con MAX_SUBMIT_ATTEMPTS=1)
**Síntoma**: Propuestas se envían 2 veces a pesar de que el submitter tiene `MAX_SUBMIT_ATTEMPTS = 1`. WhatsApp muestra `🤖❌ ERROR EN ENVÍO AUTO`.
**Causa raíz**: El nodo "Enviar Automático" en n8n tenía `retryOnFail: true, maxTries: 2, waitBetweenTries: 5000`. Esto es un retry a nivel HTTP de n8n, completamente separado del retry interno del submitter. Flujo del duplicado:
1. n8n llama POST /submit-proposal → Puppeteer envía correctamente
2. Detección falla o timeout → responde error/504
3. n8n ve error HTTP → espera 5 segundos → **reenvía el mismo POST**
4. Puppeteer abre el proyecto de nuevo → `_checkIfAlreadyApplied` no detecta envío previo (5s es poco para que Workana actualice UI)
5. Puppeteer reenvía → **DUPLICADO**
**Solución aplicada**:
1. `n8n-workflow.json`: nodo "Enviar Automático" → `retryOnFail: false` (NUNCA reintentar envíos)
2. Se mantiene `onError: "continueRegularOutput"` para que el flujo continúe y notifique por WhatsApp
**REGLA**: Ningún nodo HTTP que llame a `/submit-proposal` debe tener `retryOnFail: true`. Reintentar propuestas = duplicados.
**Archivos**: `n8n-workflow.json` (nodo auto-submit)
**Acción requerida**: Reimportar workflow en n8n.

---

## Procedimientos de Recuperación

### Sesión caída (procedimiento estándar)
```bash
# 1. Verificar estado
curl -s https://workana-auto-pilot.ioefpm.easypanel.host/health

# 2. Limpiar cookies
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/clear-cookies

# 3. Login
curl -s -X POST https://workana-auto-pilot.ioefpm.easypanel.host/login

# 4. Verificar sesión
curl -s https://workana-auto-pilot.ioefpm.easypanel.host/session-check
```

### Redirect loop persistente
```bash
# Si /clear-cookies + /login no resuelve:
# 1. Rebuild en Easypanel (Forzar reconstrucción)
# 2. Esperar ~3-5 min
# 3. Ejecutar procedimiento de sesión caída
```

### Verificar que el sistema funciona end-to-end
```bash
# 1. Health
curl -s https://workana-auto-pilot.ioefpm.easypanel.host/health

# 2. Sesión
curl -s https://workana-auto-pilot.ioefpm.easypanel.host/session-check

# 3. Scrape (prueba rápida, 1 categoría)
curl -s "https://workana-auto-pilot.ioefpm.easypanel.host/scrape-projects?category=it-programming"

# 4. Debug form (sin enviar)
curl -s "https://workana-auto-pilot.ioefpm.easypanel.host/debug-form?url=URL_DE_PROYECTO"
```

---

## INC-008: Login acepta URLs corruptas — loop infinito de fallos
**Fecha**: 2026-04-27
**Severidad**: Crítica (sistema completamente parado durante 12 días)
**Síntoma**: WhatsApp solo envía mensajes de `🤖❌ ERROR EN ENVÍO AUTO`. Cero propuestas enviadas desde el 15 de abril. Base de datos muestra 20 proyectos con `status=proposal_generated` y `auto_sent=true` pero ninguno cambia a `status=sent`.
**Causa raíz**: Bug en `browser.js:258` — método `login()` acepta URLs corruptas como válidas:

```javascript
// ANTES (BUG):
if (!page.url().includes('/login')) {
  this.loggedIn = true;
  return { success: true, message: 'Ya estás logueado (sesión previa)' };
}
```

Cuando el browser está en redirect loop, `page.url()` retorna `chrome-error://chromewebdata/`. Como NO incluye `/login`, el código marca como logueado exitosamente.

**Cascada de fallos**:
1. Redirect loop (15/abril) → cookies corruptas → browser retorna `chrome-error://` en navegaciones
2. `login()` retorna `{ success: true, url: 'chrome-error://chromewebdata/' }`
3. Workflow n8n cree que login funcionó (porque `success=true`)
4. Workflow continúa: scraping funciona, IA genera propuestas
5. Intenta enviar propuesta → falla (sesión realmente caída, browser corrupto)
6. `submitResult.success = false`
7. Nodo "Actualizar Estado" deja proyecto en `status=proposal_generated` (no cambia a `sent`)
8. Nodo "Resultado Auto" solo hace `console.log` del error (NO mete en retry_queue)
9. WhatsApp notifica error
10. Workflow termina
11. **Siguiente ejecución: mismo ciclo infinito** (cada 30 min durante 12 días)

**Impacto medido**:
- **Duración**: 12 días (15 abril → 27 abril)
- **Propuestas perdidas**: 20 proyectos con score ≥85 no enviados
- **Scraping funcionando**: 20 proyectos detectados correctamente
- **IA funcionando**: 20 propuestas generadas correctamente
- **Solo falla envío**: sesión corrupta 100% del tiempo

**Diagnóstico aplicado**:
```bash
# 1. Health check — browser corriendo pero loggedIn flag incorrecto
curl https://workana-auto-pilot.ioefpm.easypanel.host/health
# {"browser":true,"loggedIn":true,...}  ← flag en memoria (stale)

# 2. Session check — redirect loop detectado
curl https://workana-auto-pilot.ioefpm.easypanel.host/session-check
# {"loggedIn":false,"url":"cookies cleared (redirect loop)"}

# 3. Login manual — retorna success con URL corrupta
curl -X POST https://workana-auto-pilot.ioefpm.easypanel.host/login
# {"success":true,"message":"Login exitoso (...)","url":"chrome-error://chromewebdata/"}
# ↑ BUG: success=true pero URL inválida

# 4. Verificar propuestas pendientes en Supabase
curl "https://zcmqcosuvjndgcwylzna.supabase.co/rest/v1/workana_projects?select=id,created_at&status=eq.proposal_generated&auto_sent=eq.true&order=created_at.desc" -H "apikey: SERVICE_KEY"
# → 20 proyectos desde 24/abril con status=proposal_generated
```

**Solución aplicada**:
1. **Fix en `browser.js:258`** — validación estricta de URL:
```javascript
// DESPUÉS (FIX):
const currentUrl = page.url();
if (!currentUrl.includes('/login') && currentUrl.includes('workana.com') && currentUrl.startsWith('https://')) {
  this.loggedIn = true;
  return { success: true, message: 'Ya estás logueado (sesión previa)', url: currentUrl };
}

// Si la URL no es de Workana, es un redirect loop o error del browser
if (!currentUrl.includes('workana.com') || !currentUrl.startsWith('https://')) {
  console.error(`[Browser] Login navegó a URL inválida: ${currentUrl}`);
  return {
    success: false,
    message: `Login falló — browser en estado corrupto. URL: ${currentUrl}`,
    url: currentUrl,
  };
}
```

2. **Rebuild del servicio** en Easypanel para limpiar estado corrupto del browser

**Validación post-fix**:
```bash
# Script de validación end-to-end
bash test-sistema.sh

# Debe verificar:
# 1. Browser corriendo
# 2. Sesión activa (login funciona, URL válida)
# 3. Scraping funciona (al menos 1 proyecto)
# 4. Propuestas pendientes se procesarán gradualmente
```

**Prevención**:
- Toda validación de login DEBE verificar que URL incluye dominio esperado ('workana.com') Y protocolo HTTPS
- NUNCA asumir que ausencia de '/login' en URL = login exitoso
- Siempre loguear URL completa en mensajes de error/éxito para facilitar debugging
- Script `test-sistema.sh` ahora disponible para validación rápida post-rebuild

**Archivos modificados**:
- `src/browser.js` (login method, líneas 258-273)
- `test-sistema.sh` (nuevo archivo de validación)
- Commit: [cfeea49](https://github.com/vortekai1/workana-autopilot/commit/cfeea49)

**Estado**: Resuelto. Esperando rebuild + validación con `test-sistema.sh`.

---

## Lecciones Aprendidas

1. **Express DEBE tener safety timeout**: Si enqueue/Puppeteer muere, Express debe garantizar respuesta HTTP. Sin esto, n8n espera hasta su propio timeout (600s) y el workflow se bloquea.

2. **NUNCA reintentar envíos de propuestas — en NINGUNA capa**: Los reintentos existen en 3 capas: (a) submitter.js `MAX_SUBMIT_ATTEMPTS`, (b) n8n `retryOnFail` en nodos HTTP, (c) retry_queue workflow. TODAS deben ser conservadoras. El submitter NUNCA debe reintentar internamente. Los nodos HTTP que llaman a `/submit-proposal` NUNCA deben tener `retryOnFail: true`. La retry_queue es la única vía aceptable, y tiene backoff + verificación.

3. **Detección de éxito debe ser amplia, no conservadora**: Workana puede redirigir a múltiples URLs tras enviar (`/inbox/`, `/messages/index/`, etc.). Si la URL cambió y el formulario desapareció, asumir éxito.

4. **Cookie banners bloquean clicks**: Los overlays de cookies interceptan clicks en botones del formulario. Siempre cerrar banners ANTES de interactuar con formularios.

5. **Rebuilds de Easypanel = sesión caída**: Cada rebuild reinicia el contenedor. Tener siempre el procedimiento de recuperación a mano.

6. **Timeouts deben ser configurables**: Hardcodear timeouts causa cascadas de fallos cuando las operaciones tardan más de lo esperado. Cada endpoint debe configurar su timeout según su operación.

7. **Volumen `chrome-data` puede corromperse**: Las cookies persistentes pueden quedar en estado inconsistente tras rebuilds. CDP `Network.clearBrowserCookies` es la forma fiable de limpiar.

8. **Validación de login debe verificar URL completa, no solo ausencia de '/login'**: Cuando el browser está corrupto, `page.url()` puede retornar `chrome-error://` u otras URLs inválidas. El código DEBE validar que la URL incluye el dominio esperado ('workana.com') Y usa protocolo HTTPS. Asumir que "no está en /login = login exitoso" causa loops infinitos cuando el browser está en estado corrupto.

9. **Los flags booleanos en memoria (como `loggedIn`) pueden quedar stale**: El flag `this.loggedIn` puede decir `true` mientras la sesión real está caída. SIEMPRE verificar con navegación real (como hace `checkSession()`), no confiar solo en el flag. En caso de duda, priorizar evidencia de navegación sobre flags en memoria.

10. **Propuestas con `auto_sent=true` pero `status!=sent` = señal de alerta**: Si hay proyectos con `status=proposal_generated` y `auto_sent=true` acumulándose por días, el sistema está intentando enviar pero fallando silenciosamente. Monitorear esta métrica como KPI de salud del sistema.
