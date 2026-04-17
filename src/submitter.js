class ProposalSubmitter {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  async submit(projectUrl, proposalText, budget, deliveryDays, debug = true) {
    let page = await this.bm.newPage();
    const startTime = Date.now();
    const log = (msg) => console.log(`[Submitter] ${msg}`);
    const screenshots = {};
    // UN SOLO INTENTO — reintentar causa duplicados porque el submit SÍ funciona
    // pero la detección de éxito falla. Mejor fallar una vez que enviar 2x.
    const MAX_SUBMIT_ATTEMPTS = 1;
    const MAX_TOTAL_TIME_MS = 210000; // 3.5 min — abortar antes del enqueue timeout (5 min)
    const isTimedOut = () => (Date.now() - startTime) > MAX_TOTAL_TIME_MS;

    try {
      log(`=== INICIO SUBMIT ===`);
      log(`URL: ${projectUrl}`);
      log(`Budget: ${budget}, Debug: ${debug}`);

      // =============================================
      // BUCLE DE REINTENTOS — hasta MAX_SUBMIT_ATTEMPTS intentos completos
      // Cada intento: navegar → rellenar → enviar → verificar
      // Si el resultado es ambiguo, re-visita para confirmar antes de reintentar
      // Excepciones (timeouts, page crashes) NO rompen el bucle
      // Abort global si se supera MAX_TOTAL_TIME_MS
      // =============================================

      let lastResult = null;

      for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
        // Abort global si llevamos demasiado tiempo
        if (isTimedOut()) {
          log(`⏱️ Tiempo total excedido (${Math.round((Date.now()-startTime)/1000)}s) — abortando`);
          break;
        }

        if (attempt > 1) {
          log(`\n🔄 === REINTENTO ${attempt}/${MAX_SUBMIT_ATTEMPTS} ===`);
          await this.bm.randomDelay(3000, 5000); // Delay entre reintentos
        }

        try {
          // Verificar que la página sigue funcional (puede haberse crasheado)
          try {
            await page.evaluate(() => true);
          } catch (_pageErr) {
            log('Página rota — creando nueva...');
            try { await page.close(); } catch (_) {}
            page = await this.bm.newPage();
          }

          const attemptResult = await this._singleSubmitAttempt(
            page, projectUrl, proposalText, budget, deliveryDays, debug, screenshots, log, attempt
          );

          if (attemptResult.success) {
            attemptResult.elapsed_ms = Date.now() - startTime;
            attemptResult.attempt = attempt;
            if (debug) attemptResult.screenshots = screenshots;
            log(`✅ Éxito en intento ${attempt}/${MAX_SUBMIT_ATTEMPTS} (${attemptResult.elapsed_ms}ms)`);
            log(`=== FIN SUBMIT ===`);
            return attemptResult;
          }

          lastResult = attemptResult;
          log(`❌ Intento ${attempt}/${MAX_SUBMIT_ATTEMPTS} fallido: ${attemptResult.message}`);

          // Si es un error terminal (no tiene sentido reintentar), salir
          if (attemptResult._terminal) {
            log('Error terminal — no se reintenta');
            break;
          }

        } catch (attemptError) {
          // Excepción dura (timeout, page crash, network) — NO rompe el bucle
          log(`💥 Excepción en intento ${attempt}: ${attemptError.message}`);
          lastResult = { success: false, message: `Excepción en intento ${attempt}: ${attemptError.message}` };

          // Recrear página para el siguiente intento
          try { await page.close(); } catch (_) {}
          try {
            page = await this.bm.newPage();
          } catch (newPageErr) {
            log(`No se pudo crear nueva página: ${newPageErr.message}`);
            break; // Sin página no podemos continuar
          }
        }

        // Antes de reintentar: verificar si realmente se envió (re-visitar proyecto)
        if (attempt < MAX_SUBMIT_ATTEMPTS && !isTimedOut()) {
          log('Verificando si se envió antes de reintentar...');
          try {
            const alreadySent = await this._verifyAlreadySent(page, projectUrl, log);
            if (alreadySent) {
              const result = {
                success: true,
                message: `Propuesta enviada (verificado en reintento ${attempt + 1})`,
                attempt,
                verified: true,
                elapsed_ms: Date.now() - startTime,
              };
              if (debug) result.screenshots = screenshots;
              log(`✅ Verificación confirmó envío — no es necesario reintentar`);
              log(`=== FIN SUBMIT ===`);
              return result;
            }
          } catch (verifyErr) {
            log(`Error en verificación: ${verifyErr.message}`);
            // Recrear página si la verificación crasheó
            try { await page.close(); } catch (_) {}
            try { page = await this.bm.newPage(); } catch (_) {}
          }
        }
      }

      // Todos los intentos fallaron
      if (!lastResult) lastResult = { success: false, message: 'Todos los intentos fallaron' };
      lastResult.elapsed_ms = Date.now() - startTime;
      lastResult.attempts = MAX_SUBMIT_ATTEMPTS;
      if (debug) lastResult.screenshots = screenshots;
      log(`=== FIN SUBMIT — TODOS LOS INTENTOS FALLARON (${lastResult.elapsed_ms}ms) ===`);
      return lastResult;

    } catch (error) {
      log(`ERROR FATAL: ${error.message}`);
      return { success: false, message: `Error fatal: ${error.message}`, elapsed_ms: Date.now() - startTime, screenshots: debug ? screenshots : undefined };
    } finally {
      try { await page.close(); } catch (_) {}
    }
  }

  // =============================================
  // INTENTO INDIVIDUAL DE SUBMIT (un ciclo completo: navegar → rellenar → enviar)
  // =============================================

  async _singleSubmitAttempt(page, projectUrl, proposalText, budget, deliveryDays, debug, screenshots, log, attempt) {

    // 1. Navegar al proyecto
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await this.bm.randomDelay(1500, 2500);
    await page.waitForFunction(
      () => document.body.innerText.length > 500,
      { timeout: 10000 }
    ).catch(() => log('Timeout esperando render MFE'));
    await this.bm.randomDelay(1500, 2500);

    // 1b. Cerrar banner de cookies si existe (bloquea clicks)
    await this._dismissCookieConsent(page);

    // 1c. Verificar si ya se envió la propuesta (puede haber funcionado en intento previo)
    const alreadyApplied = await this._checkIfAlreadyApplied(page);
    if (alreadyApplied.sent) {
      return { success: true, message: `Propuesta ya enviada (${alreadyApplied.reason})`, _terminal: false };
    }

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
      if (debug) screenshots[`noApplyButton_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
      // Si el botón no aparece tras 2 intentos, el proyecto probablemente no acepta propuestas
      // (ej: "Evaluando propuestas", cerrado, >50 propuestas). Marcar como terminal.
      return { success: false, message: 'No se encontró botón de propuesta — proyecto posiblemente cerrado', _terminal: true };
    }
    log('2. Botón "Enviar propuesta" clickeado');

    // 3. Esperar que el formulario cargue — puede aparecer "Área protegida"
    await this.bm.randomDelay(2000, 3000);

    // Verificar si Workana pide confirmar contraseña ("Área protegida")
    const protectedHandled = await this._handleProtectedArea(page, log);
    if (protectedHandled) {
      log('3a. "Área protegida" detectada y resuelta, esperando formulario...');
      await this.bm.randomDelay(2000, 3000);
    }

    const formLoaded = await page.waitForFunction(
      () => document.querySelectorAll('textarea').length > 0,
      { timeout: 15000 }
    ).catch(() => null);

    if (!formLoaded) {
      // Puede haber aparecido "Área protegida" después de la primera espera
      const retryProtected = await this._handleProtectedArea(page, log);
      if (retryProtected) {
        log('3b. "Área protegida" detectada en retry, esperando formulario...');
        await this.bm.randomDelay(2000, 3000);
        await page.waitForFunction(
          () => document.querySelectorAll('textarea').length > 0,
          { timeout: 15000 }
        ).catch(() => null);
      }
      // Verificar de nuevo si el formulario cargó
      const hasTextarea = await page.evaluate(() => document.querySelectorAll('textarea').length > 0);
      if (!hasTextarea) {
        log('3. ERROR: Formulario no cargó');
        if (debug) screenshots[`noForm_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
        return { success: false, message: 'El formulario no cargó', _terminal: false };
      }
    }

    await this.bm.randomDelay(1500, 2500);
    const formUrl = page.url();
    log(`3. Formulario cargado. URL: ${formUrl}`);

    // 4. Analizar el formulario
    const formInfo = await this._analyzeForm(page);
    log(`4. Análisis: ${JSON.stringify(formInfo)}`);
    if (debug && attempt === 1) screenshots.formLoaded = await page.screenshot({ encoding: 'base64' }).catch(() => null);

    // =============================================
    // FLUJO DE RELLENADO (orden exacto Workana)
    // =============================================

    // 5. Rellenar texto de propuesta (textarea bid[content])
    const textFilled = await this._fillProposalText(page, proposalText);
    log(`5. Texto rellenado: ${textFilled}`);
    if (!textFilled) {
      return { success: false, message: 'No se encontró textarea', formInfo, formUrl, _terminal: false };
    }
    await this.bm.randomDelay(1000, 2000);

    // 6. Rellenar presupuesto (Valor total o 40 si es por horas)
    const budgetFilled = await this._fillBudget(page, budget);
    log(`6. Presupuesto: ${budgetFilled}`);
    await this.bm.randomDelay(800, 1500);

    // Verificar que seguimos en el formulario
    if (page.url() !== formUrl) {
      log(`⚠️ URL cambió tras presupuesto: ${page.url()}`);
      if (debug) screenshots[`urlChanged_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
      return { success: false, message: `Navegación inesperada tras presupuesto: ${page.url()}`, formInfo, _terminal: false };
    }

    // 7. Seleccionar habilidades visibles (hasta 5, sin abrir desplegable)
    const skillsSelected = await this._selectSkills(page);
    log(`7. Habilidades seleccionadas: ${skillsSelected}`);
    await this.bm.randomDelay(800, 1500);

    // Verificar que seguimos en el formulario
    if (page.url() !== formUrl) {
      log(`⚠️ URL cambió tras habilidades: ${page.url()}`);
      return { success: false, message: `Navegación inesperada tras habilidades: ${page.url()}`, formInfo, _terminal: false };
    }

    // 8. Seleccionar proyectos del portfolio (hasta 3, botón +)
    const portfolioSelected = await this._selectPortfolioProjects(page);
    log(`8. Proyectos portfolio seleccionados: ${portfolioSelected}`);
    await this.bm.randomDelay(800, 1500);

    // Verificar que seguimos en el formulario
    if (page.url() !== formUrl) {
      log(`⚠️ URL cambió tras portfolio: ${page.url()}`);
      return { success: false, message: `Navegación inesperada tras portfolio: ${page.url()}`, formInfo, _terminal: false };
    }

    // 8b. Rellenar delivery time
    const deliveryFilled = await this._fillDeliveryTime(page, deliveryDays);
    log(`8b. Delivery time: ${deliveryFilled}`);
    await this.bm.randomDelay(500, 1000);

    // 9. Rellenar task scopes (Workana exige alcance para cada tarea)
    const tasksFilled = await this._fillTaskScopes(page);
    log(`9. Task scopes rellenados: ${tasksFilled}`);
    await this.bm.randomDelay(500, 1000);

    // Verificar "Área protegida" antes de submit (puede aparecer durante interacción)
    const preSubmitProtected = await this._handleProtectedArea(page, log);
    if (preSubmitProtected) {
      log('9a. "Área protegida" resuelta antes de submit, esperando formulario...');
      await this.bm.randomDelay(3000, 5000);
      // Esperar que el formulario vuelva a cargar
      await page.waitForFunction(
        () => document.querySelectorAll('textarea').length > 0,
        { timeout: 20000 }
      ).catch(() => null);
      await this.bm.randomDelay(2000, 3000);

      // RE-RELLENAR campos — el redirect de "Área protegida" puede vaciar el formulario
      log('9a. Re-rellenando campos tras "Área protegida"...');
      const reTextFilled = await this._fillProposalText(page, proposalText);
      log(`9a. Re-texto: ${reTextFilled}`);
      await this.bm.randomDelay(500, 1000);
      const reBudgetFilled = await this._fillBudget(page, budget);
      log(`9a. Re-presupuesto: ${reBudgetFilled}`);
      await this.bm.randomDelay(500, 1000);
      await this._selectSkills(page);
      await this.bm.randomDelay(500, 1000);
      await this._fillTaskScopes(page);
      await this.bm.randomDelay(500, 1000);
    }

    // 9b. Verificar que los campos se rellenaron correctamente en el estado del framework
    const fieldValues = await this._verifyFormState(page);
    log(`9b. Estado campos: ${JSON.stringify(fieldValues)}`);

    // 9c. GATE: Abortar si los campos críticos están vacíos (el framework no los reconoció)
    if (fieldValues.proposalLength === 0) {
      log('❌ ABORT: Texto de propuesta vacío — execCommand no funcionó');
      if (debug) screenshots[`emptyFields_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
      return { success: false, message: 'ABORT: Texto de propuesta vacío en el DOM — el framework no reconoció el texto', fieldValues, formInfo, formUrl, _terminal: false };
    }
    if (!fieldValues.budgetAmount || fieldValues.budgetAmount === 'NO ENCONTRADO' || fieldValues.budgetAmount === '') {
      log('⚠️ Budget vacío — continuando igualmente (puede ser por horas)');
    }
    if (fieldValues.taskScopesTotal > 0 && fieldValues.taskScopesEmpty > 0) {
      log(`⚠️ ${fieldValues.taskScopesEmpty}/${fieldValues.taskScopesTotal} task scopes vacíos`);
    }

    // Delay extra para que el framework MFE procese todos los eventos
    await this.bm.randomDelay(2000, 3000);

    if (debug) screenshots[`beforeSubmit_${attempt}`] = await page.screenshot({ encoding: 'base64', fullPage: true }).catch(() => null);

    // 10. Enviar formulario
    // Estrategia: click nativo en el botón submit primero (más fiable — simula acción real del usuario),
    // luego requestSubmit() como fallback solo si el click no funcionó.
    // NOTA: requestSubmit() puede fallar si hay múltiples forms en la página (ej: chat lateral)
    // y activar el form incorrecto, causando redirección a /jobs.
    log('10. Enviando formulario...');

    const submitInfo = await this._findSubmitButton(page);
    log(`10. Submit target: ${JSON.stringify(submitInfo)}`);

    if (!submitInfo.found && !submitInfo.hasForm) {
      if (debug) screenshots[`noSubmitBtn_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
      return { success: false, message: 'No se encontró botón submit ni formulario', formInfo, _terminal: false };
    }

    // Scroll al botón submit y cerrar cookies antes de submit
    if (submitInfo.found) {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-wk-submit="1"]');
        if (btn) btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    await this.bm.randomDelay(1000, 2000);
    await this._dismissCookieConsent(page);
    await this.bm.randomDelay(500, 800);

    let submitMethod = 'none';

    // 10a. Prioridad: click nativo en el botón submit (simula usuario real)
    if (submitInfo.found) {
      try {
        await page.click('[data-wk-submit="1"]');
        submitMethod = 'nativeClick';
        log('10a. Click nativo en botón submit OK');
      } catch (e) {
        // Fallback: click programático en el mismo botón
        log(`10a. Click nativo falló (${e.message}), usando programático...`);
        await page.evaluate(() => {
          const btn = document.querySelector('[data-wk-submit="1"]');
          if (btn) btn.click();
        });
        submitMethod = 'programmaticClick';
      }
    }

    log(`10. Método de submit: ${submitMethod}`);

    if (submitMethod === 'none' && !submitInfo.hasForm) {
      if (debug) screenshots[`noSubmitBtn_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);
      return { success: false, message: 'No se pudo enviar el formulario', formInfo, _terminal: false };
    }

    // 11. Esperar resultado — navegación O cambio en la página
    // IMPORTANTE: Solo UN submit. NO reintentar con requestSubmit ni clicks adicionales.
    // Si el click del paso 10 funcionó pero Workana tarda en procesar, los re-submits
    // interfieren y causan estados inconsistentes.
    log('11. Esperando resultado (hasta 15s para navegación o cambio en página)...');
    await this._waitForSubmitResult(page);

    const finalUrl = page.url();
    log(`11. URL final: ${finalUrl}`);

    if (debug) screenshots[`afterSubmit_${attempt}`] = await page.screenshot({ encoding: 'base64' }).catch(() => null);

    // 12. Verificar resultado
    let result = await this._checkSubmissionResult(page, formUrl);

    // 12b. VERIFICACIÓN SECUNDARIA: si el resultado es fallo NO terminal,
    // esperar un poco más y re-visitar el proyecto para confirmar
    if (!result.success && !result._terminal) {
      log('12b. Resultado incierto — verificación secundaria re-visitando proyecto...');
      await this.bm.randomDelay(3000, 5000);
      try {
        const alreadySent = await this._verifyAlreadySent(page, projectUrl, log);
        if (alreadySent) {
          log('12b. ✅ Verificación secundaria confirmó envío');
          result = {
            success: true,
            message: 'Propuesta enviada (verificado re-visitando proyecto)',
            verified: true,
            url: finalUrl,
          };
        }
      } catch (verifyErr) {
        log(`12b. Error en verificación secundaria: ${verifyErr.message}`);
      }
    }

    result.formInfo = formInfo;
    result.fieldValues = fieldValues;
    result.formUrl = formUrl;
    result.finalUrl = finalUrl;
    result.attempt = attempt;

    return result;
  }

  // =============================================
  // VERIFICAR SI LA PROPUESTA YA FUE ENVIADA (re-visitar proyecto)
  // =============================================

  async _verifyAlreadySent(page, projectUrl, log) {
    // Verificar solo re-visitando la página del proyecto (rápido)
    // Eliminada verificación vía /my_projects — añadía ~60s y causaba timeouts
    try {
      await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await this.bm.randomDelay(2000, 3000);
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 10000 }
      ).catch(() => {});

      const result = await this._checkIfAlreadyApplied(page);
      if (result.sent) {
        log(`✅ Re-visita confirmó envío: ${result.reason}`);
        return true;
      }
      log(`Re-visita proyecto: ${result.reason}`);
    } catch (e) {
      log(`Error verificando en proyecto: ${e.message}`);
    }

    return false;
  }

  // =============================================
  // VERIFICACIÓN ROBUSTA: ¿ya apliqué a este proyecto?
  // Combina texto + ausencia del botón "Enviar propuesta"
  // =============================================

  async _checkIfAlreadyApplied(page) {
    return page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';

      // 1. Texto explícito de que ya se envió
      const sentTexts = [
        'ya has enviado', 'ya enviaste', 'already sent',
        'propuesta enviada', 'tu propuesta ha sido',
        'ya aplicaste', 'ya has aplicado', 'already applied',
      ];
      const textMatch = sentTexts.find(t => bodyText.includes(t));
      if (textMatch) {
        return { sent: true, reason: `texto "${textMatch}" encontrado` };
      }

      // 2. Comprobar si el botón "Enviar propuesta" está presente
      const applyTexts = [
        'envía una propuesta', 'enviar una propuesta',
        'envía propuesta', 'enviar propuesta',
        'send a proposal', 'send proposal',
        'aplicar a este proyecto', 'apply to this project',
      ];
      const allClickable = [...document.querySelectorAll('a, button, [role="button"]')];
      const applyButton = allClickable.find(el => {
        if (el.offsetHeight === 0) return false;
        const text = (el.textContent || '').trim().toLowerCase();
        return applyTexts.some(t => text.includes(t));
      });

      if (applyButton) {
        // Botón presente → definitivamente no se ha enviado
        return { sent: false, reason: 'botón "Enviar propuesta" todavía visible' };
      }

      // 3. Botón AUSENTE + sin texto confirmatorio → NO es prueba de envío
      //    El botón puede faltar porque:
      //    - El proyecto cerró admisión ("Evaluando propuestas")
      //    - El MFE no renderizó la sección
      //    - Workana bloqueó temporalmente
      //    NUNCA asumir envío sin confirmación explícita de texto
      return { sent: false, reason: 'botón ausente pero sin texto de confirmación — no se considera enviado' };
    });
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

      // Formularios — capturar action y method para diagnóstico
      const forms = [...document.querySelectorAll('form')].map(f => ({
        action: f.action, method: f.method, id: f.id || '?',
        inputCount: f.querySelectorAll('input').length,
      }));

      // Hidden inputs — pueden contener CSRF tokens o datos requeridos
      const hiddenInputs = [...document.querySelectorAll('input[type="hidden"]')].map(i => ({
        name: i.name || '?',
        hasValue: !!(i.value && i.value.length > 0),
        valueLength: (i.value || '').length,
      }));

      return { textareas, visibleInputs, selects, buttons, forms, hiddenInputs };
    });
  }

  // =============================================
  // CLICK BOTÓN "ENVIAR UNA PROPUESTA" (página del proyecto)
  // =============================================

  async _clickApplyButton(page) {
    const textPatterns = [
      'Envía una propuesta',
      'Enviar una propuesta',
      'Envía propuesta',
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

      // Click + limpiar contenido existente
      await textarea.click();
      await this.bm.randomDelay(200, 400);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await this.bm.randomDelay(200, 400);

      // Escribir primeros 30 chars "humanamente" (anti-detección)
      const humanPart = text.substring(0, 30);
      const restPart = text.substring(30);
      for (const char of humanPart) {
        await page.keyboard.type(char, { delay: 20 + Math.random() * 40 });
      }

      // Insertar el resto con execCommand('insertText')
      // Esto pasa por el pipeline del navegador igual que teclear —
      // TODOS los frameworks MFE (React/Vue/Angular) lo reconocen.
      // A diferencia del native setter, que puede fallar silenciosamente.
      await textarea.evaluate((el, rest) => {
        el.focus();
        document.execCommand('insertText', false, rest);
      }, restPart);

      await this.bm.randomDelay(300, 600);

      // Dispatch eventos para que el framework MFE reconozca los cambios
      // 'input' es crítico para React, 'change' para Angular/Vue, 'blur' finaliza
      await textarea.evaluate(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
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
      // Buscar checkboxes de skills (name="skill-*")
      const skillCheckboxes = [...document.querySelectorAll('input[type="checkbox"][name^="skill-"]')]
        .filter(cb => !cb.checked);

      let clicked = 0;
      for (const cb of skillCheckboxes) {
        if (clicked >= 5) break;

        // Estrategia 1: buscar label con for= que apunte al checkbox
        const labelFor = cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null;
        if (labelFor && labelFor.offsetHeight > 0) {
          labelFor.click();
          clicked++;
          continue;
        }

        // Estrategia 2: label ancestro
        const labelAncestor = cb.closest('label');
        if (labelAncestor && labelAncestor.offsetHeight > 0) {
          labelAncestor.click();
          clicked++;
          continue;
        }

        // Estrategia 3: padre visible (custom UI con CSS)
        const parent = cb.parentElement;
        if (parent && parent.offsetHeight > 0) {
          parent.click();
          clicked++;
          continue;
        }

        // Estrategia 4: click directo en el checkbox (aunque sea invisible, JS lo procesa)
        cb.click();
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
    // Usar siempre el budget que viene del caller (n8n calcula el precio correcto)
    // La detección "hourly" por texto de la página causaba falsos positivos:
    // el formulario de Workana SIEMPRE muestra "Valor/hora" aunque sea proyecto fijo
    const amount = budget;
    console.log(`[Submitter] Budget: ${amount}`);

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
        // Triple-click para seleccionar todo + borrar
        await input.click({ clickCount: 3 });
        await this.bm.randomDelay(200, 400);
        await page.keyboard.press('Backspace');
        await this.bm.randomDelay(100, 200);
        // Insertar con execCommand (universalmente reconocido por frameworks MFE)
        await input.evaluate((el, val) => {
          el.focus();
          document.execCommand('insertText', false, String(val));
        }, amount);
        await this.bm.randomDelay(200, 400);
        // Dispatch eventos para que el framework MFE reconozca los cambios
        await input.evaluate(el => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        });
        return `${amount}`;
      }
    }
    console.log('[Submitter] Budget: no encontrado');
    return false;
  }

  // =============================================
  // RELLENAR DELIVERY TIME (bid[deliveryTime])
  // =============================================

  async _fillDeliveryTime(page, deliveryDays) {
    // Siempre rellenar delivery time — Workana puede requerirlo aunque el HTML diga required=false
    if (!deliveryDays) deliveryDays = 7; // Default: 7 días

    const input = await page.$('input[name="bid[deliveryTime]"]');
    if (!input) {
      console.log('[Submitter] DeliveryTime: campo no encontrado');
      return 'campo no encontrado';
    }

    const text = `${deliveryDays} días`;
    await input.click({ clickCount: 3 });
    await this.bm.randomDelay(200, 400);
    await page.keyboard.press('Backspace');
    await this.bm.randomDelay(100, 200);
    await input.evaluate((el, val) => {
      el.focus();
      document.execCommand('insertText', false, val);
    }, text);
    await this.bm.randomDelay(200, 400);
    await input.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    console.log(`[Submitter] DeliveryTime: ${text}`);
    return text;
  }

  // =============================================
  // ENCONTRAR BOTÓN "ENVIAR PROPUESTA" (submit del formulario)
  // Solo marca el botón con data-wk-submit="1" sin clickarlo
  // =============================================

  async _findSubmitButton(page) {
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

      // 3. input[type="submit"] visible con value que contenga "enviar"
      if (!btn) {
        const submitInputs = [...document.querySelectorAll('input[type="submit"]')];
        btn = submitInputs.find(el => el.offsetHeight > 0 && (el.value || '').toLowerCase().includes('enviar'));
      }

      // 4. Cualquier input[type="submit"] visible como último recurso
      if (!btn) {
        btn = document.querySelector('input[type="submit"]');
        if (btn && btn.offsetHeight === 0) btn = null;
      }

      // Verificar si hay formulario disponible (para requestSubmit)
      const textarea = document.querySelector('textarea[name="bid[content]"]');
      const form = textarea ? textarea.closest('form') : document.querySelector('form');
      const hasForm = !!form;

      if (btn) {
        // Marcar para click nativo de Puppeteer
        btn.setAttribute('data-wk-submit', '1');
        btn.scrollIntoView({ block: 'center' });

        // Verificar si hay un overlay que podría interceptar el click
        const rect = btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        const isObstructed = topElement && topElement !== btn && !btn.contains(topElement);

        return {
          found: true, hasForm,
          tag: btn.tagName, type: btn.type,
          text: (btn.textContent || '').trim().substring(0, 40),
          value: (btn.value || '').substring(0, 40),
          isObstructed,
          obstructedBy: isObstructed ? (topElement.tagName + '.' + topElement.className).substring(0, 60) : null,
        };
      }
      return { found: false, hasForm };
    });

    return found;
  }

  // =============================================
  // VERIFICAR RESULTADO DEL ENVÍO
  // =============================================

  async _checkSubmissionResult(page, formUrl) {
    const currentUrl = page.url();

    const pageState = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';

      // Confirmación EXPLÍCITA de éxito — textos que SOLO aparecen tras enviar
      const successIndicators = [
        'propuesta enviada', 'proposal sent', 'tu propuesta ha sido',
        'felicitaciones', 'propuesta fue enviada', 'congratulations',
        'enviada exitosamente', 'successfully sent',
      ];
      const hasSuccess = successIndicators.some(t => bodyText.includes(t));

      // Ya enviada anteriormente
      const alreadySent = bodyText.includes('ya has enviado') ||
        bodyText.includes('ya enviaste') || bodyText.includes('already sent');

      // Errores de validación
      const hasValidationError = bodyText.includes('campo obligatorio') ||
        bodyText.includes('required field') || bodyText.includes('por favor complet') ||
        bodyText.includes('especifique un alcance') || bodyText.includes('alcance válido');

      // Formulario todavía presente
      const hasVisibleTextarea = [...document.querySelectorAll('textarea')].some(t => t.offsetHeight > 20);
      const submitInput = document.querySelector('input[type="submit"]');
      const hasSubmitBtn = submitInput && submitInput.offsetHeight > 0;

      return { hasSuccess, alreadySent, hasValidationError, hasVisibleTextarea, hasSubmitBtn, bodyLength: bodyText.length };
    });

    console.log(`[Submitter] Check: formUrl=${formUrl}, currentUrl=${currentUrl}`);
    console.log(`[Submitter] State: ${JSON.stringify(pageState)}`);

    // =============================================
    // DETECCIÓN ANTI-DUPLICADOS
    // Filosofía: si el formulario desapareció y la URL cambió,
    // es MUY probable que se envió. Mejor reportar éxito
    // que reintentar y causar un duplicado.
    // Solo reportar fallo cuando es EVIDENTE (validación, formulario visible).
    // =============================================

    // ÉXITO 1: Texto explícito de confirmación
    if (pageState.hasSuccess) {
      return { success: true, message: 'Propuesta enviada (confirmación en página)', url: currentUrl, pageState };
    }

    // ÉXITO 2: Ya enviada anteriormente
    if (pageState.alreadySent) {
      return { success: true, message: 'Propuesta ya enviada anteriormente', url: currentUrl, pageState };
    }

    // ÉXITO 3: URL redirigió a /inbox/ o /messages/ (redirección normal de Workana)
    if (currentUrl.includes('/inbox/') || currentUrl.includes('/messages/index/')) {
      return { success: true, message: 'Propuesta enviada (redirigido a mensajes)', url: currentUrl, pageState };
    }

    // FALLO CLARO 1: Error de validación (campos vacíos, alcance no seleccionado)
    if (pageState.hasValidationError) {
      return { success: false, message: 'Error de validación del formulario', url: currentUrl, pageState, _terminal: true };
    }

    // FALLO CLARO 2: Formulario sigue visible con botón submit → no se envió
    if (pageState.hasVisibleTextarea && pageState.hasSubmitBtn) {
      return { success: false, message: 'Formulario sigue visible — no se envió', url: currentUrl, pageState, _terminal: false };
    }

    // ÉXITO PROBABLE: URL cambió Y formulario desapareció → Workana procesó el envío
    // Esto cubre redirecciones a /messages/, /jobs, dashboard, etc.
    // NUNCA reintentar en este caso — riesgo de duplicado
    if (currentUrl !== formUrl && !pageState.hasVisibleTextarea) {
      return { success: true, message: `Propuesta probablemente enviada (URL cambió a ${currentUrl}, formulario desapareció)`, url: currentUrl, pageState };
    }

    // URL no cambió pero formulario desapareció → estado incierto, marcar terminal
    if (currentUrl === formUrl && !pageState.hasVisibleTextarea) {
      return { success: false, message: 'URL no cambió pero formulario desapareció — estado incierto', url: currentUrl, pageState, _terminal: true };
    }

    // Cualquier otro caso → fallo terminal (no reintentar)
    return { success: false, message: 'Estado desconocido tras submit', url: currentUrl, pageState, _terminal: true };
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

      // Delivery time
      const deliveryInput = document.querySelector('input[name="bid[deliveryTime]"]');
      result.deliveryTime = deliveryInput ? deliveryInput.value : 'NO ENCONTRADO';

      return result;
    });
  }

  // =============================================
  // ESPERAR RESULTADO DEL SUBMIT (navegación o cambio en página)
  // =============================================

  async _waitForSubmitResult(page) {
    await Promise.race([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      page.waitForFunction(
        () => {
          const text = document.body.innerText.toLowerCase();
          return text.includes('propuesta enviada') || text.includes('ya has enviado') ||
            text.includes('felicitaciones') || text.includes('proposal sent') ||
            text.includes('especifique un alcance') || text.includes('campo obligatorio');
        },
        { timeout: 15000 }
      ).catch(() => null),
    ]);
    await this.bm.randomDelay(2000, 3000);
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
