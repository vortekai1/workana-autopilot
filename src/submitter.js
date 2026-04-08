class ProposalSubmitter {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  async submit(projectUrl, proposalText, budget, deliveryDays, debug = false) {
    const page = await this.bm.newPage();
    const startTime = Date.now();
    const log = (msg) => console.log(`[Submitter] ${msg}`);
    const screenshots = {};

    try {
      log(`=== INICIO SUBMIT ===`);
      log(`URL: ${projectUrl}`);
      log(`Budget: ${budget}, Delivery: ${deliveryDays}, Debug: ${debug}`);

      // 1. Navegar al proyecto
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(2000, 3000);
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 15000 }
      ).catch(() => log('Timeout esperando render MFE'));
      await this.bm.randomDelay(2000, 3000);

      const projectPageUrl = page.url();
      log(`1. Página del proyecto cargada: ${projectPageUrl}`);

      // 2. Buscar y clickar "Enviar una propuesta"
      let applyClicked = await this._clickApplyButton(page);
      if (!applyClicked) {
        log('Botón no encontrado, reintentando en 5s...');
        await this.bm.randomDelay(4000, 6000);
        applyClicked = await this._clickApplyButton(page);
      }
      if (!applyClicked) {
        if (debug) screenshots.noApplyButton = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'No se encontró botón de propuesta', elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
      }
      log('2. Botón "Enviar propuesta" clickeado');

      // 3. Esperar que el formulario cargue COMPLETAMENTE
      await this.bm.randomDelay(3000, 5000);

      // Esperar a que aparezca un textarea (formulario de propuesta)
      const formLoaded = await page.waitForFunction(
        () => document.querySelectorAll('textarea').length > 0,
        { timeout: 20000 }
      ).catch(() => null);

      if (!formLoaded) {
        log('3. ERROR: Formulario no cargó');
        if (debug) screenshots.noForm = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'El formulario no cargó', elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
      }

      await this.bm.randomDelay(2000, 3000);
      const formUrl = page.url();
      log(`3. Formulario cargado. URL: ${formUrl}`);

      // 4. Analizar el formulario
      const formInfo = await this._analyzeForm(page);
      log(`4. Análisis: ${JSON.stringify(formInfo)}`);

      if (debug) screenshots.formLoaded = await page.screenshot({ encoding: 'base64' }).catch(() => null);

      // 5. Rellenar la propuesta
      const textFilled = await this._fillProposalText(page, proposalText);
      log(`5. Texto rellenado: ${textFilled}`);
      if (!textFilled) {
        return { success: false, message: 'No se encontró textarea', elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }
      await this.bm.randomDelay(1000, 2000);

      // 6. Rellenar presupuesto
      if (budget) {
        const budgetFilled = await this._fillBudget(page, budget);
        log(`6. Presupuesto: ${budgetFilled}`);
        await this.bm.randomDelay(800, 1500);
      }

      // 7. Rellenar plazo
      if (deliveryDays) {
        const deliveryFilled = await this._fillDeliveryDays(page, deliveryDays);
        log(`7. Plazo: ${deliveryFilled}`);
        await this.bm.randomDelay(800, 1500);
      }

      if (debug) screenshots.beforeSubmit = await page.screenshot({ encoding: 'base64', fullPage: true }).catch(() => null);

      // 8. Scroll al fondo y click en "Enviar propuesta"
      const submitClicked = await this._clickSubmitButton(page);
      log(`8. Submit clickeado: ${submitClicked}`);

      if (!submitClicked) {
        if (debug) screenshots.noSubmitBtn = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'No se encontró botón submit', elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }

      // 9. Esperar resultado — esperar a que la página cambie
      log('9. Esperando resultado...');
      await this.bm.randomDelay(3000, 5000);

      // Verificar si la página cambió
      const afterSubmitUrl = page.url();
      log(`9. URL después de click: ${afterSubmitUrl}`);

      // Esperar un poco más para que la SPA procese
      await this.bm.randomDelay(3000, 5000);

      const finalUrl = page.url();
      log(`9. URL final: ${finalUrl}`);

      if (debug) screenshots.afterSubmit = await page.screenshot({ encoding: 'base64' }).catch(() => null);

      // 10. Verificar resultado
      const result = await this._checkSubmissionResult(page, formUrl);
      result.elapsed_ms = Date.now() - startTime;
      result.formInfo = formInfo;
      result.formUrl = formUrl;
      result.finalUrl = finalUrl;
      if (debug) result.screenshots = screenshots;

      log(`10. Resultado: ${result.success ? '✅' : '❌'} ${result.message}`);
      log(`=== FIN SUBMIT (${result.elapsed_ms}ms) ===`);
      return result;
    } catch (error) {
      log(`ERROR: ${error.message}`);
      return { success: false, message: `Error: ${error.message}`, elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
    } finally {
      await page.close();
    }
  }

  async _analyzeForm(page) {
    return page.evaluate(() => {
      const textareas = [...document.querySelectorAll('textarea')].map(t => ({
        name: t.name || t.id || '?', visible: t.offsetHeight > 10,
        placeholder: (t.placeholder || '').substring(0, 60),
      }));

      const visibleInputs = [...document.querySelectorAll('input')]
        .filter(i => i.type !== 'hidden' && i.offsetHeight > 10)
        .map(i => ({
          type: i.type, name: i.name || i.id || '?',
          placeholder: (i.placeholder || '').substring(0, 60),
          required: i.required,
        }));

      const selects = [...document.querySelectorAll('select')].map(s => ({
        name: s.name || s.id || '?', required: s.required,
        options: s.options.length,
      }));

      const buttons = [...document.querySelectorAll('button')]
        .filter(b => b.offsetHeight > 0)
        .map(b => ({
          text: (b.textContent || '').trim().substring(0, 50),
          type: b.type, disabled: b.disabled,
        }));

      return { textareas, visibleInputs, selects, buttons };
    });
  }

  async _clickApplyButton(page) {
    const textPatterns = [
      'Enviar una propuesta',
      'Enviar propuesta',
      'Send a proposal',
      'Send proposal',
      'Aplicar',
      'Apply',
    ];

    // Buscar por texto primero (más confiable que selectores CSS en MFE)
    for (const text of textPatterns) {
      const clicked = await page.evaluate(txt => {
        const elements = [...document.querySelectorAll('a, button, [role="button"]')];
        const el = elements.find(e =>
          e.textContent?.trim().toLowerCase().includes(txt.toLowerCase())
        );
        if (el) { el.click(); return true; }
        return false;
      }, text);
      if (clicked) {
        console.log(`[Submitter] Apply encontrado: "${text}"`);
        return true;
      }
    }

    // Fallback: selectores CSS
    const selectors = ['a[href*="/bid/"]', 'a[href*="/proposal/"]', 'a.btn-primary'];
    for (const sel of selectors) {
      const clicked = await this.bm.humanClick(page, sel);
      if (clicked) {
        console.log(`[Submitter] Apply encontrado: ${sel}`);
        return true;
      }
    }

    return false;
  }

  async _fillProposalText(page, text) {
    // Buscar textareas visibles
    const textareas = await page.$$('textarea');
    for (const textarea of textareas) {
      const isVisible = await page.evaluate(el => el.offsetHeight > 20 && el.offsetWidth > 50, textarea);
      if (!isVisible) continue;

      const name = await page.evaluate(el => el.name || el.id || 'unknown', textarea);
      console.log(`[Submitter] Usando textarea: ${name}`);

      await textarea.click();
      await this.bm.randomDelay(200, 400);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await this.bm.randomDelay(200, 400);

      // Escribir primeros 30 chars "humanamente"
      const humanPart = text.substring(0, 30);
      const restPart = text.substring(30);
      for (const char of humanPart) {
        await page.keyboard.type(char, { delay: 20 + Math.random() * 40 });
      }
      if (restPart) {
        await textarea.evaluate((el, content) => {
          el.value = el.value + content;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, restPart);
      }
      await textarea.evaluate(el => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      return true;
    }
    return false;
  }

  async _fillBudget(page, budget) {
    const selectors = [
      'input[name*="total"]', 'input[name*="budget"]', 'input[name*="amount"]',
      'input[name*="price"]', 'input[name*="value"]', 'input[name*="cost"]',
      'input[name*="bid"]',
    ];
    for (const sel of selectors) {
      const input = await page.$(sel);
      if (input) {
        const visible = await page.evaluate(el => el.offsetHeight > 5, input);
        if (!visible) continue;
        console.log(`[Submitter] Budget input: ${sel}`);
        await input.click({ clickCount: 3 });
        await this.bm.randomDelay(200, 400);
        await input.type(String(budget), { delay: 40 + Math.random() * 40 });
        await input.evaluate(el => {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return true;
      }
    }

    // Fallback: input type=number
    const numberInputs = await page.$$('input[type="number"]');
    for (const input of numberInputs) {
      const info = await page.evaluate(el => ({
        visible: el.offsetHeight > 5,
        name: (el.name || el.id || '').toLowerCase(),
      }), input);
      if (info.visible && !info.name.includes('day') && !info.name.includes('delivery')) {
        console.log(`[Submitter] Budget fallback: input[type=number] ${info.name}`);
        await input.click({ clickCount: 3 });
        await input.type(String(budget), { delay: 40 + Math.random() * 40 });
        await input.evaluate(el => {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return true;
      }
    }
    console.log('[Submitter] Budget: no encontrado');
    return false;
  }

  async _fillDeliveryDays(page, days) {
    const selectors = [
      'input[name*="days"]', 'input[name*="delivery"]', 'input[name*="deadline"]',
      'input[name*="time"]', 'input[name*="plazo"]', 'input[name*="duration"]',
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        console.log(`[Submitter] Delivery input: ${sel}`);
        await el.click({ clickCount: 3 });
        await el.type(String(days), { delay: 40 + Math.random() * 40 });
        await el.evaluate(e => { e.dispatchEvent(new Event('change', { bubbles: true })); });
        return true;
      }
    }

    // Buscar por placeholder
    const found = await page.evaluate((d) => {
      const inputs = [...document.querySelectorAll('input')];
      const el = inputs.find(i => {
        const ph = (i.placeholder || '').toLowerCase();
        return ph.includes('día') || ph.includes('day') || ph.includes('hora') || ph.includes('plazo');
      });
      if (el) {
        el.focus();
        el.value = String(d);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, days);
    if (found) console.log('[Submitter] Delivery: encontrado por placeholder');
    else console.log('[Submitter] Delivery: no encontrado');
    return found;
  }

  async _clickSubmitButton(page) {
    // Scroll al fondo
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.bm.randomDelay(1000, 2000);

    // Buscar el botón "Enviar propuesta" (submit del formulario)
    const btnInfo = await page.evaluate(() => {
      const allClickable = [...document.querySelectorAll('button, input[type="submit"], a')];
      const candidates = allClickable.map(el => ({
        tag: el.tagName,
        text: (el.textContent || el.value || '').trim().substring(0, 80),
        type: el.type || '',
        href: el.href || '',
        visible: el.offsetHeight > 0 && el.offsetWidth > 0,
      })).filter(c => c.visible && /(enviar|submit|send)/i.test(c.text));
      return candidates;
    });
    console.log(`[Submitter] Submit candidates: ${JSON.stringify(btnInfo)}`);

    // Click el primer candidato que coincida con "enviar propuesta"
    const clicked = await page.evaluate(() => {
      const allClickable = [...document.querySelectorAll('button, input[type="submit"], a')];

      // Primero: match exacto "enviar propuesta"
      let btn = allClickable.find(el => {
        const text = (el.textContent || el.value || '').trim().toLowerCase();
        return el.offsetHeight > 0 && (text === 'enviar propuesta' || text === 'send proposal');
      });

      // Fallback: contiene "enviar"
      if (!btn) {
        btn = allClickable.find(el => {
          const text = (el.textContent || el.value || '').trim().toLowerCase();
          return el.offsetHeight > 0 && el.tagName === 'BUTTON' && text.includes('enviar');
        });
      }

      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      }
      return false;
    });

    return clicked;
  }

  async _checkSubmissionResult(page, formUrl) {
    const currentUrl = page.url();

    // Analizar estado de la página
    const pageState = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';

      // Buscar formulario todavía presente
      const textareas = document.querySelectorAll('textarea');
      const hasVisibleTextarea = [...textareas].some(t => t.offsetHeight > 20);
      const buttons = [...document.querySelectorAll('button')];
      const hasSubmitBtn = buttons.some(b =>
        b.offsetHeight > 0 &&
        ((b.textContent || '').trim().toLowerCase() === 'enviar propuesta' ||
         (b.textContent || '').trim().toLowerCase() === 'send proposal')
      );

      // Buscar confirmación de éxito
      const successIndicators = [
        'propuesta enviada', 'proposal sent', 'tu propuesta ha sido',
        'felicitaciones', 'propuesta fue enviada', 'congratulations',
        'enviada exitosamente', 'successfully sent',
      ];
      const hasSuccess = successIndicators.some(t => bodyText.includes(t));

      // Buscar ya enviada
      const alreadySent = bodyText.includes('ya has enviado') ||
        bodyText.includes('ya enviaste') || bodyText.includes('already sent');

      // Buscar errores de validación
      const hasValidationError = bodyText.includes('campo obligatorio') ||
        bodyText.includes('required') || bodyText.includes('por favor complet');

      return {
        hasVisibleTextarea,
        hasSubmitBtn,
        hasSuccess,
        alreadySent,
        hasValidationError,
        bodyLength: bodyText.length,
      };
    });

    console.log(`[Submitter] Check result: formUrl=${formUrl}, currentUrl=${currentUrl}`);
    console.log(`[Submitter] Page state: ${JSON.stringify(pageState)}`);

    // REGLA 1: Si hay mensaje de éxito claro → success
    if (pageState.hasSuccess) {
      return { success: true, message: 'Propuesta enviada (confirmación en página)', url: currentUrl };
    }

    // REGLA 2: Si ya fue enviada antes → success
    if (pageState.alreadySent) {
      return { success: true, message: 'Propuesta ya enviada anteriormente', url: currentUrl };
    }

    // REGLA 3: Si el formulario SIGUE VISIBLE → failure
    if (pageState.hasVisibleTextarea || pageState.hasSubmitBtn) {
      const reason = pageState.hasValidationError
        ? 'Validación del formulario falló'
        : 'El formulario sigue visible — la propuesta NO se envió';
      return { success: false, message: reason, url: currentUrl, pageState };
    }

    // REGLA 4: Formulario desapareció PERO no hay confirmación → incierto, ser conservador
    // Solo reportar success si la URL realmente cambió a algo diferente
    if (currentUrl !== formUrl && !currentUrl.includes(formUrl)) {
      return { success: true, message: 'URL cambió y formulario no visible (probable éxito)', url: currentUrl, pageState };
    }

    // REGLA 5: Default → failure (conservador)
    return { success: false, message: 'No se pudo confirmar el envío. Sin confirmación clara.', url: currentUrl, pageState };
  }
}

module.exports = { ProposalSubmitter };
