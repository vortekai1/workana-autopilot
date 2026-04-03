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
  }

  async init() {
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

    // Cerrar browser al salir
    process.on('SIGINT', () => this.close());
    process.on('SIGTERM', () => this.close());

    return this.browser;
  }

  isRunning() {
    return this.browser?.connected || false;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async newPage() {
    const page = await this.browser.newPage();

    // User agent realista
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Idioma español
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });

    return page;
  }

  // Delay aleatorio simulando comportamiento humano
  randomDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min) + min);
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
      for (const sel of emailSelectors) {
        emailField = await page.$(sel);
        if (emailField) break;
      }

      if (!emailField) {
        // Puede que Cloudflare esté bloqueando - intentar esperar
        await this.randomDelay(5000, 8000);
        for (const sel of emailSelectors) {
          emailField = await page.$(sel);
          if (emailField) break;
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
      await this.humanType(
        page,
        emailField ? '#email' : 'input[name="email"]',
        this.email
      );
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

      if (passSelector) {
        await this.humanType(page, passSelector, this.password);
      }

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
      return await page.screenshot({ type: 'png', fullPage: false });
    } finally {
      await page.close();
    }
  }
}

module.exports = { BrowserManager };
