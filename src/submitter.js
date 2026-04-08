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
      log(`Budget: ${budget}, Debug: ${debug}`);

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

      // 6. Seleccionar habilidades visibles (hasta 5, sin abrir desplegable)
      const skillsSelected = await this._selectSkills(page);
      log(`6. Habilidades seleccionadas: ${skillsSelected}`);
      await this.bm.randomDelay(800, 1500);

      // 7. Seleccionar proyectos del portfolio (hasta 3, botón +)
      const portfolioSelected = await this._selectPortfolioProjects(page);
      log(`7. Proyectos portfolio seleccionados: ${portfolioSelected}`);
      await this.bm.randomDelay(800, 1500);

      // 8. Rellenar presupuesto (Valor total o 40 si es por horas)
      const budgetFilled = await this._fillBudget(page, budget);
      log(`8. Presupuesto: ${budgetFilled}`);
      await this.bm.randomDelay(800, 1500);

      // NO rellenamos delivery time (no obligatorio)

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

      if (debug) screenshots.beforeSubmit = await page.screenshot({ encoding: 'base64', fullPage: true }).catch(() => null);

      // 9. Click en "Enviar propuesta/presupuesto"
      const submitClicked = await this._clickSubmitButton(page);
      log(`9. Submit clickeado: ${submitClicked}`);

      if (!submitClicked) {
        if (debug) screenshots.noSubmitBtn = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'No se encontró botón submit', elapsed_ms: Date.now() - startTime, formInfo, screenshots: debug ? screenshots : undefined };
      }

      // 10. Esperar resultado
      log('10. Esperando resultado...');
      await this.bm.randomDelay(5000, 8000);

      const finalUrl = page.url();
      log(`10. URL final: ${finalUrl}`);

      if (debug) screenshots.afterSubmit = await page.screenshot({ encoding: 'base64' }).catch(() => null);

      // 11. Verificar resultado
      const result = await this._checkSubmissionResult(page, formUrl);
      result.elapsed_ms = Date.now() - startTime;
      result.formInfo = formInfo;
      result.formUrl = formUrl;
      result.finalUrl = finalUrl;
      if (debug) result.screenshots = screenshots;

      log(`11. Resultado: ${result.success ? '✅' : '❌'} ${result.message}`);
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

  // =============================================
  // SELECCIONAR HABILIDADES VISIBLES (hasta 5)
  // =============================================

  async _selectSkills(page) {
    const count = await page.evaluate(() => {
      // Buscar chips/botones de habilidades que sean clickables
      // Workana muestra habilidades como tags/chips con checkbox o botón
      const skillElements = [];

      // Patrón 1: checkboxes de habilidades
      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter(cb => {
          // Solo los que estén en la zona de habilidades (no en otras secciones)
          const parent = cb.closest('[class*="skill"], [class*="habilidad"], [class*="tag"]');
          const label = cb.parentElement;
          return cb.offsetHeight > 0 || (label && label.offsetHeight > 0);
        });

      if (checkboxes.length > 0) {
        // Click en las primeras 5 visibles no marcadas
        let clicked = 0;
        for (const cb of checkboxes) {
          if (clicked >= 5) break;
          if (cb.checked) continue;
          const label = cb.closest('label') || cb.parentElement;
          if (label && label.offsetHeight > 0) {
            label.click();
            clicked++;
          }
        }
        return clicked;
      }

      // Patrón 2: botones/spans clickables con texto de habilidad
      // Buscar sección "Destaca tus habilidades" y sus elementos clickables
      const allElements = [...document.querySelectorAll('button, span, div, label, a')];
      const skillSection = document.body.innerText.indexOf('Destaca tus habilidades');
      if (skillSection === -1) return 0;

      // Buscar elementos tipo "tag/chip" que no estén ya seleccionados
      const chips = allElements.filter(el => {
        if (el.offsetHeight === 0 || el.offsetWidth === 0) return false;
        const rect = el.getBoundingClientRect();
        // Chips suelen ser pequeños (20-50px de alto)
        if (rect.height < 15 || rect.height > 60) return false;
        if (rect.width < 30 || rect.width > 300) return false;
        // Verificar que tiene texto corto (nombre de habilidad)
        const text = (el.textContent || '').trim();
        if (text.length < 1 || text.length > 40) return false;
        // No seleccionar botones genéricos
        if (/buscar|agregar|enviar|cancelar|aceptar|cookie/i.test(text)) return false;
        return true;
      });

      // Intentar clickar los primeros chips de habilidades
      let clicked = 0;
      for (const chip of chips.slice(0, 5)) {
        chip.click();
        clicked++;
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
      const text = document.body.innerText;
      const idx = text.indexOf('Destaca tus proyectos');
      if (idx > -1) {
        // Buscar el heading y scrollear a él
        const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div')];
        const heading = headings.find(h => h.textContent?.includes('Destaca tus proyectos'));
        if (heading) heading.scrollIntoView({ block: 'center' });
      }
    });
    await this.bm.randomDelay(500, 1000);

    const count = await page.evaluate(() => {
      // Buscar botones "+" en las tarjetas de portfolio
      // Workana muestra hasta 6 proyectos con un botón "+" para seleccionar
      const addButtons = [...document.querySelectorAll('button, a, [role="button"], span')]
        .filter(el => {
          if (el.offsetHeight === 0 || el.offsetWidth === 0) return false;
          const text = (el.textContent || '').trim();
          // Botón "+" o "Agregar" dentro de cards de portfolio
          if (text === '+' || text === 'Seleccionar' || text === 'Select') return true;
          // También buscar SVG de "+" dentro del elemento
          if (el.querySelector('svg') && text === '') {
            const rect = el.getBoundingClientRect();
            // Botones pequeños tipo "+" suelen ser <50px
            if (rect.width < 60 && rect.height < 60) return true;
          }
          return false;
        });

      // Click en las primeras 3
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

    // Debug: listar todos los candidatos
    const btnInfo = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button, input[type="submit"], a, [role="button"]')];
      return all.filter(el => el.offsetHeight > 0).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        text: (el.textContent || '').trim().substring(0, 60),
        value: (el.value || '').substring(0, 60),
      }));
    });
    console.log(`[Submitter] All clickable: ${JSON.stringify(btnInfo)}`);

    const clicked = await page.evaluate(() => {
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
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return {
          clicked: true,
          tag: btn.tagName, type: btn.type,
          text: (btn.textContent || '').trim().substring(0, 40),
          value: (btn.value || '').substring(0, 40),
        };
      }
      return { clicked: false };
    });

    console.log(`[Submitter] Submit result: ${JSON.stringify(clicked)}`);
    return clicked.clicked;
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
        bodyText.includes('required field') || bodyText.includes('por favor complet');

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

    // REGLA 3: Formulario sigue visible → failure
    if (pageState.hasVisibleTextarea && pageState.hasSubmitBtn) {
      const reason = pageState.hasValidationError
        ? 'Validación del formulario falló'
        : 'El formulario sigue visible — la propuesta NO se envió';
      return { success: false, message: reason, url: currentUrl, pageState };
    }

    // REGLA 4: Formulario desapareció y URL cambió → probable éxito
    if (currentUrl !== formUrl && !pageState.hasVisibleTextarea) {
      return { success: true, message: 'URL cambió y formulario no visible (probable éxito)', url: currentUrl, pageState };
    }

    // REGLA 5: Default → failure (conservador)
    return { success: false, message: 'No se pudo confirmar el envío', url: currentUrl, pageState };
  }
}

module.exports = { ProposalSubmitter };
