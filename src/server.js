const express = require('express');
const { BrowserManager } = require('./browser');
const { WorkanaScraper } = require('./scraper');
const { ProposalSubmitter } = require('./submitter');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3500;

// Instancias globales
let browserManager;
let scraper;
let submitter;

// ============================================
// ENDPOINTS
// ============================================

// Health check
app.get('/health', async (req, res) => {
  const isAlive = browserManager?.isRunning() || false;
  const isLoggedIn = browserManager?.loggedIn || false;
  res.json({ status: 'ok', browser: isAlive, loggedIn: isLoggedIn });
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
        html: html.substring(0, 15000),
      });
    } finally {
      await page.close();
    }
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
