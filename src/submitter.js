class ProposalSubmitter {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  async submit(projectUrl, proposalText, budget, deliveryDays) {
    const page = await this.bm.newPage();
    const startTime = Date.now();

    try {
      console.log(`[Submitter] Enviando propuesta a: ${projectUrl}`);

      // 1. Navegar al proyecto
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(2000, 3000);

      // 1.5. Esperar a que Workana MFE renderice el contenido dinámico
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 15000 }
      ).catch(() => console.log('[Submitter] Timeout esperando render MFE'));
      await this.bm.randomDelay(800, 1500);

      // 2. Buscar y clickar el botón de "Enviar propuesta" (con reintento)
      let applyClicked = await this._clickApplyButton(page);
      if (!applyClicked) {
        console.log('[Submitter] Botón no encontrado, reintentando en 3s...');
        await this.bm.randomDelay(2500, 4000);
        applyClicked = await this._clickApplyButton(page);
      }
      if (!applyClicked) {
        return {
          success: false,
          message: 'No se encontró el botón de enviar propuesta. Puede que ya hayas aplicado o la sesión expiró.',
          elapsed_ms: Date.now() - startTime,
        };
      }

      await this.bm.randomDelay(1500, 2500);

      // 3. Esperar a que cargue el formulario de propuesta
      await page.waitForSelector('textarea, form', { timeout: 10000 }).catch(() => {});
      await this.bm.randomDelay(800, 1500);

      // 4. Rellenar la propuesta (texto) — optimizado para velocidad
      const textFilled = await this._fillProposalText(page, proposalText);
      if (!textFilled) {
        return {
          success: false,
          message: 'No se encontró el campo de texto de la propuesta.',
          elapsed_ms: Date.now() - startTime,
        };
      }

      await this.bm.randomDelay(1000, 2000);

      // 5. Rellenar presupuesto
      if (budget) {
        await this._fillBudget(page, budget);
        await this.bm.randomDelay(800, 1500);
      }

      // 6. Rellenar plazo de entrega
      if (deliveryDays) {
        await this._fillDeliveryDays(page, deliveryDays);
        await this.bm.randomDelay(800, 1500);
      }

      // 7. Scroll suave al botón de enviar
      await page.evaluate(() => {
        const btn = document.querySelector(
          'button[type="submit"], input[type="submit"], [class*="submit"]'
        );
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await this.bm.randomDelay(1000, 2000);

      // 8. Enviar
      const submitted = await this._clickSubmitButton(page);
      if (!submitted) {
        return {
          success: false,
          message: 'No se encontró el botón de enviar. Revisa manualmente.',
          elapsed_ms: Date.now() - startTime,
        };
      }

      // 9. Esperar resultado
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await this.bm.randomDelay(1500, 2500);

      // 10. Verificar éxito
      const result = await this._checkSubmissionResult(page);
      result.elapsed_ms = Date.now() - startTime;

      console.log(`[Submitter] Resultado: ${result.message} (${result.elapsed_ms}ms)`);
      return result;
    } catch (error) {
      console.error(`[Submitter] Error: ${error.message}`);
      return { success: false, message: `Error: ${error.message}`, elapsed_ms: Date.now() - startTime };
    } finally {
      await page.close();
    }
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

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
      'Send Proposal',
      'Aplicar',
      'Apply',
      'Proponer',
    ];

    // Intentar selectores CSS primero
    for (const sel of selectors) {
      const clicked = await this.bm.humanClick(page, sel);
      if (clicked) return true;
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
        await this.bm.randomDelay(500, 1000);
        return true;
      }
    }

    return false;
  }

  async _fillProposalText(page, text) {
    const textareaSelectors = [
      'textarea[name*="description"]',
      'textarea[name*="message"]',
      'textarea[name*="proposal"]',
      'textarea[name*="comment"]',
      'textarea.proposal-text',
      '#proposal-description',
      '#bid-description',
      'textarea',
    ];

    for (const sel of textareaSelectors) {
      const textarea = await page.$(sel);
      if (textarea) {
        // Limpiar campo
        await textarea.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await this.bm.randomDelay(200, 400);

        // Estrategia híbrida: primeros ~30 chars humanos, resto inyectado
        // Esto es suficiente para parecer humano sin tardar 60s
        const HUMAN_CHARS = 30;
        const humanPart = text.substring(0, HUMAN_CHARS);
        const restPart = text.substring(HUMAN_CHARS);

        // Escribir inicio con delay humano
        for (const char of humanPart) {
          await page.keyboard.type(char, { delay: 20 + Math.random() * 40 });
        }

        // Inyectar el resto directamente (simula pegado)
        if (restPart) {
          await textarea.evaluate(
            (el, content) => {
              el.value = el.value + content;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            },
            restPart
          );
        }

        // Trigger eventos de cambio
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
    const selectors = [
      'input[name*="budget"]',
      'input[name*="amount"]',
      'input[name*="price"]',
      'input[name*="bid"]',
      '#budget-input',
      '#bid-amount',
      'input[type="number"]',
    ];

    for (const sel of selectors) {
      const input = await page.$(sel);
      if (input) {
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

    return false;
  }

  async _fillDeliveryDays(page, days) {
    const selectors = [
      'input[name*="days"]',
      'input[name*="delivery"]',
      'input[name*="deadline"]',
      'select[name*="days"]',
      'select[name*="delivery"]',
      'select[name*="deadline"]',
    ];

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        const tagName = await page.evaluate(e => e.tagName, el);

        if (tagName === 'SELECT') {
          await el.select(String(days));
        } else {
          await el.click({ clickCount: 3 });
          await el.type(String(days), { delay: 40 + Math.random() * 40 });
        }

        await el.evaluate(e => {
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });

        return true;
      }
    }

    return false;
  }

  async _clickSubmitButton(page) {
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      '.submit-proposal-btn',
      '.btn-submit',
    ];

    const textPatterns = [
      'Enviar',
      'Submit',
      'Send',
      'Proponer',
      'Confirmar',
    ];

    for (const sel of selectors) {
      const clicked = await this.bm.humanClick(page, sel);
      if (clicked) return true;
    }

    for (const text of textPatterns) {
      const clicked = await page.evaluate(txt => {
        const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
        const btn = buttons.find(b =>
          b.textContent?.trim().toLowerCase().includes(txt.toLowerCase()) ||
          b.value?.toLowerCase().includes(txt.toLowerCase())
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, text);

      if (clicked) return true;
    }

    return false;
  }

  async _checkSubmissionResult(page) {
    const currentUrl = page.url();

    const isStillOnForm =
      currentUrl.includes('/bid/') ||
      currentUrl.includes('/proposal/new') ||
      currentUrl.includes('/apply');

    const pageResult = await page.evaluate(() => {
      const successTexts = ['propuesta enviada', 'proposal sent', 'éxito', 'success', 'gracias', 'thank you'];
      const errorTexts = ['error', 'no se pudo', 'failed', 'ya has enviado', 'already sent'];

      const bodyText = document.body?.innerText?.toLowerCase() || '';

      const hasSuccess = successTexts.some(t => bodyText.includes(t));
      const hasError = errorTexts.some(t => bodyText.includes(t));

      return { hasSuccess, hasError };
    });

    if (pageResult.hasSuccess || !isStillOnForm) {
      return {
        success: true,
        message: 'Propuesta enviada correctamente',
        url: currentUrl,
      };
    }

    if (pageResult.hasError) {
      return {
        success: false,
        message: 'Error detectado en la página al enviar. Revisa manualmente.',
        url: currentUrl,
      };
    }

    return {
      success: false,
      message: 'No se pudo confirmar el envío. Verifica manualmente.',
      url: currentUrl,
    };
  }
}

module.exports = { ProposalSubmitter };
