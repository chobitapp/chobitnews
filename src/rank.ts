import type { PackageAdvisory, PackageRelease } from "./catalog/types.ts";

export type CopyKind = "security" | "major" | "minor" | "patch" | "other";
export type Visibility = "print" | "human" | "silent" | "deferred";

export function semver(tag: string): string | null {
  const match = /(?:^|@)v?(\d+)\.(\d+)(?:\.(\d+))?(?:\+[\w.-]+)?$/.exec(tag);
  return match ? `${match[1]}.${match[2]}.${match[3] ?? "0"}` : null;
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export function tagKind(tag: string): CopyKind | null {
  const version = semver(tag);
  if (!version) return null;
  const [, minor, patch] = version.split(".").map(Number);
  return patch ? "patch" : minor ? "minor" : "major";
}

export function validateEditionDate(date: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("--date は実在する YYYY-MM-DD 日付が必要");
  }
}

export function lookbackStart(date: string): string {
  validateEditionDate(date);
  return new Date(Date.parse(date) - 21 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function visibleOn(published: string | null, date: string): boolean {
  return (
    !!published &&
    !Number.isNaN(Date.parse(published)) &&
    new Date(published).toISOString().slice(0, 10) <= date
  );
}

export type RankResult = {
  kind: CopyKind | null;
  rank: number | null;
  visibility: "print_candidate" | "human" | "silent" | "skip";
  releases: PackageRelease[];
  advisories: PackageAdvisory[];
  latest: PackageRelease | null;
  primary: PackageRelease | null;
  publishedAt: string | null;
  reason: string;
};

/** 保存済みデータだけを見る。未来・日付不明・pre-release は号へ入れない。 */
export function rankFromRaw(input: {
  date: string;
  releases: PackageRelease[];
  advisories: PackageAdvisory[];
  cursorVersion: string | null;
  seenAdvisories: Set<string>;
}): RankResult {
  const start = lookbackStart(input.date);
  const releases = input.releases
    .filter((r) => semver(r.tagName) && visibleOn(r.publishedAt, input.date))
    .sort(
      (a, b) =>
        compareVersions(
          semver(b.tagName) ?? "0.0.0",
          semver(a.tagName) ?? "0.0.0",
        ) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
  const latest = releases[0] ?? null;
  const windowReleases = releases.filter((r) =>
    input.cursorVersion
      ? compareVersions(semver(r.tagName) ?? "0.0.0", input.cursorVersion) > 0
      : (r.publishedAt ?? "").slice(0, 10) >= start,
  );
  const advisories = input.advisories.filter(
    (a) =>
      visibleOn(a.publishedAt, input.date) &&
      (a.publishedAt ?? "").slice(0, 10) >= start &&
      !input.seenAdvisories.has(a.ghsaId),
  );
  const primary = windowReleases[0] ?? latest;
  const publishedAt =
    [...windowReleases, ...advisories]
      .map((r) => r.publishedAt)
      .filter((s): s is string => !!s)
      .sort()
      .at(-1) ??
    latest?.publishedAt ??
    null;
  const base = {
    releases: windowReleases,
    advisories,
    latest,
    primary,
    publishedAt,
  };
  if (
    !advisories.length &&
    latest &&
    input.cursorVersion &&
    compareVersions(semver(latest.tagName) ?? "0.0.0", input.cursorVersion) <= 0
  ) {
    return {
      ...base,
      kind: null,
      rank: null,
      visibility: "silent",
      reason: "既出",
    };
  }
  if (advisories.length)
    return {
      ...base,
      kind: "security",
      rank: 100,
      visibility: "print_candidate",
      reason: "新しい公開 GHSA",
    };
  const kinds = windowReleases.map((r) => tagKind(r.tagName));
  const kind = kinds.includes("major")
    ? "major"
    : kinds.includes("minor")
      ? "minor"
      : kinds.includes("patch")
        ? "patch"
        : null;
  if (kind === "patch")
    return { ...base, kind, rank: 20, visibility: "human", reason: "パッチ" };
  if (kind && publishedAt && publishedAt.slice(0, 10) >= start) {
    return {
      ...base,
      kind,
      rank: kind === "major" ? 80 : 60,
      visibility: "print_candidate",
      reason: "新しいリリース",
    };
  }
  if (
    latest &&
    tagKind(latest.tagName) === "major" &&
    (latest.publishedAt ?? "").slice(0, 10) < start
  ) {
    return {
      ...base,
      kind: "major",
      rank: 10,
      visibility: "human",
      reason: "大きな変更だが今日の最新ではない",
    };
  }
  return {
    ...base,
    kind: null,
    rank: null,
    visibility: "skip",
    reason: "窓内のニュースなし",
  };
}

export function parseStoryId(id: string): {
  type: string;
  packageName: string;
  event: string;
} {
  const first = id.indexOf(":");
  const last = id.lastIndexOf(":");
  if (first <= 0 || last <= first || last === id.length - 1)
    throw new Error(`Story id 不正: ${id}`);
  return {
    type: id.slice(0, first),
    packageName: id.slice(first + 1, last),
    event: id.slice(last + 1),
  };
}
