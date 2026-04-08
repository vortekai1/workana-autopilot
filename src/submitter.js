const fs = require('fs');
const path = require('path');

class ProposalSubmitter {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  async submit(projectUrl, proposalText, budget, deliveryDays) {
    const page = await this.bm.newPage();
    const startTime = Date.now();
    const log = (msg) => console.log(`[Submitter] ${msg}`);

    try {
      log(`Enviando propuesta a: ${projectUrl}`);
      log(`Budget: ${budget}, Delivery: ${deliveryDays} días`);

      // 1. Navegar al proyecto
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(2000, 3000);

      // 1.5. Esperar a que Workana MFE renderice
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 15000 }
      ).catch(() => log('Timeout esperando render MFE'));
      await this.bm.randomDelay(800, 1500);

      const urlAfterLoad = page.url();
      log(`URL después de cargar: ${urlAfterLoad}`);

      // 2. Buscar y clickar "Enviar una propuesta" (con reintento)
      let applyClicked = await this._clickApplyButton(page);
      if (!applyClicked) {
        log('Botón no encontrado, reintentando en 3s...');
        await this.bm.randomDelay(2500, 4000);
        applyClicked = await this._clickApplyButton(page);
      }
      if (!applyClicked) {
        await this._saveDebugScreenshot(page, 'no-apply-button');
        return {
          success: false,
          message: 'No se encontró el botón de enviar propuesta. Puede que ya hayas aplicado o la sesión expiró.',
          elapsed_ms: Date.now() - startTime,
        };
      }
      log('Botón "Enviar propuesta" clickeado');

      // 3. Esperar a que cargue el formulario
      await this.bm.randomDelay(2000, 3000);
      await page.waitForFunction(
        () => document.querySelectorAll('textarea').length > 0,
        { timeout: 15000 }
      ).catch(() => log('Timeout esperando formulario'));
      await this.bm.randomDelay(1000, 2000);

      const formUrl = page.url();
      log(`URL del formulario: ${formUrl}`);

      // 4. Analizar el formulario
      const formInfo = await page.evaluate(() => {
        const textareas = document.querySelectorAll('textarea');
        const inputs = document.querySelectorAll('input');
        const buttons = [...document.querySelectorAll('button')];
        const submitBtn = buttons.find(b =>
          b.textContent?.trim().toLowerCase().includes('enviar propuesta')
        );
        return {
          textareaCount: textareas.length,
          inputCount: inputs.length,
          buttonCount: buttons.length,
          hasSubmitBtn: !!submitBtn,
          submitBtnText: submitBtn?.textContent?.trim() || 'N/A',
          inputNames: [...inputs].slice(0, 15).map(i => `${i.type}:${i.name || i.id || '?'}`),
        };
      });
      log(`Formulario: ${formInfo.textareaCount} textareas, ${formInfo.inputCount} inputs, submit: ${formInfo.hasSubmitBtn} ("${formInfo.submitBtnText}")`);
      log(`Inputs encontrados: ${formInfo.inputNames.join(', ')}`);

      // 5. Rellenar la propuesta (texto)
      const textFilled = await this._fillProposalText(page, proposalText);
      if (!textFilled) {
        await this._saveDebugScreenshot(page, 'no-textarea');
        return {
          success: false,
          message: 'No se encontró el campo de texto de la propuesta.',
          elapsed_ms: Date.now() - startTime,
        };
      }
      log('Texto de propuesta rellenado');
      await this.bm.randomDelay(1000, 2000);

      // 6. Rellenar presupuesto (Workana tiene formulario complejo)
      if (budget) {
        const budgetFilled = await this._fillBudget(page, budget);
        log(`Presupuesto rellenado: ${budgetFilled}`);
        await this.bm.randomDelay(800, 1500);
      }

      // 7. Rellenar plazo de entrega
      if (deliveryDays) {
        const deliveryFilled = await this._fillDeliveryDays(page, deliveryDays);
        log(`Plazo de entrega rellenado: ${deliveryFilled}`);
        await this.bm.randomDelay(800, 1500);
      }

      // 8. Screenshot ANTES de enviar (para debug)
      await this._saveDebugScreenshot(page, 'before-submit');

      // 9. Scroll al botón de enviar y click
      const submitClicked = await this._clickSubmitButton(page);
      if (!submitClicked) {
        await this._saveDebugScreenshot(page, 'no-submit-button');
        return {
          success: false,
          message: 'No se encontró el botón de enviar. Revisa manualmente.',
          elapsed_ms: Date.now() - startTime,
        };
      }
      log('Botón "Enviar propuesta" del formulario clickeado');

      // 10. Esperar resultado — puede ser navegación o cambio en página (SPA)
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        this.bm.randomDelay(8000, 10000),
      ]);
      await this.bm.randomDelay(2000, 3000);

      // 11. Screenshot DESPUÉS de enviar
      await this._saveDebugScreenshot(page, 'after-submit');

      // 12. Verificar éxito — conservador, solo reporta success si hay evidencia clara
      const result = await this._checkSubmissionResult(page, formUrl);
      result.elapsed_ms = Date.now() - startTime;

      log(`Resultado: ${result.success ? '✅' : '❌'} ${result.message} (${result.elapsed_ms}ms)`);
      return result;
    } catch (error) {
      log(`Error: ${error.message}`);
      await this._saveDebugScreenshot(page, 'error').catch(() => {});
      return { success: false, message: `Error: ${error.message}`, elapsed_ms: Date.now() - startTime };
    } finally {
      await page.close();
    }
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

  async _saveDebugScreenshot(page, label) {
    try {
      const screenshotPath = path.join('/tmp', `submit-${label}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[Submitter] Screenshot guardado: ${screenshotPath}`);
    } catch (e) {
      // No bloquear si falla el screenshot
    }
  }

  async _clickApplyButton(page) {
    const selectors = [
      'a[href*="/bid/"]',
      'a[href*="/proposal/"]',
      'a[href*="apply"]',
      '.apply-btn',
      '.send-proposal-btn',
      '.bid-button',
      'a.btn-primary',
    ];

    const textPatterns = [
      'Enviar una propuesta',
      'Enviar propuesta',
      'Enviar Propuesta',
      'Send a proposal',
      'Send proposal',
      'Aplicar',
      'Apply',
      'Proponer',
    ];

    // Intentar selectores CSS primero
    for (const sel of selectors) {
      const clicked = await this.bm.humanClick(page, sel);
      if (clicked) {
        console.log(`[Submitter] Apply button encontrado con selector: ${sel}`);
        return true;
      }
    }

    // Intentar por texto
    for (const text of textPatterns) {
      const clicked = await page.evaluate(txt => {
        const elements = [...document.querySelectorAll('a, button')];
        const el = elements.find(e =>
          e.textContent?.trim().toLowerCase().includes(txt.toLowerCase())
        );
        if (el) {
          el.click();
          return true;
        }
        return false;
      }, text);

      if (clicked) {
        console.log(`[Submitter] Apply button encontrado con texto: "${text}"`);
        await this.bm.randomDelay(500, 1000);
        return true;
      }
    }

    return false;
  }

  async _fillProposalText(page, text) {
    // Workana tiene el textarea principal para la propuesta
    // Puede haber múltiples textareas — buscamos el más grande o el primero relevante
    const textareaSelectors = [
      'textarea[name*="description"]',
      'textarea[name*="message"]',
      'textarea[name*="proposal"]',
      'textarea[name*="comment"]',
      'textarea[name*="text"]',
      'textarea.proposal-text',
      '#proposal-description',
      '#bid-description',
      'textarea',
    ];

    for (const sel of textareaSelectors) {
      const textarea = await page.$(sel);
      if (textarea) {
        // Verificar que es visible y tiene tamaño razonable
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 50 && rect.height > 30 && style.display !== 'none' && style.visibility !== 'hidden';
        }, textarea);

        if (!isVisible) continue;

        console.log(`[Submitter] Textarea encontrado con selector: ${sel}`);

        // Focus + limpiar
        await textarea.click();
        await this.bm.randomDelay(200, 400);
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.bm.randomDelay(200, 400);

        // Escribir primeros 30 chars "humanamente"
        const HUMAN_CHARS = 30;
        const humanPart = text.substring(0, HUMAN_CHARS);
        const restPart = text.substring(HUMAN_CHARS);

        for (const char of humanPart) {
          await page.keyboard.type(char, { delay: 20 + Math.random() * 40 });
        }

        // Inyectar el resto directamente
        if (restPart) {
          await textarea.evaluate(
            (el, content) => {
              el.value = el.value + content;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            },
            restPart
          );
        }

        // Trigger eventos
        await textarea.evaluate(el => {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        });

        return true;
      }
    }

    return false;
  }

  async _fillBudget(page, budget) {
    // Workana tiene un formulario de presupuesto complejo:
    // - "Valor total" / "Total value" — campo numérico principal
    // - Puede haber inputs con name "budget", "amount", "total", "price", "value"
    // - También puede haber inputs type="number"
    const selectors = [
      'input[name*="total"]',
      'input[name*="budget"]',
      'input[name*="amount"]',
      'input[name*="price"]',
      'input[name*="value"]',
      'input[name*="bid"]',
      'input[name*="cost"]',
      '#budget-input',
      '#bid-amount',
    ];

    for (const sel of selectors) {
      const input = await page.$(sel);
      if (input) {
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 10;
        }, input);
        if (!isVisible) continue;

        console.log(`[Submitter] Budget input encontrado: ${sel}`);
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

    // Fallback: buscar input type=number visible que NO sea delivery/days
    const numberInputs = await page.$$('input[type="number"]');
    for (const input of numberInputs) {
      const info = await page.evaluate(el => {
        const name = (el.name || el.id || '').toLowerCase();
        const isDelivery = name.includes('day') || name.includes('delivery') || name.includes('time');
        const rect = el.getBoundingClientRect();
        return { isDelivery, visible: rect.width > 20, name: el.name || el.id };
      }, input);

      if (!info.isDelivery && info.visible) {
        console.log(`[Submitter] Budget fallback input[type=number]: ${info.name}`);
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

    console.log('[Submitter] No se encontró campo de presupuesto');
    return false;
  }

  async _fillDeliveryDays(page, days) {
    const selectors = [
      'input[name*="days"]',
      'input[name*="delivery"]',
      'input[name*="deadline"]',
      'input[name*="time"]',
      'input[name*="plazo"]',
      'input[name*="duration"]',
      'select[name*="days"]',
      'select[name*="delivery"]',
      'select[name*="deadline"]',
    ];

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        const tagName = await page.evaluate(e => e.tagName, el);
        console.log(`[Submitter] Delivery input encontrado: ${sel} (${tagName})`);

        if (tagName === 'SELECT') {
          await el.select(String(days));
        } else {
          await el.click({ clickCount: 3 });
          await el.type(String(days), { delay: 40 + Math.random() * 40 });
        }

        await el.evaluate(e => {
          e.dispatchEvent(new Event('change', { bubbles: true }));
          e.dispatchEvent(new Event('input', { bubbles: true }));
        });

        return true;
      }
    }

    // Fallback: buscar por placeholder que mencione días/tiempo
    const found = await page.evaluate((daysVal) => {
      const inputs = [...document.querySelectorAll('input')];
      const el = inputs.find(i => {
        const ph = (i.placeholder || '').toLowerCase();
        return ph.includes('día') || ph.includes('day') || ph.includes('hora') || ph.includes('time') || ph.includes('plazo');
      });
      if (el) {
        el.value = '';
        el.value = String(daysVal);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, days);

    if (found) {
      console.log('[Submitter] Delivery encontrado por placeholder');
      return true;
    }

    console.log('[Submitter] No se encontró campo de plazo de entrega');
    return false;
  }

  async _clickSubmitButton(page) {
    // Primero scroll al fondo del formulario
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.bm.randomDelay(500, 1000);

    // Buscar botón por texto específico "Enviar propuesta" (el botón verde del formulario)
    const clickedByText = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
      // Buscar exactamente "Enviar propuesta" (el submit del formulario, no otros botones)
      const exactMatch = buttons.find(b => {
        const text = (b.textContent || b.value || '').trim().toLowerCase();
        return text === 'enviar propuesta' || text === 'send proposal';
      });
      if (exactMatch) {
        exactMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return 'exact';
      }
      // Fallback: buscar que contenga "enviar" en un botón
      const partialMatch = buttons.find(b => {
        const text = (b.textContent || b.value || '').trim().toLowerCase();
        return text.includes('enviar') || text.includes('submit') || text.includes('send');
      });
      if (partialMatch) {
        partialMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return 'partial';
      }
      return null;
    });

    if (clickedByText) {
      console.log(`[Submitter] Submit button encontrado (${clickedByText}), scrolling...`);
      await this.bm.randomDelay(800, 1500);

      // Ahora click
      const clicked = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
        const btn = buttons.find(b => {
          const text = (b.textContent || b.value || '').trim().toLowerCase();
          return text === 'enviar propuesta' || text === 'send proposal' ||
                 text.includes('enviar') || text.includes('submit') || text.includes('send');
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      return clicked;
    }

    // Fallback: selectores CSS
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      '.submit-proposal-btn',
      '.btn-submit',
    ];

    for (const sel of selectors) {
      const clicked = await this.bm.humanClick(page, sel);
      if (clicked) {
        console.log(`[Submitter] Submit button encontrado con selector: ${sel}`);
        return true;
      }
    }

    return false;
  }

  async _checkSubmissionResult(page, formUrl) {
    const currentUrl = page.url();
    console.log(`[Submitter] Verificando resultado. URL anterior: ${formUrl}, URL actual: ${currentUrl}`);

    // MÉTODO 1: Verificar si el formulario SIGUE PRESENTE
    // Si encontramos textarea + botón "Enviar propuesta" → todavía en el formulario → NO se envió
    const formCheck = await page.evaluate(() => {
      const textarea = document.querySelector('textarea');
      const buttons = [...document.querySelectorAll('button')];
      const submitBtn = buttons.find(b =>
        (b.textContent || '').trim().toLowerCase() === 'enviar propuesta' ||
        (b.textContent || '').trim().toLowerCase() === 'send proposal'
      );

      // Buscar mensajes de error de validación
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const hasValidationError = bodyText.includes('campo obligatorio') ||
        bodyText.includes('required field') ||
        bodyText.includes('este campo es requerido') ||
        bodyText.includes('por favor') && bodyText.includes('completar');

      // Buscar mensajes de éxito
      const hasSuccess = bodyText.includes('propuesta enviada') ||
        bodyText.includes('proposal sent') ||
        bodyText.includes('felicitaciones') ||
        bodyText.includes('tu propuesta ha sido') ||
        bodyText.includes('propuesta fue enviada') ||
        bodyText.includes('congratulations');

      // Buscar indicadores de que ya enviaste antes
      const alreadySent = bodyText.includes('ya has enviado') ||
        bodyText.includes('ya enviaste') ||
        bodyText.includes('already sent') ||
        bodyText.includes('already submitted');

      return {
        hasTextarea: !!textarea,
        hasSubmitBtn: !!submitBtn,
        hasValidationError,
        hasSuccess,
        alreadySent,
      };
    });

    console.log(`[Submitter] Form check: textarea=${formCheck.hasTextarea}, submitBtn=${formCheck.hasSubmitBtn}, validation=${formCheck.hasValidationError}, success=${formCheck.hasSuccess}, alreadySent=${formCheck.alreadySent}`);

    // Caso 1: Éxito claro — mensaje de confirmación
    if (formCheck.hasSuccess) {
      return {
        success: true,
        message: 'Propuesta enviada correctamente (confirmación detectada)',
        url: currentUrl,
      };
    }

    // Caso 2: Ya enviada anteriormente
    if (formCheck.alreadySent) {
      return {
        success: true,
        message: 'La propuesta ya había sido enviada anteriormente',
        url: currentUrl,
      };
    }

    // Caso 3: URL cambió Y ya no hay formulario → probablemente éxito
    if (currentUrl !== formUrl && !formCheck.hasSubmitBtn) {
      return {
        success: true,
        message: 'Propuesta probablemente enviada (URL cambió, formulario no visible)',
        url: currentUrl,
      };
    }

    // Caso 4: Formulario sigue presente → NO se envió
    if (formCheck.hasTextarea && formCheck.hasSubmitBtn) {
      const reason = formCheck.hasValidationError
        ? 'Error de validación en el formulario'
        : 'El formulario sigue visible después de intentar enviar';
      return {
        success: false,
        message: `${reason}. La propuesta NO se envió.`,
        url: currentUrl,
      };
    }

    // Caso 5: Indeterminado — ser conservador, reportar fallo
    return {
      success: false,
      message: 'No se pudo confirmar el envío. Sin evidencia clara de éxito.',
      url: currentUrl,
    };
  }
}

module.exports = { ProposalSubmitter };
