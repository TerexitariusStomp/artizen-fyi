import type { Bubble } from './bubble';
import { appendLegacyProjectSeasons, applyLegacySubmissionAwards } from './legacy';
import type { Constraint, CreatorFund, CreatorPage, CreatorProject, ProjectFundingSeason, Row, Season } from './types';
import {
  LEAD_CREATOR,
  USER_ACCOUNT,
  bonusShare,
  bump,
  byId,
  creatorNeedle,
  creatorQuery,
  creatorSlug,
  seasonLabel,
  driveHasBonusPot,
  firstMedia,
  groupBy,
  hidden,
  ids,
  leftoverMatch,
  localFundPath,
  localProjectPath,
  mapSome,
  mediaUrl,
  num,
  seasonFunding,
  sortByDesc,
  sum,
  text,
  venusSplit,
} from './util';

type ProjectMoney = Pick<CreatorProject, 'sales' | 'venus' | 'match' | 'prize' | 'bonus' | 'sprint' | 'raised' | 'available'>;

export async function buildCreator(
  client: Bubble,
  slug: string,
  seasonNumber?: string | number | null,
): Promise<CreatorPage | null> {
  const query = creatorQuery(slug);
  if (!query) return null;

  const seasons = await client.fetchSeasons();
  const season = client.pickSeason(seasons, seasonNumber) ?? null;
  const accounts = await findAccounts(client, slug, query);
  const names = unique(mapSome(accounts, (row) => text(row['name'])));
  const profile = pickProfile(accounts);

  const [projectRows, adminFunds] = await Promise.all([
    findProjects(client, slug, accounts, query),
    findAdminFunds(client, accounts),
  ]);
  const sponsored = await findSponsoredFunds(client, names);
  const fundRows = mergeFundRows([...adminFunds, ...sponsored]);

  const [money, funds] = await Promise.all([
    projectTotals(client, projectRows, season),
    fundTotals(client, fundRows, season),
  ]);
  const projects = sortByDesc(
    mapSome(projectRows, (row) => formatProject(row, money.get(String(row['_id'] ?? '')))),
    (project) => project.raised,
  );
  const display = text(profile?.['name']) || projectCreator(projectRows[0]) || names[0] || titleCase(query);
  if (!accounts.length && !projects.length && !funds.length) return null;

  return {
    slug,
    name: display,
    bio: text(profile?.['bio']),
    image: mediaUrl(profile?.['profile image']) || firstProjectImage(projectRows),
    website: text(profile?.['website']),
    twitter: text(profile?.['Twitter']),
    instagram: text(profile?.['instagram']),
    points: maybePoints(profile?.['points - current']),
    seasons,
    season,
    projects,
    funds,
  };
}

async function findAccounts(client: Bubble, slug: string, query: string): Promise<Row[]> {
  const guesses = unique([query, titleCase(query)]);
  const exact = (
    await Promise.all(guesses.map((name) => client.findBy('useraccount', 'name', name, 20)))
  ).flat();
  const matched = exact.filter((row) => creatorSlug(text(row['name']) || '') === slug);
  if (matched.length) return uniqueById(matched);

  const needles = unique([query, creatorNeedle(slug)].filter((needle) => needle.length >= 2));
  const contains = (
    await Promise.all(
      needles.map((needle) =>
        client.getResults('useraccount', {
          limit: 50,
          constraints: [{ key: 'name', constraint_type: 'text contains', value: needle }],
        }),
      ),
    )
  ).flat();
  return uniqueById(contains.filter((row) => creatorSlug(text(row['name']) || '') === slug));
}

async function findProjects(client: Bubble, slug: string, accounts: Row[], query: string): Promise<Row[]> {
  const accountIds = ids(accounts.map((row) => row['_id']));
  const rows = accountIds.length
    ? await client.listWhereIn('project', USER_ACCOUNT, accountIds)
    : await client.list('project', {
        constraints: [
          {
            key: LEAD_CREATOR,
            constraint_type: 'text contains',
            value: creatorNeedle(slug).length >= 2 ? creatorNeedle(slug) : query,
          },
        ],
      });
  return uniqueById(
    rows.filter((row) => {
      if (hidden(row) || !text(row['Name'])) return false;
      return accountIds.length ? true : creatorSlug(projectCreator(row) || '') === slug;
    }),
  );
}

async function findAdminFunds(client: Bubble, accounts: Row[]): Promise<Row[]> {
  const accountIds = ids(accounts.map((row) => row['_id']));
  if (accountIds.length === 0) return [];
  return uniqueById(
    (
      await Promise.all(
        accountIds.map((id) =>
          client.list('fund', {
            constraints: [{ key: 'admins', constraint_type: 'contains', value: id }],
          }),
        ),
      )
    ).flat(),
  );
}

async function findSponsoredFunds(client: Bubble, names: string[]): Promise<Row[]> {
  if (names.length === 0) return [];
  const extended = (
    await Promise.all(
      names.map((name) =>
        client.list('fundextendedinfo', {
          constraints: [{ key: 'lead sponsor (text)', constraint_type: 'equals', value: name }],
        }),
      ),
    )
  ).flat();
  return Object.values(await client.indexed('fund', ids(extended.map((row) => row['Fund']))));
}

async function projectTotals(client: Bubble, projects: Row[], season: Season | null): Promise<Map<string, ProjectMoney>> {
  const projectIds = ids(projects.map((row) => row['_id']));
  const out = new Map<string, ProjectMoney>();
  if (projectIds.length === 0) return out;

  const seasonsMeta = await client.seasonsById();
  const [seasonRows, slices, participants, submissions, venusLists] = await Promise.all([
    client.listWhereIn('projectseason', 'project', projectIds),
    client.listWhereIn('projectfundboostslice', 'project', projectIds),
    client.listWhereIn('boostparticipant', 'project', projectIds),
    client.listWhereIn('projectsubmission', 'Project', projectIds),
    Promise.all(projectIds.map((id) => client.venusTransactions({ projectId: id }))),
  ]);
  const venusByProject = new Map(projectIds.map((id, i) => [id, venusLists[i]]));
  const boostIds = ids([...slices, ...participants].map((row) => row['boost']));
  const drives = await client.fetchNormalizedDrives(boostIds, seasonsMeta);
  const bonusDrives = drives.filter((drive) => driveHasBonusPot(drive) && !drive.active);
  const weightSums = await Promise.all(bonusDrives.map((drive) => client.driveBonusWeightSum(drive.id, 'project')));

  for (const project of projects) {
    const id = String(project['_id'] ?? '');
    const mine = (row: Row, key: string) => String(row[key] ?? '') === id;
    const mySeasons = seasonRows.filter((row) => mine(row, 'project'));
    const mySlices = slices.filter((row) => mine(row, 'project'));
    const myParts = participants.filter((row) => mine(row, 'project'));
    const mySubs = submissions.filter((row) => mine(row, 'Project'));
    const venusBySeason: Record<string, number> = {};
    const sprintBySeason: Record<string, number> = {};
    for (const tx of venusByProject.get(id) || []) {
      const seasonKey = String(tx['Season'] ?? '');
      const split = venusSplit(tx);
      bump(venusBySeason, seasonKey, split.venus);
      bump(sprintBySeason, seasonKey, split.sprint);
    }
    const prizeBySeason: Record<string, number> = {};
    for (const part of myParts) {
      const prize = num(part['prize earned usd']);
      if (!(prize > 0)) continue;
      const seasonId = part['season'] || drives.find((drive) => drive.id == part['boost'])?.season_id;
      if (seasonId != null && seasonId !== false) bump(prizeBySeason, String(seasonId), prize);
    }
    const bonusBySeason: Record<string, number> = {};
    bonusDrives.forEach((drive, i) => {
      const part = myParts.find((row) => String(row['boost'] ?? '') === drive.id);
      const bonus = bonusShare(num(part?.['boost points received']), weightSums[i], num(drive.bonus_projects));
      if (bonus > 0 && drive.season_id != null && drive.season_id !== false) {
        bump(bonusBySeason, String(drive.season_id), bonus);
      }
    });

    const seasons = mapSome(mySeasons, (srow) => {
      const meta = byId(seasonsMeta, srow['season ']);
      const seasonKey = String(srow['season '] ?? '');
      const funding = seasonFunding(
        srow,
        { venus: venusBySeason[seasonKey], sprint: sprintBySeason[seasonKey] },
        prizeBySeason[seasonKey],
        Math.max(num(bonusBySeason[seasonKey]), num(srow['funding bonus'])),
      );
      if (!(funding.raised > 0)) return undefined;
      const number =
        srow['season number'] != null && srow['season number'] !== false
          ? (srow['season number'] as number)
          : meta?.number;
      return { number, title: seasonLabel(number, meta?.title), ...funding } satisfies ProjectFundingSeason;
    });
    appendLegacyProjectSeasons(seasons, project, seasonsMeta);
    applyLegacySubmissionAwards(seasons, mySubs, seasonsMeta);
    const scoped = season ? seasons.filter((row) => row.number === season.number) : seasons;

    let available = 0;
    if (!season || season.current) {
      for (const [boostId, grouped] of groupBy(mySlices, (row) => row['boost'])) {
        if (!boostId) continue;
        const leftover = leftoverMatch(grouped);
        const drive = drives.find((item) => item.id == boostId);
        if (drive?.active && leftover > 0) available += leftover;
      }
    }

    out.set(id, {
      sales: sum(scoped, (row) => row.sales),
      venus: sum(scoped, (row) => row.venus),
      match: sum(scoped, (row) => row.match),
      prize: sum(scoped, (row) => row.prize),
      bonus: sum(scoped, (row) => num(row.bonus)),
      sprint: sum(scoped, (row) => num(row.sprint)),
      raised: sum(scoped, (row) => row.raised),
      available,
    });
  }
  return out;
}

async function fundTotals(client: Bubble, rows: Row[], season: Season | null): Promise<CreatorFund[]> {
  const kept = rows.filter((row) => !hidden(row) && (text(row['name']) || text(row['_id'])));
  if (kept.length === 0) return [];
  const fundIds = ids(kept.map((row) => row['_id']));
  const extIds = ids(kept.map((row) => row['Extended info']));
  const current = Boolean(season?.current);
  const contribConstraints: Constraint[] = [
    { key: 'confirmed', constraint_type: 'equals', value: true },
  ];
  if (season?.id) contribConstraints.push({ key: 'Season', constraint_type: 'equals', value: season.id });
  const [contribs, unlocked, extById] = await Promise.all([
    client.listWhereIn('fundcontribution', 'Fund', fundIds, contribConstraints),
    current ? fundUnlocked(client, fundIds) : Promise.resolve({} as Record<string, number>),
    extIds.length ? client.indexed('fundextendedinfo', extIds) : Promise.resolve({} as Record<string, Row>),
  ]);
  const contribByFund: Record<string, number> = {};
  for (const row of contribs) bump(contribByFund, String(row['Fund'] ?? ''), num(row['amount $USD']));

  return sortByDesc(
    mapSome(kept, (row) => {
      const id = String(row['_id'] ?? '');
      const ext = extById[String(row['Extended info'] ?? '')];
      const name = text(ext?.['full title']) || text(row['name']);
      if (!name) return undefined;
      const fundSlug = text(row['Slug']) ?? id;
      const available = current ? num(row['Funding - current']) : 0;
      const unlockedAmt = current ? num(unlocked[id]) : 0;
      return {
        name,
        url: localFundPath(fundSlug),
        subtitle: text(ext?.['subtitle']),
        created_at: row['Created Date'],
        active: row['active'],
        contrib_total: num(contribByFund[id]),
        unlocked: unlockedAmt,
        available,
        raised: unlockedAmt + available,
      } satisfies CreatorFund;
    }),
    (fund) => (fund.active === false ? 0 : 1),
    (fund) => (current ? fund.raised : fund.contrib_total),
  );
}

async function fundUnlocked(client: Bubble, fundIds: unknown[]): Promise<Record<string, number>> {
  const unlocked: Record<string, number> = {};
  const slices = await client.listWhereIn('projectfundboostslice', 'fund', fundIds, [
    { key: 'match unlocked', constraint_type: 'greater than', value: 0 },
  ]);
  for (const slice of slices) bump(unlocked, String(slice['fund'] ?? ''), num(slice['match unlocked']));
  for (const row of await client.listFundAwards(fundIds)) {
    bump(unlocked, String(row['Fund'] ?? ''), num(row['$ amount raised']));
  }
  return unlocked;
}

function formatProject(row: Row, money?: ProjectMoney): CreatorProject | undefined {
  const name = text(row['Name']);
  const projectSlug = text(row['Slug']) ?? row['_id'];
  if (!name || projectSlug == null) return undefined;
  return {
    name,
    url: localProjectPath(projectSlug),
    logline: text(row['Logline']),
    sales: money?.sales ?? 0,
    venus: money?.venus ?? 0,
    match: money?.match ?? 0,
    prize: money?.prize ?? 0,
    bonus: money?.bonus,
    sprint: money?.sprint,
    raised: money?.raised ?? 0,
    available: money?.available,
  };
}

function mergeFundRows(rows: Row[]): Row[] {
  return uniqueById(rows.filter((row) => !hidden(row)));
}

function pickProfile(accounts: Row[]): Row | undefined {
  return [...accounts].sort((a, b) => {
    const points = num(b['points - current']) - num(a['points - current']);
    if (points) return points;
    const bio = Number(Boolean(text(b['bio']))) - Number(Boolean(text(a['bio'])));
    if (bio) return bio;
    return Number(Boolean(mediaUrl(b['profile image']))) - Number(Boolean(mediaUrl(a['profile image'])));
  })[0];
}

function projectCreator(row?: Row): string | undefined {
  return row ? text(row[LEAD_CREATOR]) : undefined;
}

function firstProjectImage(rows: Row[]): string | undefined {
  for (const row of rows) {
    const image = firstMedia(row['Profile image lead creator'], row['(old) Artifact Image -crop']);
    if (image) return image;
  }
}

function maybePoints(value: unknown): number | undefined {
  const points = num(value);
  return points > 0 ? points : undefined;
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueById(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const id = text(row['_id']) || JSON.stringify(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}
