import { readFileSync } from "node:fs";
import type { CatalogStore } from "./catalog/store.ts";

export type GenerateFixture = {
  edition_date: string;
  users: {
    id: string;
    github_login: string;
    github_id: string;
    packages: string[];
  }[];
  packages: { name: string; ecosystem: string; github_repo: string | null }[];
  releases: {
    package_name: string;
    tag_name: string;
    published_at: string | null;
    html_url: string | null;
    body: string | null;
  }[];
  advisories: {
    package_name: string;
    ghsa_id: string;
    published_at: string | null;
    summary: string | null;
    html_url: string | null;
  }[];
};

export function readGenerateFixture(path: string): GenerateFixture {
  const data = JSON.parse(readFileSync(path, "utf8")) as GenerateFixture;
  if (
    !data ||
    !Array.isArray(data.users) ||
    !Array.isArray(data.packages) ||
    !Array.isArray(data.releases) ||
    !Array.isArray(data.advisories)
  )
    throw new Error("生成 fixture の形式が不正");
  return data;
}

export async function loadGenerateNight(
  store: CatalogStore,
  fixture: GenerateFixture,
): Promise<void> {
  const now = `${fixture.edition_date}T00:00:00.000Z`;
  for (const u of fixture.users)
    await store.upsertUser({
      id: u.id,
      githubLogin: u.github_login,
      githubId: u.github_id,
      createdAt: now,
    });
  for (const p of fixture.packages)
    await store.upsertPackage({
      name: p.name,
      ecosystem: p.ecosystem,
      githubRepo: p.github_repo,
      npmDirectory: null,
      npmFetchedAt: null,
      createdAt: now,
    });
  for (const u of fixture.users)
    await store.replaceUserPackages(u.id, u.packages);
  for (const r of fixture.releases)
    await store.upsertRelease({
      packageName: r.package_name,
      tagName: r.tag_name,
      publishedAt: r.published_at,
      htmlUrl: r.html_url,
      body: r.body,
      fetchedAt: now,
    });
  for (const a of fixture.advisories)
    await store.upsertAdvisory({
      packageName: a.package_name,
      ghsaId: a.ghsa_id,
      publishedAt: a.published_at,
      summary: a.summary,
      htmlUrl: a.html_url,
      fetchedAt: now,
    });
}
