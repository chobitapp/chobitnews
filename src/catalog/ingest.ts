import { deskNamesFromManifest, parseManifestJson } from "./desk.ts";
import { githubRepoFromNpm, tagMatchesPackage, truncateUtf8 } from "./npm.ts";
import type { CatalogStore } from "./store.ts";
import type { IngestStats, OssClients, PackageRow } from "./types.ts";

export async function ingestUserOss(
  store: CatalogStore,
  clients: OssClients,
  userId: string,
  now = new Date().toISOString(),
): Promise<IngestStats> {
  const repos = await store.listIncludedRepos(userId);
  const names = new Set<string>();
  let manifests = 0;
  const incomplete: string[] = [];

  for (const repo of repos) {
    let source: string | null;
    try {
      source = await clients.readPackageJson(repo.repo);
    } catch {
      incomplete.push(`manifest:${repo.repo}`);
      continue;
    }
    if (source === null) {
      continue;
    }
    const manifest = parseManifestJson(source);
    if (!manifest) {
      incomplete.push(`manifest:${repo.repo}`);
      continue;
    }
    manifests += 1;
    for (const name of deskNamesFromManifest(manifest)) {
      names.add(name);
    }
  }

  const sorted = [...names].sort();
  for (const name of sorted) {
    const existing = await store.getPackage(name);
    if (existing) {
      continue;
    }
    await store.upsertPackage({
      name,
      ecosystem: "npm",
      githubRepo: null,
      npmDirectory: null,
      npmFetchedAt: null,
      createdAt: now,
    });
  }
  await store.replaceUserPackages(userId, sorted);

  const mappedRepos = new Map<string, { names: string[]; monorepo: boolean }>();
  let mapped = 0;
  let unmapped = 0;
  let releases = 0;
  let advisories = 0;

  for (const name of sorted) {
    const pkg = await store.getPackage(name);
    if (!pkg) {
      continue;
    }
    const resolved = await resolveGithubRepo(
      store,
      clients,
      pkg,
      now,
      incomplete,
    );
    if (resolved.githubRepo) {
      mapped += 1;
      const group = mappedRepos.get(resolved.githubRepo) ?? {
        names: [],
        monorepo: false,
      };
      group.names.push(name);
      if (resolved.npmDirectory) {
        group.monorepo = true;
      }
      mappedRepos.set(resolved.githubRepo, group);
    } else {
      unmapped += 1;
    }

    try {
      const rows = await clients.listAdvisories(name);
      for (const row of rows) {
        await store.upsertAdvisory({
          packageName: name,
          ghsaId: row.ghsaId,
          publishedAt: row.publishedAt,
          summary: row.summary,
          htmlUrl: row.htmlUrl,
          fetchedAt: now,
        });
        advisories += 1;
      }
    } catch {
      incomplete.push(`advisory:${name}`);
    }
  }

  const fetchedRepos = new Map<
    string,
    Awaited<ReturnType<OssClients["listReleases"]>>
  >();
  for (const [githubRepo, group] of mappedRepos) {
    let tags = fetchedRepos.get(githubRepo);
    if (!tags) {
      try {
        tags = await clients.listReleases(githubRepo);
      } catch {
        for (const name of group.names) {
          incomplete.push(`release:${name}`);
        }
        continue;
      }
      fetchedRepos.set(githubRepo, tags);
    }
    const monorepo = group.monorepo || group.names.length > 1;
    for (const name of group.names) {
      for (const tag of tags) {
        if (!tagMatchesPackage(tag.tagName, name, monorepo)) {
          continue;
        }
        await store.upsertRelease({
          packageName: name,
          tagName: tag.tagName,
          publishedAt: tag.publishedAt,
          htmlUrl: tag.htmlUrl,
          body: tag.body === null ? null : truncateUtf8(tag.body),
          fetchedAt: now,
        });
        releases += 1;
      }
    }
  }

  return {
    userId,
    repos: repos.length,
    manifests,
    packages: sorted.length,
    mapped,
    unmapped,
    releases,
    advisories,
    incomplete,
  };
}

async function resolveGithubRepo(
  store: CatalogStore,
  clients: OssClients,
  pkg: PackageRow,
  now: string,
  incomplete: string[],
): Promise<PackageRow> {
  if (pkg.githubRepo) {
    return pkg;
  }
  try {
    const npm = await clients.npmPackage(pkg.name);
    const mapping = githubRepoFromNpm(npm?.repository);
    await store.upsertPackage({
      ...pkg,
      githubRepo: mapping.githubRepo,
      npmDirectory: mapping.directory,
      npmFetchedAt: now,
    });
    const updated = await store.getPackage(pkg.name);
    return updated ?? pkg;
  } catch {
    incomplete.push(`npm:${pkg.name}`);
    return pkg;
  }
}
