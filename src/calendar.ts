import { marked } from 'marked';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import VanillaCalendar from 'vanilla-calendar-pro';
import 'vanilla-calendar-pro/build/vanilla-calendar.min.css';

interface GrowiNode extends Node {
  name: string;
  type: string;
  attributes: {[key: string]: string}
  children: GrowiNode[];
  value: string;
}

export const plugin: Plugin = function() {

  return (tree) => {
    const existingDatesCache = new Map<string, string[]>();
    const pagesCache = new Map<string, { path?: string }[]>();

    const getCurrentPagePath = async() => {
      if (location.pathname === '/') return '';

      const pageId = location.pathname.replace(/^\//, '').replace(/\/$/, '');

      try {
        const res = await fetch(`/_api/v3/page?pageId=${pageId}`);
        const json = await res.json();

        if (json.page?.path != null) {
          return json.page.path as string;
        }
      }
      catch (e) {
        console.warn('[calendar] failed to resolve current page path:', e);
      }

      return decodeURIComponent(location.pathname).replace(/\/$/, '');
    };

    const resolveBasePath = async(basePath: string) => {
      if (basePath === '.' || basePath === '') {
        return getCurrentPagePath();
      }

      const normalizedBasePath = basePath.trim().replace(/\/$/, '');

      return normalizedBasePath.startsWith('/')
        ? normalizedBasePath
        : `/${normalizedBasePath}`;
    };

    const getExistingDates = async(
        basePath: string,
        year: number,
        month: number,
    ) => {
      const resolvedBasePath = await resolveBasePath(basePath);
      const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
      const cacheKey = `${resolvedBasePath}:${yearMonth}`;

      const cached = existingDatesCache.get(cacheKey);
      if (cached != null) {
        return cached;
      }

      const pages = await fetchPagesByBasePath(resolvedBasePath);

      const existingDates = pages
        .map((page) => page.path?.split('/').pop())
        .filter((date: string | undefined): date is string => {
          if (date == null) return false;
          return new RegExp(`^${yearMonth}-\\d{2}$`).test(date);
        });

      existingDatesCache.set(cacheKey, existingDates);

      return existingDates;
    };

    const fetchPagesByBasePath = async(basePath: string) => {
      const resolvedBasePath = await resolveBasePath(basePath);

      const cached = pagesCache.get(resolvedBasePath);
      if (cached != null) {
        return cached;
      }

      const limit = 100;
      let page = 1;
      const allPages: { path?: string }[] = [];

      while (true) {
        const res = await fetch(
          `/_api/v3/pages/list?path=${encodeURIComponent(resolvedBasePath)}&limit=${limit}&page=${page}`,
        );

        if (!res.ok) {
          console.warn('[calendar] failed to fetch pages list:', res.status);
          return allPages;
        }

        const json = await res.json();
        const pages = json.pages ?? [];

        allPages.push(...pages);

        if (allPages.length >= json.totalCount || pages.length === 0) {
          break;
        }

        page += 1;
      }

      pagesCache.set(resolvedBasePath, allPages);
      return allPages;
    };

    const getLatestDatePages = async(basePath: string, limit: number) => {
      const resolvedBasePath = await resolveBasePath(basePath);
      const pages = await fetchPagesByBasePath(resolvedBasePath);

      return pages
        .filter((page) => {
          const name = page.path?.split('/').pop();

          return name != null && /^\d{4}-\d{2}-\d{2}$/.test(name);
        })
        .sort((a, b) => {
          const aName = a.path?.split('/').pop() ?? '';
          const bName = b.path?.split('/').pop() ?? '';

          return bName.localeCompare(aName);
        })
        .slice(0, limit);
    };

    const renderCalendarViewer = async(
        viewerId: string,
        basePath: string,
        limit: number,
    ) => {
      const viewerElement = document.querySelector(`#${viewerId}`);
      if (viewerElement == null) return;

      const pages = await getLatestDatePages(basePath, limit);

      if (pages.length === 0) {
        viewerElement.innerHTML = '<div>表示対象の記事はありません。</div>';
        return;
      }

      const items = await Promise.all(
        pages.map(async(page) => {
          const date = page.path?.split('/').pop() ?? '';
          const pagePath = page.path ?? '';
          const content = await fetchPageContent(pagePath);
          const normalizedContent = normalizeRelativeLinks(content, pagePath);
          const parsedContent = marked.parse(normalizedContent, { breaks: true }) as string;
          const htmlContent = wrapImagesWithButton(parsedContent);

          return `
            <div class="growi-calendar-viewer-item">
              <h1 class="growi-calendar-viewer-date">
                <a href="${encodeURI(pagePath)}">${date}</a>
              </h1>
              <div class="growi-calendar-viewer-content markdown-body">
                ${htmlContent}
              </div>
            </div>
          `;
        }),
      );

      viewerElement.innerHTML = `
        <div class="growi-calendar-viewer-list">
          ${items.join('')}
        </div>
      `;
      viewerElement.querySelectorAll('.growi-calendar-viewer-content button img')
        .forEach((img) => {
          img.parentElement?.addEventListener('click', () => {
            openImagePreview(
              img.getAttribute('src') ?? '',
              img.getAttribute('alt') ?? '',
            );
          });
        });
    };

    const normalizeRelativeLinks = (content: string, pagePath: string) => {
      const pageDir = pagePath.split('/').slice(0, -1).join('/');

      return content.replace(
        /\]\((?!https?:\/\/|\/|#)(.*?)\)/g,
        (_match, linkPath) => {
          const normalizedLinkPath = linkPath.startsWith('./')
            ? linkPath.slice(2)
            : linkPath;

          return `](${pageDir}/${normalizedLinkPath})`;
        },
      );
    };

    const openImagePreview = (src: string, alt: string) => {
      const overlay = document.createElement('div');
      overlay.className = 'growi-calendar-viewer-image-overlay';
      overlay.innerHTML = `
        <div class="growi-calendar-viewer-image-preview">
          <img src="${src}" alt="${alt}">
        </div>
      `;

      overlay.addEventListener('click', () => {
        overlay.remove();
      });

      document.body.appendChild(overlay);
    };

    const wrapImagesWithButton = (html: string) => {
      const container = document.createElement('div');
      container.innerHTML = html;

      container.querySelectorAll('img').forEach((img) => {
        if (img.parentElement?.tagName.toLowerCase() === 'button') return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'border-0 bg-transparent p-0';
        button.setAttribute('aria-label', img.getAttribute('alt') ?? '');

        img.parentNode?.insertBefore(button, img);
        button.appendChild(img);
      });

      return container.innerHTML;
    };

    const injectStyle = () => {
      if (document.querySelector('#growi-calendar-plugin-style') != null) return;

      const style = document.createElement('style');
      style.id = 'growi-calendar-plugin-style';
      style.textContent = `
        .growi-calendar-existing-page {
          background-color: #cfe8ff !important;
          border-radius: 6px;
          font-weight: bold;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .growi-calendar-viewer-item {
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid #ddd;
        }
        .wiki .growi-calendar-viewer-date,
        .markdown-body .growi-calendar-viewer-date {
          padding: 0.4rem 0.6rem !important;
          border-left: 8px solid #777799 !important;
          border-top: none !important;
          border-bottom: none !important;
          border-right: none !important;
          background-color: transparent !important;
          margin-top: 16px !important;
          margin-bottom: 8px !important;
          font-size: 2.0rem !important;
          font-weight: 400 !important;
          line-height: 1.2 !important;
          text-decoration: none !important;
        }
        .wiki .growi-calendar-viewer-date a,
        .markdown-body .growi-calendar-viewer-date a {
          color: #444455 !important;
          text-decoration: none !important;
          border-bottom: none !important;
          font-weight: 400 !important;
        }
        .wiki .growi-calendar-viewer-date a:hover,
        .markdown-body .growi-calendar-viewer-date a:hover {
          text-decoration: none !important;
          border-bottom: none !important;
        }
        .growi-calendar-viewer-content img {
          max-width: 100%;
          height: auto;
        }
        .growi-calendar-viewer-image-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: zoom-out;
        }
        .growi-calendar-viewer-image-preview img {
          max-width: 90vw;
          max-height: 90vh;
          object-fit: contain;
        }
        `;
      document.head.appendChild(style);
    };

    const highlightExistingDates = (
        calendarId: string,
        existingDates: string[],
    ) => {
      const calendarElement = document.querySelector(`#${calendarId}`);
      if (calendarElement == null) return;

      existingDates.forEach((date) => {
        const targetButton = calendarElement.querySelector(
          `[data-calendar-day="${date}"]`,
        );

        targetButton?.classList.add('growi-calendar-existing-page');

        // ホバー時にブラウザ標準のツールチップを表示する
        targetButton?.setAttribute('title', date);
      });
    };

    const refreshExistingDateHighlights = async(
        calendarId: string,
        basePath: string,
        year: number,
        month: number,
    ) => {
      const calendarElement = document.querySelector(`#${calendarId}`);
      if (calendarElement == null) return;

      calendarElement
        .querySelectorAll('.growi-calendar-existing-page')
        .forEach((el) => el.classList.remove('growi-calendar-existing-page'));

      const existingDates = await getExistingDates(basePath, year, month);

      injectStyle();
      highlightExistingDates(calendarId, existingDates);
    };

    const fetchPageContent = async(pagePath: string) => {
      const res = await fetch(`/_api/v3/page?path=${encodeURIComponent(pagePath)}`);

      if (!res.ok) {
        return '';
      }

      const json = await res.json();

      return json.page?.revision?.body ?? '';
    };

    visit(tree, (node) => {
      const n = node as unknown as GrowiNode;

      try {
        if (n.type === 'leafGrowiPluginDirective' && n.name === 'calendar') {
          const [month, year] = Object.keys(n.attributes);
          const lang = n.attributes.lang || 'en';
          const basePath = n.attributes.basePath || '.';
          const calendarId = `calendar-${Math.random().toString(36).slice(2)}`;

          n.type = 'html';
          n.value = `<div id="${calendarId}"></div>`;

          let clicked = false;
          const id = setInterval(() => {
            const calendarElement = document.querySelector(`#${calendarId}`);

            if (calendarElement != null && calendarElement.getAttribute('data-initialized') !== 'true') {
              calendarElement.setAttribute('data-initialized', 'true');
              const cal = new VanillaCalendar(`#${calendarId}`, {
                settings: {
                  lang,
                  selected: {
                    month: Number.isNaN(Number(month)) ? new Date().getMonth() : Number(month) - 1,
                    year: Number.isNaN(Number(year)) ? new Date().getFullYear() : Number(year),
                  },
                },
                actions: {
                  async clickDay(event, self) {
                    if (clicked) return;
                    clicked = true;
                    const page = self.selectedDates[0];
                    const resolvedBasePath = await resolveBasePath(basePath);
                    window.location.href = resolvedBasePath === '' ? `/${page}` : `${resolvedBasePath}/${page}`;
                  },
                },
              });
              cal.init();

              const targetMonth = Number.isNaN(Number(month)) ? new Date().getMonth() : Number(month) - 1;
              const targetYear = Number.isNaN(Number(year)) ? new Date().getFullYear() : Number(year);

              void refreshExistingDateHighlights(calendarId, basePath, targetYear, targetMonth);

              calendarElement.addEventListener('click', () => {
                setTimeout(() => {
                  const monthButton = calendarElement.querySelector('[data-calendar-selected-month]');
                  const yearButton = calendarElement.querySelector('[data-calendar-selected-year]');

                  const selectedMonth = Number(monthButton?.getAttribute('data-calendar-selected-month'));
                  const selectedYear = Number(yearButton?.getAttribute('data-calendar-selected-year'));

                  if (Number.isNaN(selectedMonth) || Number.isNaN(selectedYear)) return;

                  void refreshExistingDateHighlights(calendarId, basePath, selectedYear, selectedMonth);
                }, 100);
              });

              clearInterval(id);
            }
          }, 100);
        }

        if (n.type === 'leafGrowiPluginDirective' && n.name === 'calendar_viewer') {

          const keys = Object.keys(n.attributes);

          const numericKeys = keys.filter((key) => Number.isInteger(Number(key)) && Number(key) > 0);
          const pathKeys = keys.filter((key) => !(Number.isInteger(Number(key)) && Number(key) > 0));

          const limit = numericKeys.length > 0 ? Number(numericKeys[0]) : 5;
          const basePath = pathKeys.length > 0 ? pathKeys[0] : '.';

          const viewerId = `calendar-viewer-${Math.random().toString(36).slice(2)}`;

          n.type = 'html';
          n.value = `<div id="${viewerId}" class="growi-calendar-viewer">読み込み中...</div>`;

          const id = setInterval(() => {
            const viewerElement = document.querySelector(`#${viewerId}`);

            if (viewerElement == null) return;

            clearInterval(id);
            void renderCalendarViewer(viewerId, basePath, limit);
          }, 100);
        }
      }
      catch (e) {
        n.type = 'html';
        n.value = `<div style="color: red;">Error: ${(e as Error).message}</div>`;
      }
    });

  };
};
