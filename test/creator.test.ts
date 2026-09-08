import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bubble } from '../src/artizen/bubble';
import { buildCreator } from '../src/artizen/creator';
import {
  LEAD_CREATOR,
  USER_ACCOUNT,
  creatorNeedle,
  creatorQuery,
  creatorSlug,
  isCreatorName,
  localCreatorPath,
  pickCurator,
} from '../src/artizen/util';
import { renderCreator, renderCreatorPlaceholder } from '../src/html/creator';
import { renderFund } from '../src/html/fund';
import { renderProject } from '../src/html/project';
import { renderSearch } from '../src/html/search';
import { creatorLink, renderDetailPlaceholder } from '../src/html/layout';
import worker from '../src/index';
import type { CreatorPage, Leaderboard } from '../src/artizen';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify({ response: body }), {
    headers: { 'content-type': 'application/json' },
  });
}

const emptyBoard: Leaderboard = {
  seasons: [],
  season: null,
  drives: [],
  projects: [],
  funds: [],
  error: false,
};

describe('creator identity', () => {
  it('slugifies names and skips wallet placeholders', () => {
    expect(creatorSlug('Stephen Reid')).toBe('stephen-reid');
    expect(creatorSlug('Ignazio Colt Nicastro')).toBe('ignazio-colt-nicastro');
    expect(creatorSlug("O'Brien")).toBe('o-brien');
    expect(creatorSlug('J.R. Smith')).toBe('j-r-smith');
    expect(creatorQuery('o-brien')).toBe('o brien');
    expect(creatorNeedle('o-brien')).toBe('brien');
    expect(creatorNeedle('j-r-smith')).toBe('smith');
    expect(localCreatorPath('Stephen Reid')).toBe('/creators/stephen-reid');
    expect(isCreatorName('Stephen Reid')).toBe(true);
    expect(isCreatorName('Unnamed')).toBe(false);
    expect(isCreatorName('0x1234…abcd')).toBe(false);
    expect(creatorLink('Stephen Reid')).toContain('href="/creators/stephen-reid"');
    expect(creatorLink('Unnamed')).toBe('Unnamed');
    expect(pickCurator([{ name: 'Venus', Role: 'buyer' }, { name: 'Nathan Marion' }], 'Artizen')).toBe('Nathan Marion');
    expect(pickCurator([{ name: 'Adam Mutchler' }, { name: 'Artizen', Role: 'Artizen admin' }], 'Artizen')).toBe(
      'Adam Mutchler',
    );
    expect(pickCurator([{ name: 'Artizen', Role: 'Artizen admin' }], 'Stephen Reid')).toBe('Stephen Reid');
  });
});

describe('buildCreator', () => {
  it('collects projects by lead creator and funds the account admins', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.pathname.split('/').pop();
      const constraints = JSON.parse(url.searchParams.get('constraints') || '[]') as Array<{
        key: string;
        constraint_type?: string;
        value?: unknown;
      }>;
      if (type === 'useraccount') {
        const name = constraints.find((c) => c.key === 'name')?.value;
        if (name === 'Stephen Reid') {
          return json({
            results: [
              {
                _id: 'acct-1',
                name: 'Stephen Reid',
                bio: 'Writes about technology',
                website: 'https://stephenreid.net',
                'points - current': 100,
                'profile image': 'https://example.com/stephen.jpg',
              },
            ],
            remaining: 0,
          });
        }
        return json({ results: [], remaining: 0 });
      }
      if (type === 'season') {
        return json({
          results: [{ _id: 's7', 'season number': 7, title: 'Season 7', 'Season tag': 'Live' }],
          remaining: 0,
        });
      }
      if (type === 'projectseason') {
        return json({
          results: [
            {
              project: 'p1',
              'season ': 's7',
              'season number': 7,
              'funding total sales': 5000,
              'funding match': 2000,
              'funding prize funds usd': 500,
              'funding bonus': 8,
            },
          ],
          remaining: 0,
        });
      }
      if (type === 'project') {
        return json({
          results: [
            {
              _id: 'p1',
              Name: 'artizen.fyi',
              Slug: 'artizenfyi',
              Logline: 'Public rankings',
              [LEAD_CREATOR]: 'Stephen Reid',
              [USER_ACCOUNT]: 'acct-1',
              'Counter - total funding': 4708,
              Hide: false,
              unPublished: false,
            },
            {
              _id: 'p-hidden',
              Name: 'Draft',
              Slug: 'draft',
              [LEAD_CREATOR]: 'Stephen Reid',
              [USER_ACCOUNT]: 'acct-1',
              unPublished: true,
            },
          ],
          remaining: 0,
        });
      }
      if (type === 'fund') {
        if (constraints.some((c) => c.key === 'admins')) {
          return json({
            results: [
              {
                _id: 'f1',
                name: 'Artizen Tools Fund',
                Slug: 'artizen-tools',
                active: true,
                'Funding - current': 1200,
                'Extended info': 'ext-1',
              },
            ],
            remaining: 0,
          });
        }
        return json({ results: [], remaining: 0 });
      }
      if (type === 'fundextendedinfo') {
        if (constraints.some((c) => c.key === '_id')) {
          return json({
            results: [{ _id: 'ext-1', 'full title': 'Artizen Tools Fund for Independent Builders', subtitle: 'Tools' }],
            remaining: 0,
          });
        }
        return json({ results: [], remaining: 0 });
      }
      return json({ results: [], remaining: 0 });
    }) as typeof fetch;

    const page = await buildCreator(new Bubble(), 'stephen-reid');
    expect(page?.name).toBe('Stephen Reid');
    expect(page?.bio).toBe('Writes about technology');
    expect(page?.season?.title).toBe('Season 7');
    expect(page?.season?.current).toBe(true);
    expect(page?.projects).toEqual([
      expect.objectContaining({
        name: 'artizen.fyi',
        url: '/projects/artizenfyi',
        logline: 'Public rankings',
        sales: 5000,
        match: 2000,
        prize: 500,
        bonus: 8,
        raised: 7508,
      }),
    ]);
    expect(page?.funds).toEqual([
      expect.objectContaining({
        name: 'Artizen Tools Fund for Independent Builders',
        url: '/funds/artizen-tools',
        subtitle: 'Tools',
        available: 1200,
        raised: 1200,
      }),
    ]);
  });

  it('still finds creators who only appear on projects', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.pathname.split('/').pop();
      if (type === 'project') {
        return json({
          results: [
            {
              _id: 'p1',
              Name: 'The Contemporary Hub',
              Slug: 'contemporary-hub',
              [LEAD_CREATOR]: 'Ignazio Colt Nicastro',
              Logline: 'A hub',
              Hide: false,
            },
          ],
          remaining: 0,
        });
      }
      return json({ results: [], remaining: 0 });
    }) as typeof fetch;

    const page = await buildCreator(new Bubble(), 'ignazio-colt-nicastro');
    expect(page?.name).toBe('Ignazio Colt Nicastro');
    expect(page?.projects).toHaveLength(1);
    expect(page?.funds).toEqual([]);
  });

  it('finds names whose slug dropped punctuation', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.pathname.split('/').pop();
      const constraints = JSON.parse(url.searchParams.get('constraints') || '[]') as Array<{
        key: string;
        value?: unknown;
      }>;
      const name = String(constraints.find((c) => c.key === 'name')?.value || '');
      if (type === 'useraccount') {
        if (name.toLowerCase().includes('brien') && !name.includes(' ')) {
          return json({ results: [{ _id: 'acct-ob', name: "O'Brien", bio: 'Maker' }], remaining: 0 });
        }
        return json({ results: [], remaining: 0 });
      }
      if (type === 'project') {
        return json({
          results: [
            {
              _id: 'p1',
              Name: 'Punctuation',
              Slug: 'punctuation',
              [LEAD_CREATOR]: "O'Brien",
              Hide: false,
            },
          ],
          remaining: 0,
        });
      }
      return json({ results: [], remaining: 0 });
    }) as typeof fetch;

    const page = await buildCreator(new Bubble(), 'o-brien');
    expect(page?.name).toBe("O'Brien");
    expect(page?.projects).toHaveLength(1);
  });

  it('finds projects by user account id even when the text name does not match', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.pathname.split('/').pop();
      const constraints = JSON.parse(url.searchParams.get('constraints') || '[]') as Array<{
        key: string;
        constraint_type?: string;
        value?: unknown;
      }>;
      if (type === 'useraccount') {
        const name = String(constraints.find((c) => c.key === 'name')?.value || '');
        if (name.toLowerCase().includes('mcnamara')) {
          return json({ results: [{ _id: 'acct-beth', name: 'Beth McNamara', bio: 'Life Experimenter.' }], remaining: 0 });
        }
        return json({ results: [], remaining: 0 });
      }
      if (type === 'project') {
        const owner = constraints.find((c) => c.key === USER_ACCOUNT);
        const owned = [
          {
            _id: 'p-trench',
            Name: 'Trench Heart',
            Slug: 'trench-heart',
            [LEAD_CREATOR]: 'Beth McNamara ',
            [USER_ACCOUNT]: 'acct-beth',
            Hide: false,
            unPublished: false,
          },
          {
            _id: 'p-icontact',
            Name: 'iContact, the tactile tech opera',
            Slug: 'icontact',
            [LEAD_CREATOR]: 'Beth Mar',
            [USER_ACCOUNT]: 'acct-beth',
            Hide: false,
            unPublished: false,
          },
        ];
        const values = Array.isArray(owner?.value) ? owner.value : [owner?.value];
        if (owner && values.includes('acct-beth')) return json({ results: owned, remaining: 0 });
        return json({ results: [], remaining: 0 });
      }
      return json({ results: [], remaining: 0 });
    }) as typeof fetch;

    const page = await buildCreator(new Bubble(), 'beth-mcnamara');
    expect(page?.projects.map((project) => project.name)).toEqual([
      'Trench Heart',
      'iContact, the tactile tech opera',
    ]);
  });
});

const season7 = {
  id: 's7',
  number: 7,
  title: 'Season 7',
  tag: 'Live',
  current: true,
  competition_start: null,
  competition_end: null,
};

describe('creator pages', () => {
  const creator: CreatorPage = {
    slug: 'stephen-reid',
    name: 'Stephen Reid',
    bio: 'Writes about technology',
    image: 'https://example.com/stephen.jpg',
    website: 'https://stephenreid.net',
    points: 216022,
    seasons: [season7],
    season: season7,
    projects: [
      {
        name: 'artizen.fyi',
        url: '/projects/artizenfyi',
        logline: 'Public rankings',
        sales: 1000,
        venus: 200,
        match: 3000,
        prize: 500,
        bonus: 8,
        raised: 4708,
        available: 120,
      },
    ],
    funds: [
      {
        name: 'Artizen Tools Fund',
        url: '/funds/artizen-tools',
        subtitle: 'Tools',
        active: true,
        contrib_total: 400,
        unlocked: 800,
        available: 1200,
        raised: 2000,
      },
    ],
  };

  it('renders projects, funds, and profile links', () => {
    const html = renderCreator(creator);
    expect(html).toContain('Stephen Reid');
    expect(html).toContain('Writes about technology');
    expect(html).toContain('216,022 boosts');
    expect(html).toContain('href="/projects/artizenfyi"');
    expect(html).toContain('href="/funds/artizen-tools"');
    expect(html).toContain('>Sales<');
    expect(html).toContain('>Match<');
    expect(html).toContain('>Raised<');
    expect(html).toContain('>Contributions<');
    expect(html).toContain('>Unlocked<');
    expect(html).toContain('>Available<');
    expect(html).toContain('$1,000');
    expect(html).toContain('$3,000');
    expect(html).toContain('$4,708');
    expect(html).toContain('$400');
    expect(html).toContain('$2,000');
    expect(html).not.toContain('Sales excludes Venus artifact buys');
    expect(html).not.toContain('Figures are for Season 7');
    expect(html).toContain('https://stephenreid.net');
  });

  it('links creators from project and fund pages', () => {
    const project = renderProject({
      id: 'p1',
      slug: 'artizenfyi',
      name: 'artizen.fyi',
      artizen_url: 'https://artizen.fund/index/p/artizenfyi',
      creator: 'Stephen Reid',
      logline: 'Public rankings',
      tags: [],
      seasons: [],
      submissions: [],
      siblings: [],
      sibling_funds: [],
    });
    expect(project).toContain('By <a href="/creators/stephen-reid"');
    expect(project).toContain('Stephen Reid');

    const fund = renderFund({
      name: 'Tools Fund',
      artizen_url: 'https://artizen.fund/index/mf/tools',
      curator: 'Stephen Reid',
      sponsor: 'Artizen',
      prize_art: 500000,
      available: 0,
      unlocked: 0,
      contrib_total: 0,
      seasons: [
        {
          title: 'Season 8',
          total: 0,
          count: 0,
          drives: [
            {
              name: 'Drive 1',
              unlocked: 0,
              available: 0,
              projects: [{ name: 'artizen.fyi', url: '/projects/artizenfyi', creator: 'Stephen Reid', available: 0, unlocked: 0 }],
            },
          ],
        },
      ],
    });
    expect(fund).toContain('By <a href="/creators/stephen-reid"');
    expect(fund).toContain('Lead sponsor: <a href="/creators/artizen"');
    expect(fund).not.toContain('Prize ');
  });

  it('pulses hero stats, socials, and bylines while detail pages load', () => {
    const creator = renderCreatorPlaceholder('stephen-reid', { name: 'Stephen Reid', lead: 'Writes about technology' });
    expect(creator).toContain('artizen-ph-meta');
    expect(creator).toContain('artizen-ph-social');
    expect(creator).toContain('href="?refresh=1"');

    const seasonal = renderCreatorPlaceholder('stephen-reid', { name: 'Stephen Reid' }, '6');
    expect(seasonal).toContain('href="?refresh=1&season=6"');

    const project = renderDetailPlaceholder('project', 'dandelion', {
      name: 'Dandelion',
      lead: 'The fee-free ticketing platform',
      creator: 'Stephen Reid',
    });
    expect(project).toContain('By <a href="/creators/stephen-reid"');
    expect(project.slice(project.indexOf('artizen-hero-copy'), project.indexOf('Funding'))).not.toContain('artizen-ph-by');

    const fund = renderDetailPlaceholder('fund', 'music-healing-fund', {
      name: 'Music + Healing Fund',
      lead: 'Sound and art',
    });
    const fundHero = fund.slice(fund.indexOf('artizen-hero-copy'), fund.indexOf('Funding'));
    expect(fundHero).toContain('artizen-ph-by');
    expect(fundHero).not.toContain('By ');
  });

  it('shows an empty creators column when no people match', () => {
    const html = renderSearch(emptyBoard, 'Marei', null);
    expect(html).toContain('Creators (0)');
    expect(html).toContain('No matching creators.');
    expect(html).toContain('Projects (0)');
    expect(html).toContain('Funds (0)');
  });

  it('adds matching creators to search results', () => {
    const html = renderSearch(
      {
        ...emptyBoard,
        projects: [
          {
            name: 'artizen.fyi',
            url: '/projects/artizenfyi',
            creator: 'Stephen Reid',
            logline: 'Public rankings',
            sales: 0,
            venus: 0,
            match: 0,
            prize: 0,
            raised: 100,
          },
        ],
        funds: [],
      },
      'stephen',
      null,
    );
    expect(html).toContain('Creators (1)');
    expect(html).toContain('href="/creators/stephen-reid"');
    expect(html).toContain('artizen-kind-creator');
    expect(html).toContain('1 project this season');
  });

  it('lists fund curators as creators and ignores boost-only names', () => {
    const html = renderSearch(
      {
        ...emptyBoard,
        funds: [
          {
            name: 'Tools Fund',
            url: '/funds/tools',
            curator: 'Ada Lovelace',
            subtitle: 'Engines',
            season_total: 0,
            last_contribution: null,
            active: true,
          },
        ],
      },
      'ada',
      null,
    );
    expect(html).toContain('Creators (1)');
    expect(html).toContain('href="/creators/ada-lovelace"');
    expect(html).toContain('1 fund this season');
  });
});

describe('creator routes', () => {
  function environment(value: CreatorPage | null = null): Env {
    return {
      CACHE: {
        async get(key: string) {
          return key === 'artizen/creator/v3/stephen-reid/current' && value ? JSON.stringify(value) : null;
        },
        async put() {},
        async delete() {},
        async list() {
          return { keys: [], list_complete: true };
        },
      } as unknown as KVNamespace,
    } as Env;
  }

  it('canonicalizes creator names and serves cached pages', async () => {
    const cached: CreatorPage = {
      slug: 'stephen-reid',
      name: 'Stephen Reid',
      seasons: [season7],
      season: season7,
      projects: [
        {
          name: 'artizen.fyi',
          url: '/projects/artizenfyi',
          sales: 0,
          venus: 0,
          match: 0,
          prize: 0,
          raised: 0,
        },
      ],
      funds: [],
    };
    const redirect = await worker.fetch(new Request('https://artizen.fyi/creators/Stephen%20Reid'), environment(cached));
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('https://artizen.fyi/creators/stephen-reid');

    const alias = await worker.fetch(new Request('https://artizen.fyi/users/stephen-reid'), environment(cached));
    expect(alias.status).toBe(301);
    expect(alias.headers.get('location')).toBe('https://artizen.fyi/creators/stephen-reid');

    const page = await worker.fetch(
      new Request('https://artizen.fyi/creators/stephen-reid', { headers: { 'sec-fetch-mode': 'navigate' } }),
      environment(cached),
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('artizen.fyi');
  });
});
