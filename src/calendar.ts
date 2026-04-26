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
    visit(tree, (node) => {
      const n = node as unknown as GrowiNode;
      try {
        if (n.type === 'leafGrowiPluginDirective' && n.name === 'calendar') {
          const [month, year] = Object.keys(n.attributes);
          const lang = n.attributes.lang || 'en';
          const separator = n.attributes.separator || '/';
          const basePath = n.attributes.basePath || '.';
          const calendarId = `calendar-${Math.random().toString(36).slice(2)}`;
          console.log('basePath=' + basePath);
          n.type = 'html';
          n.value = `<div id="${calendarId}"></div>`;
          console.log(month, year, lang);
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
                    const page = self.selectedDates[0].replaceAll(/-/g, separator);
                    const resolvedBasePath = await resolveBasePath(basePath);
                    location.href = resolvedBasePath === '' ? `/${page}` : `${resolvedBasePath}/${page}`;
                  },
                },
              });
              cal.init();

              const targetMonth = isNaN(month as unknown as number) ? new Date().getMonth() : parseInt(month) - 1;
              const targetYear = isNaN(year as unknown as number) ? new Date().getFullYear() : parseInt(year);

              void logTargetPagePaths(basePath, targetYear, targetMonth, separator);
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
      }
      catch (e) {
        n.type = 'html';
        n.value = `<div style="color: red;">Error: ${(e as Error).message}</div>`;
      }
    });

    const getCurrentPagePath = async() => {
      if (location.pathname === '/') return '';

      const pageId = location.pathname.replace(/\//, '');
      const res = await fetch(`/_api/v3/page?pageId=${pageId}`);
      const json = await res.json();

      return json.page.path as string;
    };

    const resolveBasePath = async(basePath: string) => {
      if (basePath === '.' || basePath === '') {
        return getCurrentPagePath();
      }

      return basePath.replace(/\/$/, '');
    };

    const formatDate = (year: number, month: number, day: number, separator: string) => {
      return [
        year,
        String(month + 1).padStart(2, '0'),
        String(day).padStart(2, '0'),
      ].join(separator);
    };

    const logTargetPagePaths = async(basePath: string, year: number, month: number, separator: string) => {
      const resolvedBasePath = await resolveBasePath(basePath);
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = formatDate(year, month, day, separator);
        const pagePath = resolvedBasePath === '' ? `/${date}` : `${resolvedBasePath}/${date}`;
        console.log(`[calendar] target page path: ${pagePath}`);
      }
    };

    const existsPage = async(path: string) => {
      const res = await fetch(`/_api/v3/page?path=${encodeURIComponent(path)}`);

      if (!res.ok) {
        return false;
      }

      const json = await res.json();
      return json.page != null;
    };

    const getExistingDates = async(
      basePath: string,
      year: number,
      month: number,
      separator: string,
    ) => {
      const resolvedBasePath = await resolveBasePath(basePath);
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const existingDates: string[] = [];

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = formatDate(year, month, day, separator);
        const pagePath = resolvedBasePath === '' ? `/${date}` : `${resolvedBasePath}/${date}`;

        const exists = await existsPage(pagePath);
        if (exists) {
          existingDates.push(date);
        }
      }

      console.log('[calendar] existing dates:', existingDates);

      return existingDates;
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
