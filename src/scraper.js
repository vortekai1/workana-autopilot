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

              if (title && href.includes('/job/')) {
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

        // Proyectos publicados por el cliente
        const clientProjectsText = getText(
          '.client-projects', '.employer-projects',
          '[class*="projects-posted"]', '[class*="jobs-posted"]'
        );
        const clientProjectsMatch = clientProjectsText.match(/(\d+)/);
        const clientProjectsPosted = clientProjectsMatch ? parseInt(clientProjectsMatch[1]) : null;

        // Tasa de contratación del cliente
        const hireRateText = getText(
          '.hire-rate', '[class*="hire"]', '[class*="contratacion"]'
        );
        const hireRateMatch = hireRateText.match(/(\d+)/);
        const clientHireRate = hireRateMatch ? parseInt(hireRateMatch[1]) : null;

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

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await this.bm.randomDelay(2000, 4000);
        await this._gradualScroll(page);

        const proposals = await page.evaluate(() => {
          const items = [];
          const seen = new Set();

          const links = document.querySelectorAll('a[href*="/job/"]');

          links.forEach(link => {
            const href = (link.href || '').split('?')[0];
            if (seen.has(href) || !href.includes('/job/')) return;
            seen.add(href);

            const container = link.closest('tr, div[class], li, article, section');
            if (!container) return;

            const statusEl = container.querySelector(
              '[class*="status"], .badge, .label, [class*="state"]'
            );

            items.push({
              project_url: href,
              project_title: link.textContent?.trim() || '',
              status_text: statusEl?.textContent?.trim() || '',
              container_text: container.textContent?.trim().substring(0, 500) || '',
            });
          });

          return items;
        });

        // Clasificar estados
        const classified = proposals.map(pr => {
          const text = (pr.status_text + ' ' + pr.container_text).toLowerCase();
          let outcome = 'in_progress';
          let clientResponded = false;

          if (/ganado|won|aceptad|accepted|contratad|hired/i.test(text)) {
            outcome = 'won';
            clientResponded = true;
          } else if (/rechazad|rejected|perdid|lost|no seleccion|not selected/i.test(text)) {
            outcome = 'lost';
            clientResponded = true;
          } else if (/visto|seen|le[ií]d|read|respuesta|replied|message/i.test(text)) {
            clientResponded = true;
          } else if (/cerrado|closed|expirad|expired|finaliz/i.test(text)) {
            outcome = 'no_response';
          }

          return {
            project_url: pr.project_url,
            project_title: pr.project_title,
            outcome,
            client_responded: clientResponded,
          };
        });

        allProposals.push(...classified);

        // Si hay menos de 10, probablemente es la última página
        if (proposals.length < 10) break;

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
