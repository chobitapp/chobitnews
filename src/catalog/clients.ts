import type {
  GithubAdvisory,
  GithubRelease,
  OssClients,
  OssFixture,
  OssNpmRecord,
  WorldFixture,
} from "./types.ts";

const USER_AGENT = "chobitnews";

export function createFixtureClients(
  world: WorldFixture,
  oss: OssFixture,
): OssClients {
  return {
    async readPackageJson(repo: string): Promise<string | null> {
      const manifest = world.manifests[repo];
      if (!manifest) {
        return null;
      }
      return JSON.stringify(manifest);
    },
    async npmPackage(name: string): Promise<OssNpmRecord | null> {
      return oss.npm[name] ?? { repository: null };
    },
    async listReleases(repo: string): Promise<GithubRelease[]> {
      return (oss.releases[repo] ?? []).map((row) => ({
        tagName: row.tag_name,
        publishedAt: row.published_at ?? null,
        htmlUrl: row.html_url ?? null,
        body: row.body ?? null,
      }));
    },
    async listAdvisories(packageName: string): Promise<GithubAdvisory[]> {
      return (oss.advisories[packageName] ?? []).map((row) => ({
        ghsaId: row.ghsa_id,
        publishedAt: row.published_at ?? null,
        summary: row.summary ?? null,
        htmlUrl: row.html_url ?? null,
      }));
    },
  };
}

export function createLiveClients(token: string): OssClients {
  if (token.startsWith("fixture:")) {
    throw new Error(
      "fixture の OAuth 行は GitHub に使えない。gh auth を使う。",
    );
  }
  return {
    async readPackageJson(repo: string): Promise<string | null> {
      const [owner, name] = splitRepo(repo);
      if (!owner || !name) {
        return null;
      }
      const res = await githubFetch(
        token,
        `https://api.github.com/repos/${owner}/${name}/contents/package.json`,
        { Accept: "application/vnd.github.raw+json" },
      );
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`GitHub contents ${repo}: ${res.status}`);
      }
      return res.text();
    },
    async npmPackage(name: string): Promise<OssNpmRecord | null> {
      const res = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}`,
        { headers: { "User-Agent": USER_AGENT } },
      );
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`npm ${name}: ${res.status}`);
      }
      return (await res.json()) as OssNpmRecord;
    },
    async listReleases(repo: string): Promise<GithubRelease[]> {
      const [owner, name] = splitRepo(repo);
      if (!owner || !name) {
        return [];
      }
      const res = await githubFetch(
        token,
        `https://api.github.com/repos/${owner}/${name}/releases?per_page=30`,
      );
      if (res.status === 404) {
        return [];
      }
      if (!res.ok) {
        throw new Error(`GitHub releases ${repo}: ${res.status}`);
      }
      const rows = (await res.json()) as {
        tag_name?: string;
        published_at?: string | null;
        html_url?: string | null;
        body?: string | null;
      }[];
      const releases: GithubRelease[] = [];
      for (const row of rows) {
        if (typeof row.tag_name !== "string") {
          continue;
        }
        releases.push({
          tagName: row.tag_name,
          publishedAt: row.published_at ?? null,
          htmlUrl: row.html_url ?? null,
          body: row.body ?? null,
        });
      }
      return releases;
    },
    async listAdvisories(packageName: string): Promise<GithubAdvisory[]> {
      const url = `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(packageName)}&per_page=10`;
      const res = await githubFetch(token, url);
      if (!res.ok) {
        throw new Error(`GitHub advisories ${packageName}: ${res.status}`);
      }
      const rows = (await res.json()) as {
        ghsa_id?: string;
        published_at?: string | null;
        summary?: string | null;
        html_url?: string | null;
        vulnerabilities?: { package?: { ecosystem?: string; name?: string } }[];
      }[];
      const advisories: GithubAdvisory[] = [];
      for (const row of rows) {
        if (typeof row.ghsa_id !== "string") {
          continue;
        }
        const hits = row.vulnerabilities ?? [];
        const matches =
          hits.length === 0 ||
          hits.some(
            (v) =>
              v.package?.ecosystem === "npm" && v.package.name === packageName,
          );
        if (!matches) {
          continue;
        }
        advisories.push({
          ghsaId: row.ghsa_id,
          publishedAt: row.published_at ?? null,
          summary: row.summary ?? null,
          htmlUrl: row.html_url ?? null,
        });
      }
      return advisories;
    },
  };
}

function splitRepo(repo: string): [string | undefined, string | undefined] {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) {
    return [undefined, undefined];
  }
  return [owner, name];
}

async function githubFetch(
  token: string,
  url: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    },
  });
}
