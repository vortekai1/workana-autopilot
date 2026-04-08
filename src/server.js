const express = require('express');
const { BrowserManager } = require('./browser');
const { WorkanaScraper } = require('./scraper');
const { ProposalSubmitter } = require('./submitter');

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS - permite al dashboard acceder desde cualquier origen
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3500;

// Instancias globales
let browserManager;
let scraper;
let submitter;

// ============================================
// ENDPOINTS
// ============================================

// Health check enriquecido
app.get('/health', async (req, res) => {
  const isAlive = browserManager?.isRunning() || false;
  const isLoggedIn = browserManager?.loggedIn || false;
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    browser: isAlive,
    loggedIn: isLoggedIn,
    uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
    memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
    timestamp: new Date().toISOString(),
  });
});

// Login manual (también se hace al arrancar)
app.post('/login', async (req, res) => {
  try {
    const result = await browserManager.login();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scrape proyectos de búsqueda
app.get('/scrape-projects', async (req, res) => {
  try {
    const {
      category = 'it-programming',
      page = 1,
      language = 'es',
    } = req.query;

    const result = await scraper.scrapeSearchPage(
      category,
      parseInt(page),
      language
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scrape múltiples páginas y categorías
app.post('/scrape-all', async (req, res) => {
  try {
    const {
      categories = ['it-programming'],
      pages = 2,
      language = 'es',
    } = req.body;

    const allProjects = [];

    for (const category of categories) {
      for (let p = 1; p <= pages; p++) {
        const result = await scraper.scrapeSearchPage(category, p, language);
        if (result.success && result.projects.length > 0) {
          allProjects.push(...result.projects);
        }
        // Delay entre páginas
        await browserManager.randomDelay(3000, 6000);
      }
    }

    // Deduplicar por URL
    const unique = [...new Map(allProjects.map(p => [p.url, p])).values()];

    res.json({ success: true, projects: unique, total: unique.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener detalles de un proyecto
app.get('/project-details', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL requerida' });
    }
    const result = await scraper.getProjectDetails(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enviar propuesta
app.post('/submit-proposal', async (req, res) => {
  try {
    const { url, text, budget, delivery_days } = req.body;
    if (!url || !text) {
      return res.status(400).json({
        success: false,
        error: 'URL y texto de propuesta requeridos',
      });
    }
    const result = await submitter.submit(url, text, budget, delivery_days);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug: analizar formulario de propuesta sin enviar
app.get('/debug-form', async (req, res) => {
  const page = await browserManager.newPage();
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url requerida' });

    // 1. Navegar al proyecto
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await browserManager.randomDelay(2000, 3000);
    await page.waitForFunction(() => document.body.innerText.length > 500, { timeout: 15000 }).catch(() => {});

    const projectUrl = page.url();

    // 2. Buscar y clickar botón de propuesta
    let applyClicked = false;
    const textPatterns = ['Enviar una propuesta', 'Enviar propuesta', 'Send a proposal'];
    for (const text of textPatterns) {
      applyClicked = await page.evaluate(txt => {
        const el = [...document.querySelectorAll('a, button')].find(e =>
          e.textContent?.trim().toLowerCase().includes(txt.toLowerCase())
        );
        if (el) { el.click(); return true; }
        return false;
      }, text);
      if (applyClicked) break;
    }

    if (!applyClicked) {
      const screenshot = await page.screenshot({ encoding: 'base64' });
      return res.json({ error: 'No se encontró botón de propuesta', projectUrl, screenshot });
    }

    // 3. Esperar formulario
    await browserManager.randomDelay(3000, 5000);
    await page.waitForFunction(() => document.querySelectorAll('textarea').length > 0, { timeout: 15000 }).catch(() => {});
    await browserManager.randomDelay(1000, 2000);

    const formUrl = page.url();

    // 4. Analizar TODOS los elementos del formulario
    const formAnalysis = await page.evaluate(() => {
      const result = {};

      // Textareas
      result.textareas = [...document.querySelectorAll('textarea')].map(t => ({
        name: t.name || t.id || '(sin nombre)',
        placeholder: (t.placeholder || '').substring(0, 100),
        rows: t.rows,
        visible: t.getBoundingClientRect().height > 10,
        value_length: (t.value || '').length,
      }));

      // Inputs
      result.inputs = [...document.querySelectorAll('input')].map(i => ({
        type: i.type,
        name: i.name || i.id || '(sin nombre)',
        placeholder: (i.placeholder || '').substring(0, 100),
        value: (i.value || '').substring(0, 50),
        required: i.required,
        visible: i.getBoundingClientRect().height > 10 && i.getBoundingClientRect().width > 10,
      })).filter(i => i.type !== 'hidden');

      // Selects
      result.selects = [...document.querySelectorAll('select')].map(s => ({
        name: s.name || s.id || '(sin nombre)',
        options: [...s.options].map(o => o.value + ':' + o.text.trim()).slice(0, 10),
        required: s.required,
        selectedValue: s.value,
      }));

      // Buttons
      result.buttons = [...document.querySelectorAll('button')].map(b => ({
        text: (b.textContent || '').trim().substring(0, 80),
        type: b.type,
        disabled: b.disabled,
        className: (b.className || '').substring(0, 80),
      })).filter(b => b.text.length > 0);

      // Forms
      result.forms = [...document.querySelectorAll('form')].map(f => ({
        action: f.action || '(sin action)',
        method: f.method,
        id: f.id || '(sin id)',
        className: (f.className || '').substring(0, 80),
      }));

      // Links con texto relevante
      result.relevantLinks = [...document.querySelectorAll('a')].filter(a =>
        /(enviar|submit|propuesta|proposal|bid)/i.test(a.textContent || '') ||
        /(enviar|submit|propuesta|proposal|bid)/i.test(a.href || '')
      ).map(a => ({
        text: (a.textContent || '').trim().substring(0, 80),
        href: (a.href || '').substring(0, 150),
      }));

      return result;
    });

    // 5. Screenshot del formulario
    const screenshot = await page.screenshot({ encoding: 'base64' });

    res.json({
      projectUrl,
      formUrl,
      formAnalysis,
      screenshot,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await page.close();
  }
});

// Verificar sesión (navega al dashboard y verifica)
app.get('/session-check', async (req, res) => {
  try {
    const result = await browserManager.checkSession();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tomar screenshot (para debug)
app.get('/screenshot', async (req, res) => {
  try {
    const { url } = req.query;
    const screenshot = await browserManager.takeScreenshot(url);
    res.set('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug: ver HTML de una página (para diagnosticar sin screenshots)
app.get('/debug-html', async (req, res) => {
  try {
    const { url } = req.query;
    const page = await browserManager.newPage();
    try {
      await page.goto(url || 'https://www.workana.com/login', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await browserManager.randomDelay(2000, 3000);
      const html = await page.content();
      const currentUrl = page.url();
      const title = await page.title();
      res.json({
        success: true,
        currentUrl,
        title,
        html: html.substring(0, 100000),
      });
    } finally {
      await page.close();
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scrape mis propuestas enviadas (para feedback loop) — multi-página
app.get('/my-proposals', async (req, res) => {
  try {
    const { page = 1, maxPages = 3 } = req.query;
    const result = await scraper.scrapeMyProposals(parseInt(page), parseInt(maxPages));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ARRANQUE
// ============================================

async function start() {
  browserManager = new BrowserManager({
    email: process.env.WORKANA_EMAIL,
    password: process.env.WORKANA_PASSWORD,
    userDataDir: process.env.USER_DATA_DIR || './chrome-data',
    headless: process.env.HEADLESS !== 'false',
  });

  await browserManager.init();
  scraper = new WorkanaScraper(browserManager);
  submitter = new ProposalSubmitter(browserManager);

  // Login al arrancar
  console.log('Iniciando login en Workana...');
  const loginResult = await browserManager.login();
  console.log('Login:', loginResult.message);

  app.listen(PORT, () => {
    console.log(`\nWorkana Autopilot API corriendo en puerto ${PORT}`);
    console.log(`Sesión activa: ${browserManager.loggedIn}`);
    console.log(`\nEndpoints disponibles:`);
    console.log(`  GET  /health`);
    console.log(`  POST /login`);
    console.log(`  GET  /scrape-projects?category=it-programming&page=1`);
    console.log(`  POST /scrape-all`);
    console.log(`  GET  /project-details?url=...`);
    console.log(`  POST /submit-proposal`);
    console.log(`  GET  /session-check`);
    console.log(`  GET  /screenshot?url=...`);
  });
}

start().catch(err => {
  console.error('Error fatal al arrancar:', err);
  process.exit(1);
});
