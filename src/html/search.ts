import type { FundRow, Leaderboard, ProjectRow } from '../artizen';
import { isCreatorName, localCreatorPath } from '../artizen/util';
import { escapeHtml, layout, note, pageTitle, panel, resultCard } from './layout';

function haystack(...parts: unknown[]): string {
  return parts
    .filter((part) => part != null && part !== '')
    .join(' ')
    .toLowerCase();
}

function matches(query: string, ...parts: unknown[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle !== '' && haystack(...parts).includes(needle);
}

function rank(query: string, name: string): number {
  const needle = query.trim().toLowerCase();
  const n = name.toLowerCase();
  if (n === needle) return 0;
  if (n.startsWith(needle)) return 1;
  return 2;
}

type CreatorHit = { name: string; projects: number; funds: number };

function addCreator(map: Map<string, CreatorHit>, name: string | undefined, field: 'projects' | 'funds'): void {
  if (!isCreatorName(name)) return;
  const held = map.get(name) || { name, projects: 0, funds: 0 };
  held[field] += 1;
  map.set(name, held);
}

function creatorSummary(hit: CreatorHit): string {
  const parts = [
    hit.projects ? `${hit.projects} project${hit.projects === 1 ? '' : 's'}` : '',
    hit.funds ? `${hit.funds} fund${hit.funds === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} this season` : '';
}

function resultCol(title: string, count: number, cards: string, wide: boolean): string {
  const body = cards || `<p class="text-muted mb-0">No matching ${title.toLowerCase()}.</p>`;
  return `<div class="${wide ? 'col-lg-4' : 'col-lg-6'} mb-3">
    ${panel(`<h2 class="artizen-panel-title">${escapeHtml(title)} (${count})</h2>${body}`)}
  </div>`;
}

export function renderSearch(data: Leaderboard, query: string, seasonParam: string | null): string {
  const q = query.trim();
  const projects = q
    ? [...data.projects]
        .filter((row: ProjectRow) => matches(q, row.name, row.logline, row.creator))
        .sort((a, b) => rank(q, a.name) - rank(q, b.name) || a.name.localeCompare(b.name))
    : [];
  const funds = q
    ? [...data.funds]
        .filter((row: FundRow) => matches(q, row.name, row.subtitle, row.curator))
        .sort((a, b) => rank(q, a.name) - rank(q, b.name) || a.name.localeCompare(b.name))
    : [];
  const creatorCounts = new Map<string, CreatorHit>();
  if (q) {
    for (const row of data.projects) {
      if (matches(q, row.creator)) addCreator(creatorCounts, row.creator, 'projects');
    }
    for (const row of data.funds) {
      if (matches(q, row.curator)) addCreator(creatorCounts, row.curator, 'funds');
    }
  }
  const creators = [...creatorCounts.values()].sort(
    (a, b) =>
      rank(q, a.name) - rank(q, b.name) ||
      b.projects + b.funds - (a.projects + a.funds) ||
      a.name.localeCompare(b.name),
  );
  const heading = q ? `Results for “${escapeHtml(q)}”` : 'Search projects, funds, and creators';
  const status = q
    ? `${projects.length} project${projects.length === 1 ? '' : 's'}, ${funds.length} fund${funds.length === 1 ? '' : 's'}, ${creators.length} creator${creators.length === 1 ? '' : 's'}`
    : 'Type to search projects, funds, and creators';
  const empty = !q
    ? panel(note('Type a name in the search box to find projects, funds, and creators in this season.'))
    : '';
  const wide = creators.length > 0;
  const cols = q
    ? `<div class="row">
        ${resultCol('Projects', projects.length, projects.map((p) => resultCard('Project', p.name, p.url, p.logline || p.creator)).join(''), wide)}
        ${resultCol('Funds', funds.length, funds.map((f) => resultCard('Fund', f.name, f.url, f.subtitle || f.curator)).join(''), wide)}
        ${
          wide
            ? resultCol(
                'Creators',
                creators.length,
                creators
                  .map((c) => resultCard('Creator', c.name, localCreatorPath(c.name), creatorSummary(c)))
                  .join(''),
                wide,
              )
            : ''
        }
      </div>`
    : '';
  return layout({
    title: q ? `${q} · ${pageTitle(data)}` : `Search · ${pageTitle(data)}`,
    description: 'Search Artizen projects, funds, and creators',
    query: q,
    season: seasonParam,
    body: `
      <div class="visually-hidden" aria-live="polite">${escapeHtml(status)}</div>
      ${panel(`<h1 class="mb-0">${heading}</h1>`)}
      ${empty}
      ${cols}
    `,
  });
}
