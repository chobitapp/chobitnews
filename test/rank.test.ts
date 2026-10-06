import { describe, expect, it } from "vitest";
import type { PackageAdvisory, PackageRelease } from "../src/catalog/types.ts";
import {
  compareVersions,
  parseStoryId,
  rankFromRaw,
  semver,
  validateEditionDate,
} from "../src/rank.ts";

const release = (
  tag: string,
  date: string | null = "2026-09-15",
): PackageRelease => ({
  packageName: "demo",
  tagName: tag,
  publishedAt: date,
  body: "変更",
  htmlUrl: null,
  fetchedAt: "2026-09-21",
});
const advisory = (date: string | null = "2025-01-01"): PackageAdvisory => ({
  packageName: "demo",
  ghsaId: "GHSA-test",
  publishedAt: date,
  summary: "修正",
  htmlUrl: null,
  fetchedAt: "2026-09-21",
});
function rank(
  releases: PackageRelease[],
  advisories: PackageAdvisory[] = [],
  cursorVersion: string | null = null,
) {
  return rankFromRaw({
    date: "2026-09-21",
    releases,
    advisories,
    cursorVersion,
    seenAdvisories: new Set(),
  });
}

describe("機械 rank と窓", () => {
  it("tag 自体の形でクラスを決める", () => {
    expect(rank([release("v5.0.1"), release("v5.0.0")])).toMatchObject({
      kind: "major",
      rank: 80,
    });
    expect(rank([release("wrangler@4.135.0")], [], "3.0.0")).toMatchObject({
      kind: "minor",
      rank: 60,
    });
    expect(rank([release("v2.0.1")])).toMatchObject({
      kind: "patch",
      rank: 20,
      visibility: "human",
    });
  });
  it("古い major は human、古い patch と古い GHSA は skip", () => {
    expect(rank([release("v7.0.0", "2026-07-08")])).toMatchObject({
      rank: 10,
      visibility: "human",
    });
    expect(rank([release("v2.0.1", "2026-07-08")])).toMatchObject({
      visibility: "skip",
    });
    expect(rank([], [advisory()])).toMatchObject({ visibility: "skip" });
  });
  it("cursor 一致 + 古い GHSA と、human 翌日は silent", () => {
    expect(rank([release("v2.0.1")], [advisory()], "2.0.1")).toMatchObject({
      visibility: "silent",
    });
    expect(rank([release("v7.0.0", "2026-07-08")], [], "7.0.0")).toMatchObject({
      visibility: "silent",
    });
  });
  it("cursor があっても古い advisory を掲載しない", () => {
    expect(rank([release("v1.1.0")], [advisory()], "1.0.0")).toMatchObject({
      kind: "minor",
      rank: 60,
    });
    expect(rank([], [advisory("2026-09-04")])).toMatchObject({
      kind: "security",
      rank: 100,
    });
  });
  it("未来・日付無し・pre-release・分類不能をニュースにしない", () => {
    for (const r of [
      release("v8.0.0", "2026-09-22"),
      release("v8.0.0", null),
      release("v8.0.0-rc.1"),
      release("latest"),
    ]) {
      expect(rank([r])).toMatchObject({ visibility: "skip" });
    }
    expect(rank([], [advisory(null), advisory("2026-09-22")])).toMatchObject({
      visibility: "skip",
    });
  });
  it("semver と scoped package の Story id を扱う", () => {
    expect(semver("@biomejs/biome@2.5.14")).toBe("2.5.14");
    expect(semver("v5.0")).toBe("5.0.0");
    expect(semver("v5.0.0-beta.1")).toBeNull();
    expect(compareVersions("4.135.0", "4.99.0")).toBeGreaterThan(0);
    expect(parseStoryId("release:@biomejs/biome:2.5.14")).toEqual({
      type: "release",
      packageName: "@biomejs/biome",
      event: "2.5.14",
    });
  });
  it("存在しない号日を拒否する", () => {
    expect(() => validateEditionDate("2026-02-30")).toThrow();
    expect(() => validateEditionDate("today")).toThrow();
  });
});
