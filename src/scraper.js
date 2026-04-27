class WorkanaScraper {
  constructor(browserManager) {
    this.bm = browserManager;
  }

  // Scrape una página de resultados de búsqueda
  async scrapeSearchPage(category = 'it-programming', pageNum = 1, language = 'es') {
    const page = await this.bm.newPage();

    try {
      const url = `https://www.workana.com/jobs?category=${category}&language=${language}&page=${pageNum}`;
      console.log(`[Scraper] Navegando a: ${url}`);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(2000, 4000);

      // Scroll gradual para cargar contenido lazy
      await this._gradualScroll(page);

      // Extraer proyectos del HTML
      const projects = await page.evaluate(() => {
        const items = [];

        // ================================================
        // SELECTORES DE WORKANA
        // Workana renderiza proyectos en contenedores con
        // distintos selectores según su versión del frontend.
        // Si cambia el HTML, ajustar estos selectores.
        // ================================================
        const containers = document.querySelectorAll(
          // Intentar varios selectores conocidos
          '.project-item, ' +
          '.js-project, ' +
          '[data-project], ' +
          '.job-item, ' +
          '.project-card, ' +
          'article.project, ' +
          '.results-list > div, ' +
          '.project-list-item'
        );

        // Si no encontramos contenedores específicos, intentar
        // buscar por estructura de enlaces a /job/
        if (containers.length === 0) {
          const links = document.querySelectorAll('a[href*="/job/"]');
          const seen = new Set();

          links.forEach(link => {
            const href = link.href;
            if (seen.has(href)) return;
            seen.add(href);

            // Subir al contenedor padre más cercano que tenga sentido
            let container = link.closest('div[class], article, li, section');
            if (!container) container = link.parentElement?.parentElement;

            if (container) {
              const title = link.textContent?.trim() || '';
              const desc =
                container.querySelector('p, .description, [class*="desc"]')?.textContent?.trim() || '';
              const budgetEl = container.querySelector(
                '[class*="budget"], [class*="price"], [class*="amount"], .h4, h4'
              );
              const skillEls = container.querySelectorAll(
                '[class*="skill"] a, [class*="skill"] span, .tag, [class*="tag"]'
              );
              const proposalEl = container.querySelector(
                '[class*="proposal"], [class*="bid"]'
              );

              if (title && href.includes('/job/') && title.length > 10) {
                items.push({
                  title: title.substring(0, 200),
                  url: href.split('?')[0], // URL limpia sin query params
                  description: desc.substring(0, 500),
                  budget_text: budgetEl?.textContent?.trim() || '',
                  skills: Array.from(skillEls)
                    .map(s => s.textContent?.trim())
                    .filter(Boolean)
                    .slice(0, 15),
                  proposals_text: proposalEl?.textContent?.trim() || '',
                });
              }
            }
          });

          return items;
        }

        // Procesar contenedores encontrados
        containers.forEach(el => {
          const titleEl = el.querySelector(
            'h2 a, h3 a, h4 a, .project-title a, .job-title a, a[href*="/job/"]'
          );
          const descEl = el.querySelector(
            '.project-description, .job-description, p, [class*="desc"]'
          );
          const budgetEl = el.querySelector(
            '.budget, .price, .project-budget, [class*="budget"], [class*="price"]'
          );
          const skillEls = el.querySelectorAll(
            '.skill, .tag, .skills span, .skills a, [class*="skill"] a, [class*="tag"]'
          );
          const proposalEl = el.querySelector(
            '.proposals, .bids, .proposals-count, [class*="proposal"], [class*="bid"]'
          );
          const dateEl = el.querySelector('time, .date, [class*="date"], [class*="time"]');

          if (titleEl) {
            items.push({
              title: titleEl.textContent?.trim()?.substring(0, 200) || '',
              url: (titleEl.href || '').split('?')[0],
              description: descEl?.textContent?.trim()?.substring(0, 500) || '',
              budget_text: budgetEl?.textContent?.trim() || '',
              skills: Array.from(skillEls)
                .map(s => s.textContent?.trim())
                .filter(Boolean)
                .slice(0, 15),
              proposals_text: proposalEl?.textContent?.trim() || '',
              date_text: dateEl?.textContent?.trim() || '',
            });
          }
        });

        return items;
      });

      console.log(`[Scraper] ${projects.length} proyectos encontrados en ${category} p.${pageNum}`);

      return {
        success: true,
        projects,
        total: projects.length,
        page: pageNum,
        category,
      };
    } catch (error) {
      console.error(`[Scraper] Error: ${error.message}`);
      return { success: false, projects: [], error: error.message };
    } finally {
      await page.close();
    }
  }

  // Obtener detalles completos de un proyecto
  async getProjectDetails(projectUrl) {
    // Validar URL antes de navegar
    if (!projectUrl || !projectUrl.startsWith('https://www.workana.com/job/')) {
      return { success: false, error: `URL inválida: ${projectUrl}` };
    }

    const page = await this.bm.newPage();

    try {
      console.log(`[Scraper] Detalles de: ${projectUrl}`);
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.bm.randomDelay(1500, 3000);

      const details = await page.evaluate(() => {
        // Helper para extraer texto del primer selector que exista
        const getText = (...selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el.textContent?.trim() || '';
          }
          return '';
        };

        // Título
        const title = getText('h1', '.project-title', '.job-title', '[class*="title"] h1');

        // Descripción completa
        const descEl = document.querySelector(
          '.project-description, .job-description, .project-details, ' +
          '[class*="description"], article .content, .project-body'
        );
        const description = descEl?.innerText?.trim() || descEl?.textContent?.trim() || '';

        // Presupuesto
        const budget = getText(
          '.budget', '.price', '.project-budget',
          '[class*="budget"]', '[class*="price"]'
        );

        // Categoría
        const category = getText(
          '.category', '.project-category',
          '[class*="category"]', 'nav [class*="breadcrumb"] a:last-child'
        );

        // Skills/Tags
        const skills = Array.from(
          document.querySelectorAll(
            '.skill, .tag, .skills span, .skills a, ' +
            '[class*="skill"] a, [class*="skill"] span, [class*="tag"] a'
          )
        )
          .map(s => s.textContent?.trim())
          .filter(Boolean);

        // Número de propuestas
        const proposals = getText(
          '.proposals', '.bids-count', '.proposals-count',
          '[class*="proposal"]', '[class*="bid"]'
        );

        // Plazo/Deadline
        const deadline = getText(
          '.deadline', '.delivery-date', '[class*="deadline"]',
          '[class*="delivery"]'
        );

        // Info del cliente
        const clientName = getText(
          '.client-name', '.employer-name', '[class*="client"] .name',
          '[class*="employer"] .name'
        );
        const clientCountry = getText(
          '.client-country', '.employer-country',
          '[class*="country"]', '.flag + span'
        );
        const clientRating = getText(
          '.client-rating', '.employer-rating', '.rating',
          '[class*="rating"]'
        );
        const clientVerified = !!document.querySelector(
          '.verified, .payment-verified, .client-verified, ' +
          '[class*="verified"]'
        );

        // Fecha de publicación
        const publishDate = getText('time', '.published-date', '[class*="publish"]');

        // Helper: extraer número limpiando separadores de miles (12,345 → 12345, 1.234 → 1234)
        const parseNum = (text) => {
          if (!text) return null;
          const m = text.match(/(\d[\d.,]*\d|\d)/);
          if (!m) return null;
          // Quitar separadores de miles (coma o punto según contexto)
          const clean = m[1].replace(/[.,](?=\d{3})/g, '');
          return parseInt(clean) || null;
        };

        // Proyectos publicados por el cliente
        const clientProjectsText = getText(
          '.client-projects', '.employer-projects',
          '[class*="projects-posted"]', '[class*="jobs-posted"]'
        );
        const clientProjectsPosted = parseNum(clientProjectsText);

        // Tasa de contratación del cliente
        const hireRateText = getText(
          '.hire-rate', '[class*="hire"]', '[class*="contratacion"]'
        );
        const clientHireRate = parseNum(hireRateText);

        return {
          title,
          description,
          budget,
          category,
          deadline,
          skills,
          proposals,
          publish_date: publishDate,
          client: {
            name: clientName,
            country: clientCountry,
            rating: clientRating,
            verified: clientVerified,
            projects_posted: clientProjectsPosted,
            hire_rate: clientHireRate,
          },
          // Texto completo de la página (para que la IA tenga contexto máximo)
          full_text: document.body?.innerText?.substring(0, 5000) || '',
        };
      });

      return { success: true, details, url: projectUrl };
    } catch (error) {
      console.error(`[Scraper] Error detalles: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      await page.close();
    }
  }

  // Scrape mis propuestas enviadas (para feedback loop) — multi-página
  async scrapeMyProposals(pageNum = 1, maxPages = 3) {
    const allProposals = [];

    for (let p = pageNum; p < pageNum + maxPages; p++) {
      const page = await this.bm.newPage();

      try {
        const url = `https://www.workana.com/worker/proposals?page=${p}`;
        console.log(`[Scraper] Navegando a mis propuestas: ${url}`);

        // Interceptar respuestas API del MFE para capturar datos JSON con URLs de proyecto
        const apiData = [];
        page.on('response', async (response) => {
          try {
            const reqUrl = response.url();
            // Capturar peticiones API que puedan contener datos de propuestas
            if (reqUrl.includes('/api/') || reqUrl.includes('/graphql') ||
                reqUrl.includes('bids') || reqUrl.includes('proposals') ||
                reqUrl.includes('worker')) {
              const contentType = response.headers()['content-type'] || '';
              if (contentType.includes('json')) {
                const text = await response.text();
                if (text.includes('/job/') || text.includes('project')) {
                  apiData.push({ url: reqUrl, data: text.substring(0, 50000) });
                }
              }
            }
          } catch (_) { /* respuestas que ya se consumieron */ }
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await this.bm.randomDelay(2000, 4000);

        // Esperar a que el MFE renderice contenido (buscar timestamps como "Hace X horas")
        await page.waitForFunction(
          () => document.body.innerText.includes('Hace') || document.body.innerText.includes('ago'),
          { timeout: 15000 }
        ).catch(() => console.log('[Scraper] Timeout esperando render MFE en propuestas'));

        await this._gradualScroll(page);
        await this.bm.randomDelay(1000, 2000);

        // Estrategia 1: Intentar extraer URLs de las respuestas API interceptadas
        let apiProposals = [];
        for (const resp of apiData) {
          try {
            const json = JSON.parse(resp.data);
            const extracted = this._extractProposalsFromApiData(json);
            if (extracted.length > 0) {
              console.log(`[Scraper] API interceptada: ${extracted.length} propuestas de ${resp.url}`);
              apiProposals.push(...extracted);
            }
          } catch (_) { /* no era JSON parseable */ }
        }

        // Estrategia 2: Extraer links <a href="/job/..."> del DOM (por si Workana los mantiene)
        let domProposals = await page.evaluate(() => {
          const items = [];
          const seen = new Set();
          const links = document.querySelectorAll('a[href*="/job/"]');
          links.forEach(link => {
            const href = (link.href || '').split('?')[0];
            if (seen.has(href) || !href.includes('/job/')) return;
            seen.add(href);
            const container = link.closest('tr, div[class], li, article, section');
            items.push({
              project_url: href,
              project_title: link.textContent?.trim() || '',
              container_text: container?.textContent?.trim().substring(0, 500) || '',
            });
          });
          return items;
        });

        // Estrategia 3: Extraer del texto visible del MFE (último recurso)
        // El MFE renderiza los títulos como texto plano sin links <a href="/job/...">
        let textProposals = [];
        if (apiProposals.length === 0 && domProposals.length === 0) {
          console.log('[Scraper] Links /job/ no encontrados, extrayendo del texto visible del MFE');
          textProposals = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const items = [];

            // Patrón: Cada propuesta tiene texto descriptivo + "Hace X horas/días" + título
            // Buscar bloques entre timestamps
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            let currentBlock = [];
            for (const line of lines) {
              currentBlock.push(line);

              // Cuando encontramos un timestamp, procesamos el bloque
              if (/Hace \d+ (hora|horas|día|días|minuto|minutos|mes|meses|semana|semanas)/i.test(line) ||
                  /\d+ (hour|hours|day|days|minute|minutes|month|months|week|weeks) ago/i.test(line)) {

                const blockText = currentBlock.join(' ');

                // Buscar título del proyecto (suele ser la línea más larga con mayúsculas iniciales)
                // Patrones: "En <Título>" o "El proyecto <Título>"
                let title = '';
                const enMatch = blockText.match(/(?:En|In)\s+([A-ZÁÉÍÓÚÑ][^.!?]{15,120})/);
                const elMatch = blockText.match(/El proyecto\s+([A-ZÁÉÍÓÚÑ][^.!?]{15,120})/);
                if (enMatch) title = enMatch[1].trim();
                else if (elMatch) title = elMatch[1].trim();
                else {
                  // Fallback: buscar la línea más larga que parezca un título
                  const candidateLines = currentBlock.filter(l =>
                    l.length > 20 && l.length < 150 &&
                    /^[A-ZÁÉÍÓÚÑ]/.test(l) &&
                    !l.includes('¡') && !l.includes('devolvimos')
                  );
                  if (candidateLines.length > 0) {
                    title = candidateLines[candidateLines.length - 1];
                  }
                }

                if (title) {
                  // Limpiar título (quitar timestamps y basura al final)
                  title = title.replace(/Hace \d+.*$/, '').replace(/\d+ (hour|day).*$/i, '').trim();

                  items.push({
                    project_url: '', // Sin URL, matchear por título en Supabase
                    project_title: title,
                    container_text: blockText.substring(0, 500),
                  });
                }

                currentBlock = [];
              }

              // Limitar bloques para no acumular demasiado
              if (currentBlock.length > 20) currentBlock = currentBlock.slice(-10);
            }

            return items;
          });
          console.log(`[Scraper] Texto visible: ${textProposals.length} propuestas extraídas`);
        }

        // Combinar resultados (prioridad: API > DOM > texto)
        let proposals = apiProposals.length > 0 ? apiProposals
          : domProposals.length > 0 ? domProposals
          : textProposals;

        // Deduplicar por título (para evitar duplicados entre estrategias)
        const seen = new Set();
        proposals = proposals.filter(pr => {
          const key = (pr.project_url || pr.project_title).toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Clasificar estados
        const classified = proposals.map(pr => {
          const text = ((pr.status_text || '') + ' ' + (pr.container_text || '')).toLowerCase();
          let outcome = 'in_progress';
          let clientResponded = false;

          if (/ganado|won|aceptad|accepted|contratad|hired/i.test(text)) {
            outcome = 'won';
            clientResponded = true;
          } else if (/rechazad|rejected|perdid|lost|no seleccion|not selected|no fue aceptada/i.test(text)) {
            outcome = 'lost';
            clientResponded = true;
          } else if (/visto|seen|le[ií]d|read|respuesta|replied|message/i.test(text)) {
            clientResponded = true;
          } else if (/cerrado|closed|expirad|expired|finaliz|devolvimos|no ha tenido actividad/i.test(text)) {
            outcome = 'no_response';
          }

          return {
            project_url: pr.project_url || '',
            project_title: pr.project_title || '',
            outcome,
            client_responded: clientResponded,
            match_by: pr.project_url ? 'url' : 'title',
          };
        });

        allProposals.push(...classified);
        console.log(`[Scraper] Página ${p}: ${classified.length} propuestas (API=${apiProposals.length}, DOM=${domProposals.length}, text=${textProposals.length})`);

        // Si hay menos de 5, probablemente es la última página
        if (proposals.length < 5) break;

        await this.bm.randomDelay(3000, 5000);
      } catch (error) {
        console.error(`[Scraper] Error mis propuestas p.${p}: ${error.message}`);
        break;
      } finally {
        await page.close();
      }
    }

    console.log(`[Scraper] ${allProposals.length} propuestas encontradas (${maxPages} páginas)`);
    return { success: true, proposals: allProposals, total: allProposals.length };
  }

  // Extraer datos de propuestas de respuestas API interceptadas del MFE
  _extractProposalsFromApiData(data) {
    const proposals = [];

    // Recursivamente buscar objetos que tengan URL de proyecto
    const traverse = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(item => traverse(item));
        return;
      }

      // Buscar campos que contengan URLs de proyecto
      const urlFields = ['url', 'project_url', 'projectUrl', 'href', 'link'];
      const titleFields = ['title', 'project_title', 'projectTitle', 'name'];

      let projectUrl = '';
      let projectTitle = '';

      for (const field of urlFields) {
        if (obj[field] && typeof obj[field] === 'string' && obj[field].includes('/job/')) {
          projectUrl = obj[field].split('?')[0];
          if (!projectUrl.startsWith('http')) {
            projectUrl = 'https://www.workana.com' + projectUrl;
          }
          break;
        }
      }

      for (const field of titleFields) {
        if (obj[field] && typeof obj[field] === 'string' && obj[field].length > 10) {
          projectTitle = obj[field];
          break;
        }
      }

      if (projectUrl || (projectTitle && projectTitle.length > 15)) {
        proposals.push({
          project_url: projectUrl,
          project_title: projectTitle,
          container_text: JSON.stringify(obj).substring(0, 500),
        });
      }

      // Buscar en sub-objetos
      Object.values(obj).forEach(val => traverse(val));
    };

    traverse(data);
    return proposals;
  }

  // Scroll gradual para activar lazy loading
  async _gradualScroll(page) {
    await page.evaluate(async () => {
      const distance = 300;
      const delay = 200;
      const maxScrolls = 10;

      for (let i = 0; i < maxScrolls; i++) {
        window.scrollBy(0, distance);
        await new Promise(r => setTimeout(r, delay + Math.random() * 200));

        // Si llegamos al final, parar
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 100) {
          break;
        }
      }

      // Volver arriba
      window.scrollTo(0, 0);
    });
  }
}

module.exports = { WorkanaScraper };
