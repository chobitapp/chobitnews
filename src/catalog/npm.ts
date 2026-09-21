import type { NpmMapping } from "./types.ts";

const RELEASE_BODY_MAX_BYTES = 8 * 1024;

export function githubRepoFromNpm(repository: unknown): NpmMapping {
  if (typeof repository === "string") {
    return { githubRepo: normalizeGithubRepo(repository), directory: null };
  }
  if (typeof repository !== "object" || repository === null) {
    return { githubRepo: null, directory: null };
  }
  const rec = repository as { url?: unknown; directory?: unknown };
  const url = typeof rec.url === "string" ? rec.url : null;
  const directory = typeof rec.directory === "string" ? rec.directory : null;
  return {
    githubRepo: url ? normalizeGithubRepo(url) : null,
    directory,
  };
}

export function normalizeGithubRepo(url: string): string | null {
  const trimmed = url.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) {
    return formatRepo(ssh[1], ssh[2]);
  }
  const hosted = trimmed.match(
    /(?:github\.com[:/]|git\+ssh:\/\/git@github\.com:)([^/]+)\/([^/#?]+)/i,
  );
  if (!hosted) {
    return null;
  }
  return formatRepo(hosted[1], hosted[2]);
}

function formatRepo(
  owner: string | undefined,
  name: string | undefined,
): string | null {
  if (!owner || !name) {
    return null;
  }
  const repo = name.replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!owner || !repo) {
    return null;
  }
  return `${owner}/${repo}`;
}

export function tagMatchesPackage(
  tagName: string,
  packageName: string,
  monorepo: boolean,
): boolean {
  if (!monorepo) {
    return true;
  }
  const tag = tagName.toLowerCase();
  const name = packageName.toLowerCase();
  if (tag.includes(name)) {
    return true;
  }
  const slash = name.lastIndexOf("/");
  const unscoped = slash >= 0 ? name.slice(slash + 1) : name;
  return (
    tag === unscoped ||
    tag === `v${unscoped}` ||
    tag.startsWith(`${unscoped}@`) ||
    tag.includes(`/${unscoped}@`)
  );
}

export function truncateUtf8(
  text: string,
  maxBytes = RELEASE_BODY_MAX_BYTES,
): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}
