const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor({ email, password, userDataDir, headless }) {
    this.email = email;
    this.password = password;
    this.userDataDir = userDataDir;
    this.headless = headless;
    this.browser = null;
    this.loggedIn = false;
    this._launching = false; // Prevent concurrent launches
    this._operationQueue = Promise.resolve(); // Mutex for sequential operations
  }

  async init() {
    await this._launchBrowser();

    // Cerrar browser al salir
    process.on('SIGINT', () => this.close());
    process.on('SIGTERM', () => this.close());

    return this.browser;
  }

  async _launchBrowser() {
    if (this._launching) return;
    this._launching = true;

    try {
      if (this.browser) {
        try { await this.browser.close(); } catch (_) {}
        this.browser = null;
      }

      this.browser = await puppeteer.launch({
        headless: this.headless ? 'new' : false,
        userDataDir: this.userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--window-size=1920,1080',
          '--lang=es-ES',
        ],
        defaultViewport: { width: 1920, height: 1080 },
      });

      // Auto-recovery: si el browser se desconecta, re-lanzar
      this.browser.on('disconnected', () => {
        console.error('[Browser] Chromium desconectado — re-lanzando...');
        this.browser = null;
        this.loggedIn = false;
        this._launching = false;
        this._launchBrowser().catch(err => {
          console.error('[Browser] Error re-lanzando:', err.message);
        });
      });

      console.log('[Browser] Chromium lanzado correctamente');
    } finally {
      this._launching = false;
    }
  }

  // Ensure browser is alive, re-launch if needed
  async _ensureBrowser() {
    if (!this.browser || !this.browser.connected) {
      console.log('[Browser] Browser no disponible, re-lanzando...');
      await this._launchBrowser();
    }
  }

  isRunning() {
    return this.browser?.connected || false;
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
    }
  }

  // Mutex: serializa operaciones de Puppeteer para evitar concurrencia
  // Esto previene que dos requests simultáneas sobrecargen Chromium
  // o disparen anti-detección por actividad paralela
  enqueue(fn) {
    const op = this._operationQueue.then(() => fn()).catch(err => {
      console.error('[Browser] Error en operación encolada:', err.message);
      throw err;
    });
    this._operationQueue = op.catch(() => {}); // No propagar al siguiente
    return op;
  }

  async newPage() {
    await this._ensureBrowser();
    const page = await this.browser.newPage();

    // Pool de User Agents reales — rota por día (no por petición, sería sospechoso)
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    ];
    const dayIndex = new Date().getDate() % userAgents.length;
    await page.setUserAgent(userAgents[dayIndex]);

    const langs = ['es-ES,es;q=0.9', 'es-ES,es;q=0.9,en;q=0.8', 'es;q=0.9'];
    await page.setExtraHTTPHeaders({
      'Accept-Language': langs[dayIndex % langs.length],
    });

    return page;
  }

  // Delay aleatorio simulando comportamiento humano
  // Por la noche más lento (simula fatiga natural)
  randomDelay(min = 1000, max = 3000) {
    const hour = new Date().getHours();
    const fatigue = hour >= 20 ? 1.5 : hour >= 17 ? 1.2 : 1.0;
    const ms = Math.floor((Math.random() * (max - min) + min) * fatigue);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Escritura humana (velocidad variable, pausas ocasionales)
  async humanType(page, selector, text) {
    await page.click(selector);
    await this.randomDelay(300, 600);

    for (let i = 0; i < text.length; i++) {
      await page.keyboard.type(text[i], {
        delay: 30 + Math.random() * 80,
      });

      // Pausa ocasional (como si pensara)
      if (Math.random() < 0.04) {
        await this.randomDelay(300, 800);
      }
    }
  }

  // Movimiento de ratón humano hacia un elemento
  async humanClick(page, selector) {
    const element = await page.$(selector);
    if (!element) return false;

    const box = await element.boundingBox();
    if (!box) return false;

    // Mover ratón con curva suave hacia el elemento
    const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const y = box.y + box.height / 2 + (Math.random() * 6 - 3);

    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 15) });
    await this.randomDelay(100, 300);
    await page.mouse.click(x, y);
    return true;
  }

  // Login en Workana
  async login() {
    const page = await this.newPage();

    try {
      await page.goto('https://www.workana.com/login', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      await this.randomDelay(2000, 3000);

      // Ya logueado? (redirige al dashboard)
      if (!page.url().includes('/login')) {
        this.loggedIn = true;
        return { success: true, message: 'Ya estás logueado (sesión previa)' };
      }

      // Buscar campo de email (Workana puede usar diferentes selectores)
      const emailSelectors = [
        '#email',
        'input[name="email"]',
        'input[type="email"]',
        '#login_email',
      ];

      let emailField = null;
      let emailSelector = null;
      for (const sel of emailSelectors) {
        emailField = await page.$(sel);
        if (emailField) {
          emailSelector = sel;
          break;
        }
      }

      if (!emailField) {
        // Puede que Cloudflare esté bloqueando - intentar esperar
        await this.randomDelay(5000, 8000);
        for (const sel of emailSelectors) {
          emailField = await page.$(sel);
          if (emailField) {
            emailSelector = sel;
            break;
          }
        }
      }

      if (!emailField) {
        const currentUrl = page.url();
        return {
          success: false,
          message: `No se encontró campo de email. URL actual: ${currentUrl}. Puede que Cloudflare esté bloqueando.`,
        };
      }

      // Escribir email
      await this.humanType(page, emailSelector, this.email);
      await this.randomDelay(800, 1500);

      // Escribir password
      const passSelectors = [
        '#password',
        'input[name="password"]',
        'input[type="password"]',
      ];
      let passSelector = null;
      for (const sel of passSelectors) {
        if (await page.$(sel)) {
          passSelector = sel;
          break;
        }
      }

      if (!passSelector) {
        return {
          success: false,
          message: 'No se encontró campo de contraseña. Estructura del login puede haber cambiado.',
        };
      }

      await this.humanType(page, passSelector, this.password);

      await this.randomDelay(1000, 2000);

      // Click en botón de login
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '.btn-primary[type="submit"]',
        '#login-submit',
      ];

      for (const sel of submitSelectors) {
        const clicked = await this.humanClick(page, sel);
        if (clicked) break;
      }

      // Esperar navegación
      await page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 })
        .catch(() => {});

      await this.randomDelay(2000, 3000);

      // Verificar login exitoso
      const currentUrl = page.url();
      this.loggedIn =
        !currentUrl.includes('/login') && !currentUrl.includes('/signin');

      return {
        success: this.loggedIn,
        message: this.loggedIn
          ? 'Login exitoso'
          : `Login fallido. URL: ${currentUrl}`,
        url: currentUrl,
      };
    } catch (error) {
      return { success: false, message: `Error de login: ${error.message}` };
    } finally {
      await page.close();
    }
  }

  // Verificar si la sesión sigue activa
  async checkSession() {
    const page = await this.newPage();

    try {
      await page.goto('https://www.workana.com/dashboard', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });

      const url = page.url();
      this.loggedIn = url.includes('/dashboard') || url.includes('/home');

      return {
        success: true,
        loggedIn: this.loggedIn,
        url,
      };
    } catch (error) {
      return { success: false, loggedIn: false, error: error.message };
    } finally {
      await page.close();
    }
  }

  // Screenshot para debug
  async takeScreenshot(url) {
    const page = await this.newPage();

    try {
      if (url) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      } else {
        await page.goto('https://www.workana.com', {
          waitUntil: 'networkidle2',
          timeout: 20000,
        });
      }

      await this.randomDelay(1000, 2000);
      const screenshot = await page.screenshot({ type: 'png', fullPage: false });
      return Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  }
}

module.exports = { BrowserManager };
