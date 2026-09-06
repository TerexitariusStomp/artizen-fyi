import type { CreatorFund, CreatorPage, CreatorProject, DetailPreview, Season } from '../artizen';
import { delimited, fmtDate, funding, moneyCells, moneyColumns, moneyHeaders, truncate, usd } from '../format';
import {
  DETAIL_POLL_SCRIPT,
  escapeHtml,
  heroSplit,
  layout,
  namedLink,
  panel,
  refreshLinks,
  sumField,
} from './layout';

export function renderCreator(creator: CreatorPage, seasonParam?: string | null): string {
  const current = Boolean(creator.season?.current);
  const includeBonus = creator.projects.some((project) => Number(project.bonus) > 0);
  const cols = moneyColumns(includeBonus);
  const projectRaised = sumField(creator.projects, 'raised');
  const fundRaised = current ? sumField(creator.funds, 'raised') : sumField(creator.funds, 'contrib_total');
  const counts = [
    creator.projects.length ? `${creator.projects.length} project${creator.projects.length === 1 ? '' : 's'}` : '',
    creator.funds.length ? `${creator.funds.length} fund${creator.funds.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const bio = creator.bio ? `<p class="lead">${escapeHtml(creator.bio)}</p>` : '';
  const meta = [
    counts.length ? escapeHtml(counts.join(' · ')) : '',
    projectRaised > 0 ? `${usd(projectRaised)} raised` : '',
    fundRaised > 0 ? `${usd(fundRaised)} in funds` : '',
    creator.points ? `${delimited(creator.points)} boosts` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const empty =
    !creator.projects.length && !creator.funds.length
      ? panel(`<p class="mb-0 text-muted">No public projects or funds for this creator yet.</p>`)
      : '';
  return layout({
    title: creator.season ? `${creator.name} · ${creator.season.title}` : creator.name,
    description: creator.bio || `${creator.name} on Artizen`,
    image: creator.image,
    season: seasonParam,
    body: `
      ${heroSplit(
        creator.image,
        creator.name,
        `<h1>${escapeHtml(creator.name)}</h1>
          ${bio}
          ${meta ? `<p class="small text-muted mb-2">${meta}</p>` : ''}
          ${creatorSocials(creator)}
          ${refreshLinks(seasonParam)}`,
      )}
      ${projectTable(creator.projects, cols, creator.season)}
      ${fundTable(creator.funds, current)}
      ${empty}
    `,
  });
}

export function renderCreatorPlaceholder(_slug: string, preview?: DetailPreview, seasonParam?: string | null): string {
  const name = preview?.name;
  const title = name || 'Creator';
  const heading = name
    ? `<h1>${escapeHtml(name)}</h1>`
    : '<span class="artizen-ph artizen-ph-title" aria-hidden="true"></span>';
  const lead = preview?.lead
    ? `<p class="lead">${escapeHtml(preview.lead)}</p>`
    : `<span class="artizen-ph artizen-ph-lead" aria-hidden="true"></span>
        <span class="artizen-ph artizen-ph-lead artizen-ph-lead-short" aria-hidden="true"></span>`;
  const meta = '<span class="artizen-ph artizen-ph-meta" aria-hidden="true"></span>';
  const socials = `<p class="artizen-hero-links" aria-hidden="true"><span class="artizen-ph artizen-ph-social"></span><span class="artizen-ph artizen-ph-social artizen-ph-social-short"></span></p>`;
  const rows = `<div class="artizen-ph-stack" aria-hidden="true">${'<span class="artizen-ph artizen-ph-row"></span>'.repeat(4)}</div>`;
  return layout({
    title,
    description: preview?.lead || undefined,
    season: seasonParam,
    extra: DETAIL_POLL_SCRIPT,
    body: `<div aria-busy="true">
      ${panel(
        `<div class="artizen-hero artizen-ph" aria-hidden="true"></div>
        <div class="artizen-hero-copy">
          ${heading}
          ${lead}
          ${meta}
          ${socials}
          ${refreshLinks(seasonParam)}
        </div>`,
        { className: 'artizen-hero-card' },
      )}
      ${panel(`<h2 class="artizen-panel-title">Projects</h2>${rows}`)}
      ${panel(`<h2 class="artizen-panel-title">Funds</h2>${rows}`)}
      <p class="visually-hidden">Loading</p>
    </div>
    <noscript><p class="artizen-note">This page needs JavaScript. <a href="?content=1">Open the full page</a>.</p></noscript>`,
  });
}

function projectTable(projects: CreatorProject[], cols: ReturnType<typeof moneyColumns>, season: Season | null): string {
  if (!projects.length) return '';
  const current = Boolean(season?.current);
  const rows = [...projects]
    .map((project) => ({ ...funding(project), available: project.available }))
    .sort((a, b) => (b.raised || 0) - (a.raised || 0));
  const body = rows
    .map((project) => {
      const logline = project.logline
        ? `<br><small class="text-muted">${escapeHtml(truncate(project.logline, 90))}</small>`
        : '';
      return `<tr>
        <td><strong>${namedLink(project.url, project.name)}</strong>${logline}</td>
        ${moneyCells(project, 'td', cols)}
        ${current ? `<td class="text-end">${usd(project.available)}</td>` : ''}
      </tr>`;
    })
    .join('');
  const totals = {
    sales: sumField(rows, 'sales'),
    venus: sumField(rows, 'venus'),
    match: sumField(rows, 'match'),
    prize: sumField(rows, 'prize'),
    bonus: sumField(rows, 'bonus'),
    sprint: sumField(rows, 'sprint'),
    raised: sumField(rows, 'raised'),
  };
  return panel(`
    <h2 class="artizen-panel-title">Projects (${projects.length})</h2>
    <div class="artizen-note">
      <p>Sales excludes Venus artifact buys. Figures are for ${season ? escapeHtml(season.title) : 'this season'}${season?.current ? ' (current)' : ''}.</p>
      <dl class="artizen-defs">
        <div><dt>S+VS</dt><dd>Sales + Venus sales</dd></div>
        <div><dt>S+VS+M</dt><dd>S + VS + Match</dd></div>
        <div><dt>V</dt><dd>VS + Venus extras</dd></div>
        <div><dt>Raised</dt><dd>S + V + M + P${cols.some((col) => col.field === 'bonus') ? ' + B' : ''}</dd></div>
      </dl>
    </div>
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr>
          <th>Project</th>${moneyHeaders('text-end', cols)}
          ${current ? '<th class="text-end">Available</th>' : ''}
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr>
          <th>Total</th>
          ${moneyCells(totals, 'th', cols)}
          ${current ? `<th class="text-end">${usd(sumField(rows, 'available'))}</th>` : ''}
        </tr></tfoot>
      </table>
    </div>`);
}

function fundTable(funds: CreatorFund[], current: boolean): string {
  if (!funds.length) return '';
  const rows = [...funds].sort((a, b) =>
    current ? (b.raised || 0) - (a.raised || 0) : (b.contrib_total || 0) - (a.contrib_total || 0),
  );
  const extraHeads = current
    ? '<th class="text-end">Unlocked</th><th class="text-end">Available</th><th class="text-end">Raised</th>'
    : '';
  const body = rows
    .map((fund) => {
      const subtitle = fund.subtitle
        ? `<br><small class="text-muted">${escapeHtml(truncate(fund.subtitle, 90))}</small>`
        : '';
      const inactive = fund.active === false ? '<br><span class="badge text-bg-secondary">Inactive</span>' : '';
      const created = fmtDate(fund.created_at, true);
      const extraCols = current
        ? `<td class="text-end">${usd(fund.unlocked)}</td>
           <td class="text-end">${usd(fund.available)}</td>
           <td class="text-end">${usd(fund.raised)}</td>`
        : '';
      return `<tr>
        <td><strong>${namedLink(fund.url, fund.name)}</strong>${subtitle}${inactive}</td>
        <td class="text-nowrap">${escapeHtml(created)}</td>
        <td class="text-end">${usd(fund.contrib_total)}</td>
        ${extraCols}
      </tr>`;
    })
    .join('');
  const extraTotals = current
    ? `<th class="text-end">${usd(sumField(rows, 'unlocked'))}</th>
       <th class="text-end">${usd(sumField(rows, 'available'))}</th>
       <th class="text-end">${usd(sumField(rows, 'raised'))}</th>`
    : '';
  return panel(`
    <h2 class="artizen-panel-title">Funds (${funds.length})</h2>
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr>
          <th>Fund</th>
          <th>Created</th>
          <th class="text-end">Contributions</th>
          ${extraHeads}
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr>
          <th>Total</th>
          <th></th>
          <th class="text-end">${usd(sumField(rows, 'contrib_total'))}</th>
          ${extraTotals}
        </tr></tfoot>
      </table>
    </div>`);
}

function creatorSocials(creator: CreatorPage): string {
  const links = [
    creator.website ? `<a href="${escapeHtml(href(creator.website))}" target="_blank" rel="noopener">Website</a>` : '',
    creator.twitter ? `<a href="${escapeHtml(href(creator.twitter))}" target="_blank" rel="noopener">Twitter</a>` : '',
    creator.instagram
      ? `<a href="${escapeHtml(href(creator.instagram))}" target="_blank" rel="noopener">Instagram</a>`
      : '',
  ].filter(Boolean);
  return links.length ? `<p class="artizen-hero-links">${links.join('')}</p>` : '';
}

function href(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
