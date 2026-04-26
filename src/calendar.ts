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
  console.log('[calendar-plugin] plugin loaded');

  return (tree) => {
    const existingDatesCache = new Map<string, string[]>();
    const pagesCache = new Map<string, { path?: string }[]>();
    const parseCalendarViewerArgs = (argsText: string) => {
      const args = argsText.split(',').map((arg) => arg.trim()).filter((arg) => arg !== '');

      const limitArg = args.find((arg) => !Number.isNaN(Number(arg)));
      const basePathArg = args.find((arg) => Number.isNaN(Number(arg)));

      return {
        basePath: basePathArg == null || basePathArg === '' ? '.' : basePathArg,
        limit: limitArg == null ? 5 : Number(limitArg),
      };
    };
    visit(tree, (node) => {
      const n = node as unknown as GrowiNode;
      console.log('[calendar-plugin] node:', n.type, n.name, n.value);
      try {
        if (n.type === 'leafGrowiPluginDirective' && n.name === 'calendar') {
          const [month, year] = Object.keys(n.attributes);
          const lang = n.attributes.lang || 'en';
          const separator = n.attributes.separator || '/';
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
                    month: isNaN(month as unknown as number) ? new Date().getMonth() : parseInt(month) - 1,
                    year: isNaN(year as unknown as number) ? new Date().getFullYear() : parseInt(year),
                  },
                },
                actions: {
                  async clickDay(event, self) {
                    if (clicked) return;
                    clicked = true;
                    const page = self.selectedDates[0];
                    const resolvedBasePath = await resolveBasePath(basePath);
                    location.href = resolvedBasePath === '' ? `/${page}` : `${resolvedBasePath}/${page}`;
                  },
                },
              });
              cal.init();

              const targetMonth = isNaN(month as unknown as number) ? new Date().getMonth() : parseInt(month) - 1;
              const targetYear = isNaN(year as unknown as number) ? new Date().getFullYear() : parseInt(year);

              void refreshExistingDateHighlights(calendarId, basePath, targetYear, targetMonth, separator);

              let lastCheckedYear = targetYear;
              let lastCheckedMonth = targetMonth;

              calendarElement.addEventListener('click', () => {
                setTimeout(() => {
                  const monthButton = calendarElement.querySelector('[data-calendar-selected-month]');
                  const yearButton = calendarElement.querySelector('[data-calendar-selected-year]');

                  const selectedMonth = Number(monthButton?.getAttribute('data-calendar-selected-month'));
                  const selectedYear = Number(yearButton?.getAttribute('data-calendar-selected-year'));

                  if (Number.isNaN(selectedMonth) || Number.isNaN(selectedYear)) return;

                  lastCheckedYear = selectedYear;
                  lastCheckedMonth = selectedMonth;

                  void refreshExistingDateHighlights(calendarId, basePath, selectedYear, selectedMonth, separator);
                }, 100);
              });

              clearInterval(id);
            }
          }, 100);
        }

        if (n.type === 'leafGrowiPluginDirective' && n.name === 'calendar_viewer') {
          console.log('[calendar_viewer] attributes:', n.attributes);
          console.log('[calendar_viewer] attribute keys:', Object.keys(n.attributes));

          const { basePath, limit } = parseCalendarViewerArgs(Object.keys(n.attributes).join(','));
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
        if (n.type === 'text' && typeof n.value === 'string') {
          console.log('[calendar_viewer] text node:', n.value);

          const regex = /\$calendar_viewer\((.*?)\)/g;
          let match;
          const parts: string[] = [];
          let lastIndex = 0;

          while ((match = regex.exec(n.value)) !== null) {
            console.log('[calendar_viewer] matched:', match[0], match[1]);
            const before = n.value.slice(lastIndex, match.index);
            if (before) parts.push(before);

            const { basePath, limit } = parseCalendarViewerArgs(match[1]);
            const viewerId = `calendar-viewer-${Math.random().toString(36).slice(2)}`;

            parts.push(`<div id="${viewerId}">読み込み中...</div>`);

            const id = setInterval(() => {
              const el = document.querySelector(`#${viewerId}`);
              if (el == null) return;

              clearInterval(id);
              void renderCalendarViewer(viewerId, basePath, limit);
            }, 100);

            lastIndex = regex.lastIndex;
          }

          const after = n.value.slice(lastIndex);
          if (after) parts.push(after);

          if (lastIndex > 0) {
            n.type = 'html';
            n.value = parts.join('');
          }
        }
      }
      catch (e) {
        n.type = 'html';
        n.value = `<div style="color: red;">Error: ${(e as Error).message}</div>`;
      }
    });

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

    const formatDate = (year: number, month: number, day: number, separator: string) => {
      return [
        year,
        String(month + 1).padStart(2, '0'),
        String(day).padStart(2, '0'),
      ].join(separator);
    };

    const getExistingDates = async(
      basePath: string,
      year: number,
      month: number,
      separator: string,
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

      console.log('[calendar_viewer] input basePath:', basePath);
      console.log('[calendar_viewer] resolvedBasePath:', resolvedBasePath);
      console.log('[calendar_viewer] api:', `/_api/v3/pages/list?path=${encodeURIComponent(resolvedBasePath)}`);

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

        console.log('[calendar_viewer] totalCount:', json.totalCount);
        console.log('[calendar_viewer] pages:', pages);

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

      viewerElement.innerHTML = `
        <div class="growi-calendar-viewer-list">
          ${pages.map((page) => {
            const date = page.path?.split('/').pop() ?? '';

            return `<div class="growi-calendar-viewer-item">${date}</div>`;
          }).join('')}
        </div>
      `;
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
          `[data-calendar-day="${date}"]`
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
      separator: string,
    ) => {
      const calendarElement = document.querySelector(`#${calendarId}`);
      if (calendarElement == null) return;

      calendarElement
        .querySelectorAll('.growi-calendar-existing-page')
        .forEach((el) => el.classList.remove('growi-calendar-existing-page'));

      const existingDates = await getExistingDates(basePath, year, month, separator);

      injectStyle();
      highlightExistingDates(calendarId, existingDates);
    };
  };
};
