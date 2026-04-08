class ProposalSubmitter {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  async submit(projectUrl, proposalText, budget, deliveryDays, debug = true) {
    const page = await this.bm.newPage();
    const startTime = Date.now();
    const log = (msg) => console.log(`[Submitter] ${msg}`);
    const screenshots = {};

    try {
      log(`=== INICIO SUBMIT ===`);
      log(`URL: ${projectUrl}`);
      log(`Budget: ${budget}, Debug: ${debug}`);

      // 1. Navegar al proyecto
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(2000, 3000);
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 15000 }
      ).catch(() => log('Timeout esperando render MFE'));
      await this.bm.randomDelay(2000, 3000);

      // 1b. Cerrar banner de cookies si existe (bloquea clicks)
      await this._dismissCookieConsent(page);

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

      // 3. Esperar que el formulario cargue — puede aparecer "Área protegida"
      await this.bm.randomDelay(3000, 5000);

      // Verificar si Workana pide confirmar contraseña ("Área protegida")
      const protectedHandled = await this._handleProtectedArea(page, log);
      if (protectedHandled) {
        log('3a. "Área protegida" detectada y resuelta, esperando formulario...');
        await this.bm.randomDelay(3000, 5000);
      }

      const formLoaded = await page.waitForFunction(
        () => document.querySelectorAll('textarea').length > 0,
        { timeout: 20000 }
      ).catch(() => null);

      if (!formLoaded) {
        // Puede haber aparecido "Área protegida" después de la primera espera
        const retryProtected = await this._handleProtectedArea(page, log);
        if (retryProtected) {
          log('3b. "Área protegida" detectada en retry, esperando formulario...');
          await this.bm.randomDelay(3000, 5000);
          await page.waitForFunction(
            () => document.querySelectorAll('textarea').length > 0,
            { timeout: 20000 }
          ).catch(() => null);
        }
        // Verificar de nuevo si el formulario cargó
        const hasTextarea = await page.evaluate(() => document.querySelectorAll('textarea').length > 0);
        if (!hasTextarea) {
          log('3. ERROR: Formulario no cargó');
          if (debug) screenshots.noForm = await page.screenshot({ encoding: 'base64' }).catch(() => null);
          return { success: false, message: 'El formulario no cargó', elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
        }
      }

      await this.bm.randomDelay(2000, 3000);
      const formUrl = page.url();
      log(`3. Formulario cargado. URL: ${formUrl}`);

      // 4. Analizar el formulario
      const formInfo = await this._analyzeForm(page);
      log(`4. Análisis: ${JSON.stringify(formInfo)}`);
      if (debug) screenshots.formLoaded = await page.screenshot({ encoding: 'base64' }).catch(() => null);

      // =============================================
      // FLUJO DE RELLENADO (orden exacto Workana)
      // =============================================

      // 5. Rellenar texto de propuesta (textarea bid[content])
      const textFilled = await this._fillProposalText(page, proposalText);
      log(`5. Texto rellenado: ${textFilled}`);
      if (!textFilled) {
        return { success: false, message: 'No se encontró textarea', elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }
      await this.bm.randomDelay(1000, 2000);

      // 6. Rellenar presupuesto (Valor total o 40 si es por horas)
      const budgetFilled = await this._fillBudget(page, budget);
      log(`6. Presupuesto: ${budgetFilled}`);
      await this.bm.randomDelay(800, 1500);

      // Verificar que seguimos en el formulario
      if (page.url() !== formUrl) {
        log(`⚠️ URL cambió tras presupuesto: ${page.url()}`);
        if (debug) screenshots.urlChanged = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: `Navegación inesperada tras presupuesto: ${page.url()}`, elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }

      // 7. Seleccionar habilidades visibles (hasta 5, sin abrir desplegable)
      const skillsSelected = await this._selectSkills(page);
      log(`7. Habilidades seleccionadas: ${skillsSelected}`);
      await this.bm.randomDelay(800, 1500);

      // Verificar que seguimos en el formulario
      if (page.url() !== formUrl) {
        log(`⚠️ URL cambió tras habilidades: ${page.url()}`);
        return { success: false, message: `Navegación inesperada tras habilidades: ${page.url()}`, elapsed_ms: Date.now() - startTime, formInfo };
      }

      // 8. Seleccionar proyectos del portfolio (hasta 3, botón +)
      const portfolioSelected = await this._selectPortfolioProjects(page);
      log(`8. Proyectos portfolio seleccionados: ${portfolioSelected}`);
      await this.bm.randomDelay(800, 1500);

      // Verificar que seguimos en el formulario
      if (page.url() !== formUrl) {
        log(`⚠️ URL cambió tras portfolio: ${page.url()}`);
        return { success: false, message: `Navegación inesperada tras portfolio: ${page.url()}`, elapsed_ms: Date.now() - startTime, formInfo };
      }

      // NO rellenamos delivery time (no obligatorio)

      // 9. Rellenar task scopes (Workana exige alcance para cada tarea)
      const tasksFilled = await this._fillTaskScopes(page);
      log(`9. Task scopes rellenados: ${tasksFilled}`);
      await this.bm.randomDelay(500, 1000);

      // Verificar "Área protegida" antes de submit (puede aparecer durante interacción)
      const preSubmitProtected = await this._handleProtectedArea(page, log);
      if (preSubmitProtected) {
        log('8b. "Área protegida" resuelta antes de submit, esperando formulario...');
        await this.bm.randomDelay(3000, 5000);
        // Esperar que el formulario vuelva a cargar
        await page.waitForFunction(
          () => document.querySelectorAll('textarea').length > 0,
          { timeout: 20000 }
        ).catch(() => null);
        await this.bm.randomDelay(2000, 3000);
      }

      // 9b. Verificar que los campos se rellenaron correctamente en el estado del framework
      const fieldValues = await this._verifyFormState(page);
      log(`9b. Estado campos: ${JSON.stringify(fieldValues)}`);

      if (debug) screenshots.beforeSubmit = await page.screenshot({ encoding: 'base64', fullPage: true }).catch(() => null);

      // 10. Click en "Enviar propuesta/presupuesto"
      const submitClicked = await this._clickSubmitButton(page);
      log(`10. Submit clickeado: ${submitClicked}`);

      if (!submitClicked) {
        if (debug) screenshots.noSubmitBtn = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'No se encontró botón submit', elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }

      // 11. Esperar resultado — navegación O cambio en la página
      log('11. Esperando resultado (navegación o cambio en página)...');
      await Promise.race([
        page.waitForNavigation({ timeout: 10000 }).catch(() => null),
        page.waitForFunction(
          () => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('propuesta enviada') || text.includes('ya has enviado') ||
              text.includes('felicitaciones') || text.includes('proposal sent') ||
              text.includes('especifique un alcance') || text.includes('campo obligatorio');
          },
          { timeout: 10000 }
        ).catch(() => null),
      ]);
      await this.bm.randomDelay(1500, 2500);

      // 11b. Si la URL no cambió, intentar form.requestSubmit() como fallback
      if (page.url() === formUrl) {
        log('11b. URL no cambió tras click — intentando form.requestSubmit() como fallback...');
        const requestSubmitResult = await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form && typeof form.requestSubmit === 'function') {
            try { form.requestSubmit(); return 'requestSubmit OK'; } catch (e) { return `requestSubmit error: ${e.message}`; }
          }
          if (form) {
            try { form.submit(); return 'submit OK'; } catch (e) { return `submit error: ${e.message}`; }
          }
          return 'no form found';
        });
        log(`11b. Resultado fallback: ${requestSubmitResult}`);

        // Esperar de nuevo navegación/cambio
        await Promise.race([
          page.waitForNavigation({ timeout: 10000 }).catch(() => null),
          page.waitForFunction(
            () => {
              const text = document.body.innerText.toLowerCase();
              return text.includes('propuesta enviada') || text.includes('ya has enviado') ||
                text.includes('especifique un alcance') || text.includes('campo obligatorio');
            },
            { timeout: 10000 }
          ).catch(() => null),
        ]);
        await this.bm.randomDelay(2000, 3000);
      }

      const finalUrl = page.url();
      log(`11. URL final: ${finalUrl}`);

      if (debug) screenshots.afterSubmit = await page.screenshot({ encoding: 'base64' }).catch(() => null);

      // 12. Verificar resultado
      const result = await this._checkSubmissionResult(page, formUrl);
      result.elapsed_ms = Date.now() - startTime;
      result.formInfo = formInfo;
      result.fieldValues = fieldValues;
      result.formUrl = formUrl;
      result.finalUrl = finalUrl;
      if (debug) result.screenshots = screenshots;

      log(`12. Resultado: ${result.success ? '✅' : '❌'} ${result.message}`);
      log(`=== FIN SUBMIT (${result.elapsed_ms}ms) ===`);
      return result;
    } catch (error) {
      log(`ERROR: ${error.message}`);
      return { success: false, message: `Error: ${error.message}`, elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
    } finally {
      await page.close();
    }
  }

  // =============================================
  // HANDLER "ÁREA PROTEGIDA" (Workana pide confirmar contraseña)
  // =============================================

  async _handleProtectedArea(page, log) {
    const isProtected = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      return bodyText.includes('área protegida') || bodyText.includes('confirmar contraseña') ||
        bodyText.includes('protected area') || bodyText.includes('confirm password');
    });

    if (!isProtected) return false;

    log('⚠️ "Área protegida" detectada — ingresando contraseña...');

    // Buscar input de contraseña
    const passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
      log('ERROR: No se encontró input de contraseña en "Área protegida"');
      return false;
    }

    // Escribir contraseña
    await passwordInput.click();
    await this.bm.randomDelay(300, 500);
    await passwordInput.type(this.bm.password, { delay: 30 + Math.random() * 50 });
    await this.bm.randomDelay(500, 1000);

    // Click en "Confirmar contraseña"
    const confirmed = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"], a')];
      const btn = buttons.find(el => {
        const text = ((el.textContent || '') + ' ' + (el.value || '')).trim().toLowerCase();
        return el.offsetHeight > 0 && (text.includes('confirmar') || text.includes('confirm') || text.includes('continuar'));
      });
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!confirmed) {
      // Fallback: Enter
      await page.keyboard.press('Enter');
    }

    log('Contraseña enviada, esperando redirección...');
    await this.bm.randomDelay(3000, 5000);

    // Esperar a que desaparezca "Área protegida"
    await page.waitForFunction(
      () => !document.body.innerText.toLowerCase().includes('área protegida'),
      { timeout: 15000 }
    ).catch(() => {});

    return true;
  }

  // =============================================
  // ANALIZAR FORMULARIO
  // =============================================

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
          value: (i.value || '').substring(0, 60),
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

  // =============================================
  // CLICK BOTÓN "ENVIAR UNA PROPUESTA" (página del proyecto)
  // =============================================

  async _clickApplyButton(page) {
    const textPatterns = [
      'Enviar una propuesta',
      'Enviar propuesta',
      'Send a proposal',
      'Send proposal',
      'Aplicar',
      'Apply',
    ];

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

  // =============================================
  // RELLENAR TEXTO DE PROPUESTA (textarea bid[content])
  // =============================================

  async _fillProposalText(page, text) {
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

      // Escribir primeros 30 chars "humanamente", resto inyectado
      const humanPart = text.substring(0, 30);
      const restPart = text.substring(30);
      for (const char of humanPart) {
        await page.keyboard.type(char, { delay: 20 + Math.random() * 40 });
      }
      // Inyectar el texto completo usando native setter (compatible con React/Vue/Angular MFE)
      // el.value = ... directo NO actualiza el estado del framework → submit falla silenciosamente
      await textarea.evaluate((el, fullText) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(el, fullText);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, text);
      return true;
    }
    return false;
  }

  // =============================================
  // SELECCIONAR HABILIDADES VISIBLES (hasta 5)
  // =============================================

  async _selectSkills(page) {
    const count = await page.evaluate(() => {
      // Solo checkboxes de habilidades — lo más seguro
      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter(cb => {
          const label = cb.closest('label') || cb.parentElement;
          return !cb.checked && (cb.offsetHeight > 0 || (label && label.offsetHeight > 0));
        });

      let clicked = 0;
      for (const cb of checkboxes) {
        if (clicked >= 5) break;
        const label = cb.closest('label') || cb.parentElement;
        if (label && label.offsetHeight > 0) {
          label.click();
          clicked++;
        }
      }
      return clicked;
    });

    return count;
  }

  // =============================================
  // SELECCIONAR PROYECTOS PORTFOLIO (hasta 3, botón +)
  // =============================================

  async _selectPortfolioProjects(page) {
    // Scroll a la sección de portfolio para que sea visible
    await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div')];
      const heading = headings.find(h => h.textContent?.includes('Destaca tus proyectos'));
      if (heading) heading.scrollIntoView({ block: 'center' });
    });
    await this.bm.randomDelay(500, 1000);

    const count = await page.evaluate(() => {
      // SEGURO: Solo buscar elementos que NO sean button[type="submit"]
      // para evitar enviar el formulario accidentalmente
      const addButtons = [...document.querySelectorAll('a, span, div, [role="button"]')]
        .filter(el => {
          // NUNCA clickar button[type=submit]
          if (el.tagName === 'BUTTON') return false;
          if (el.offsetHeight === 0 || el.offsetWidth === 0) return false;
          const text = (el.textContent || '').trim();
          if (text === '+') return true;
          return false;
        });

      let clicked = 0;
      for (const btn of addButtons) {
        if (clicked >= 3) break;
        btn.click();
        clicked++;
      }
      return clicked;
    });

    return count;
  }

  // =============================================
  // RELLENAR TASK SCOPES (Workana valida alcance de cada tarea)
  // =============================================

  async _fillTaskScopes(page) {
    // Obtener nombres de selects sin valor + primera opción válida para cada uno
    const scopeData = await page.evaluate(() => {
      return [...document.querySelectorAll('select[name*="bid[task]"][name*="[scope]"]')]
        .filter(sel => !sel.value || sel.value === '')
        .map(sel => {
          const validOpt = [...sel.options].find(o => o.value && o.value !== '');
          return { name: sel.name, value: validOpt ? validOpt.value : null };
        })
        .filter(d => d.value !== null);
    });

    // Usar page.select() nativo de Puppeteer (compatible con cualquier framework MFE)
    // sel.value = ... directo NO actualiza el estado del framework → submit falla silenciosamente
    let filled = 0;
    for (const { name, value } of scopeData) {
      try {
        await page.select(`select[name="${name}"]`, value);
        filled++;
      } catch (e) {
        console.log(`[Submitter] Error en scope ${name}: ${e.message}`);
      }
    }
    return filled;
  }

  // =============================================
  // RELLENAR PRESUPUESTO
  // =============================================

  async _fillBudget(page, budget) {
    // Detectar si es proyecto por horas o fijo
    const isHourly = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      // Si dice "valor hora" o "hourly" es por horas
      return bodyText.includes('valor hora') || bodyText.includes('hourly') ||
        bodyText.includes('por hora') || bodyText.includes('per hour');
    });

    // Si es por horas, siempre 40€/h. Si es fijo, usar el budget de la propuesta
    const amount = isHourly ? 40 : budget;
    console.log(`[Submitter] Budget: ${isHourly ? 'HOURLY (40€/h)' : `FIXED (${budget})`} → ${amount}`);

    // Workana usa bid[amount] como campo principal (required)
    const selectors = [
      'input[name="bid[amount]"]',
      'input[name*="amount"]',
      'input[name*="total"]',
      'input[name*="budget"]',
    ];

    for (const sel of selectors) {
      const input = await page.$(sel);
      if (input) {
        const info = await page.evaluate(el => ({
          visible: el.offsetHeight > 5,
          name: el.name,
          currentValue: el.value,
        }), input);
        if (!info.visible) continue;
        console.log(`[Submitter] Budget input: ${sel} (name=${info.name}, current=${info.currentValue})`);
        await input.click({ clickCount: 3 });
        await this.bm.randomDelay(200, 400);
        await input.type(String(amount), { delay: 40 + Math.random() * 40 });
        await input.evaluate(el => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        });
        return `${amount} (${isHourly ? 'hourly' : 'fixed'})`;
      }
    }
    console.log('[Submitter] Budget: no encontrado');
    return false;
  }

  // =============================================
  // CLICK BOTÓN "ENVIAR PROPUESTA" (submit del formulario)
  // =============================================

  async _clickSubmitButton(page) {
    // Scroll al fondo
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.bm.randomDelay(1000, 2000);

    // Cerrar cookies una vez más por si reaparecieron
    await this._dismissCookieConsent(page);
    await this.bm.randomDelay(500, 800);

    // Marcar el botón submit con data attribute para clickarlo con Puppeteer nativo
    const found = await page.evaluate(() => {
      const allClickable = [...document.querySelectorAll('button, input[type="submit"], a, [role="button"]')];

      // 1. Match exacto por textContent O value (incluye "enviar presupuesto")
      const exactTexts = ['enviar propuesta', 'enviar presupuesto', 'send proposal', 'send budget'];
      let btn = allClickable.find(el => {
        const tc = (el.textContent || '').trim().toLowerCase();
        const val = (el.value || '').trim().toLowerCase();
        return el.offsetHeight > 0 && exactTexts.some(t => tc === t || val === t);
      });

      // 2. Contiene "enviar propuesta" o "enviar presupuesto"
      if (!btn) {
        btn = allClickable.find(el => {
          const tc = (el.textContent || '').trim().toLowerCase();
          const val = (el.value || '').trim().toLowerCase();
          return el.offsetHeight > 0 && (
            tc.includes('enviar propuesta') || val.includes('enviar propuesta') ||
            tc.includes('enviar presupuesto') || val.includes('enviar presupuesto')
          );
        });
      }

      // 3. input[type="submit"] visible (Workana usa <input>, no <button>)
      if (!btn) {
        btn = document.querySelector('input[type="submit"]');
        if (btn && btn.offsetHeight === 0) btn = null;
      }

      // 4. Cualquier elemento con "enviar" visible (último recurso)
      if (!btn) {
        btn = allClickable.find(el => {
          const tc = (el.textContent || '').trim().toLowerCase();
          const val = (el.value || '').trim().toLowerCase();
          return el.offsetHeight > 0 && (tc.includes('enviar') || val.includes('enviar'));
        });
      }

      if (btn) {
        // Marcar para click nativo de Puppeteer
        btn.setAttribute('data-wk-submit', '1');
        btn.scrollIntoView({ block: 'center' });
        return {
          found: true,
          tag: btn.tagName, type: btn.type,
          text: (btn.textContent || '').trim().substring(0, 40),
          value: (btn.value || '').substring(0, 40),
        };
      }
      return { found: false };
    });

    console.log(`[Submitter] Submit target: ${JSON.stringify(found)}`);
    if (!found.found) return false;

    // Click NATIVO de Puppeteer (simula mouse real: mouseover→mousedown→mouseup→click)
    // Esto es más fiable que el.click() programático para formularios MFE
    try {
      await page.click('[data-wk-submit="1"]');
      console.log('[Submitter] Click nativo OK');
    } catch (e) {
      // Fallback: click programático
      console.log(`[Submitter] Click nativo falló (${e.message}), usando programático...`);
      await page.evaluate(() => {
        const btn = document.querySelector('[data-wk-submit="1"]');
        if (btn) btn.click();
      });
    }

    return true;
  }

  // =============================================
  // VERIFICAR RESULTADO DEL ENVÍO
  // =============================================

  async _checkSubmissionResult(page, formUrl) {
    const currentUrl = page.url();

    const pageState = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';

      // Formulario todavía presente
      const textareas = document.querySelectorAll('textarea');
      const hasVisibleTextarea = [...textareas].some(t => t.offsetHeight > 20);

      // Buscar input[type=submit] o botón enviar todavía visible
      const submitInput = document.querySelector('input[type="submit"]');
      const hasSubmitInput = submitInput && submitInput.offsetHeight > 0;
      const hasSubmitBtn = hasSubmitInput ||
        [...document.querySelectorAll('button')].some(b =>
          b.offsetHeight > 0 &&
          ((b.textContent || '').trim().toLowerCase().includes('enviar'))
        );

      // Confirmación de éxito
      const successIndicators = [
        'propuesta enviada', 'proposal sent', 'tu propuesta ha sido',
        'felicitaciones', 'propuesta fue enviada', 'congratulations',
        'enviada exitosamente', 'successfully sent',
      ];
      const hasSuccess = successIndicators.some(t => bodyText.includes(t));

      // Ya enviada
      const alreadySent = bodyText.includes('ya has enviado') ||
        bodyText.includes('ya enviaste') || bodyText.includes('already sent');

      // Errores de validación
      const hasValidationError = bodyText.includes('campo obligatorio') ||
        bodyText.includes('required field') || bodyText.includes('por favor complet') ||
        bodyText.includes('especifique un alcance') || bodyText.includes('alcance válido');

      return {
        hasVisibleTextarea,
        hasSubmitBtn,
        hasSuccess,
        alreadySent,
        hasValidationError,
        bodyLength: bodyText.length,
      };
    });

    console.log(`[Submitter] Check: formUrl=${formUrl}, currentUrl=${currentUrl}`);
    console.log(`[Submitter] State: ${JSON.stringify(pageState)}`);

    // REGLA 1: Texto de éxito claro → success
    if (pageState.hasSuccess) {
      return { success: true, message: 'Propuesta enviada (confirmación en página)', url: currentUrl };
    }

    // REGLA 2: Ya enviada antes → success
    if (pageState.alreadySent) {
      return { success: true, message: 'Propuesta ya enviada anteriormente', url: currentUrl };
    }

    // REGLA 3: Error de validación → failure
    if (pageState.hasValidationError) {
      return { success: false, message: 'Validación del formulario falló', url: currentUrl, pageState };
    }

    // REGLA 3b: Formulario sigue visible con botón submit → failure
    if (pageState.hasVisibleTextarea && pageState.hasSubmitBtn) {
      return { success: false, message: 'El formulario sigue visible — la propuesta NO se envió', url: currentUrl, pageState };
    }

    // REGLA 4: URL cambió a inbox/conversación → éxito (Workana redirige tras enviar)
    if (currentUrl.includes('/inbox/')) {
      return { success: true, message: 'Propuesta enviada (redirigido a inbox)', url: currentUrl, pageState };
    }

    // REGLA 4b: URL cambió y formulario no visible → probable éxito
    if (currentUrl !== formUrl && !pageState.hasVisibleTextarea) {
      return { success: true, message: 'URL cambió y formulario no visible (probable éxito)', url: currentUrl, pageState };
    }

    // REGLA 4c: URL cambió significativamente (no solo query params) → probable éxito
    const formPath = formUrl.split('?')[0];
    const currentPath = currentUrl.split('?')[0];
    if (currentPath !== formPath && !pageState.hasSubmitBtn) {
      return { success: true, message: 'URL cambió y botón submit desapareció (probable éxito)', url: currentUrl, pageState };
    }

    // REGLA 5: Default → failure (conservador)
    // Capturar texto de la página para diagnosticar errores ocultos
    const bodySnippet = await page.evaluate(() => {
      return (document.body?.innerText || '').substring(0, 2000);
    }).catch(() => '');
    return { success: false, message: 'No se pudo confirmar el envío', url: currentUrl, pageState, bodySnippet };
  }

  // =============================================
  // VERIFICAR ESTADO DE CAMPOS DESPUÉS DE RELLENAR
  // =============================================

  async _verifyFormState(page) {
    return page.evaluate(() => {
      const result = {};

      // Textarea (propuesta)
      const textarea = document.querySelector('textarea[name="bid[content]"]') ||
        [...document.querySelectorAll('textarea')].find(t => t.offsetHeight > 20);
      result.proposalText = textarea ? textarea.value.substring(0, 100) + (textarea.value.length > 100 ? '...' : '') : 'NO ENCONTRADO';
      result.proposalLength = textarea ? textarea.value.length : 0;

      // Budget
      const amountInput = document.querySelector('input[name="bid[amount]"]');
      result.budgetAmount = amountInput ? amountInput.value : 'NO ENCONTRADO';

      // Hourly rate
      const hoursInput = document.querySelector('input[name="bid[hours]"]');
      result.hourlyRate = hoursInput ? hoursInput.value : 'NO ENCONTRADO';

      // Task scopes
      const scopes = [...document.querySelectorAll('select[name*="bid[task]"][name*="[scope]"]')];
      result.taskScopesTotal = scopes.length;
      result.taskScopesFilled = scopes.filter(s => s.value && s.value !== '').length;
      result.taskScopesEmpty = scopes.filter(s => !s.value || s.value === '').length;

      // Skills (checkboxes marcados)
      const checkedSkills = [...document.querySelectorAll('input[type="checkbox"]:checked')];
      result.skillsSelected = checkedSkills.length;

      return result;
    });
  }

  // =============================================
  // CERRAR BANNER DE COOKIES (bloquea clicks en el formulario)
  // =============================================

  async _dismissCookieConsent(page) {
    const dismissed = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const cookieBtn = buttons.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text.includes('aceptar todas las cookies') || text.includes('accept all cookies') ||
          text.includes('aceptar cookies') || text.includes('accept cookies');
      });
      if (cookieBtn && cookieBtn.offsetHeight > 0) {
        cookieBtn.click();
        return true;
      }
      return false;
    });
    if (dismissed) {
      console.log('[Submitter] Cookie consent cerrado');
      await this.bm.randomDelay(500, 1000);
    }
    return dismissed;
  }
}

module.exports = { ProposalSubmitter };
