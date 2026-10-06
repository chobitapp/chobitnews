import { createHash } from "node:crypto";
import { renderEditionFromCopies } from "./assemble.ts";
import type { CopyFact } from "./copy.ts";
import {
  completePackageCopy,
  GatewayError,
  type LlmConfig,
  type PackageLlmInput,
  type PackageLlmOutput,
} from "./llm.ts";
import type {
  CursorUpdate,
  NightDecision,
  PackageCopy,
  PaperItem,
  SqlitePaperStore,
  UserPaper,
} from "./paper-store.ts";
import {
  compareVersions,
  parseStoryId,
  type RankResult,
  rankFromRaw,
  semver,
  tagKind,
  validateEditionDate,
} from "./rank.ts";
import type { Edition } from "./types.ts";

type Candidate = {
  name: string;
  rank: RankResult;
  input: PackageLlmInput;
  fact: CopyFact;
  storyIds: string[];
};
export type GenerateStats = {
  print: number;
  human: number;
  silent: number;
  deferred: number;
  windowEmpty: number;
  llmOk: number;
  llmFallback: number;
  copiesWritten: number;
  copyReused: number;
  editionReused: boolean;
};

function inputFor(name: string, rank: RankResult): PackageLlmInput {
  return {
    package: name,
    releases: rank.releases.map((r) => ({
      tag: r.tagName,
      publishedAt: r.publishedAt,
      htmlUrl: r.htmlUrl,
      body: r.body,
    })),
    advisories: rank.advisories.map((a) => ({
      ghsa: a.ghsaId,
      publishedAt: a.publishedAt,
      summary: a.summary,
      htmlUrl: a.htmlUrl,
    })),
  };
}

function bodyPoints(body: string | null): string[] {
  return (body ?? "")
    .split("\n")
    .map((line) =>
      line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, "").trim(),
    )
    .filter(
      (line) =>
        line && !/^v?\d+\.\d+/.test(line) && !/^[\w@/.-]+@\d+\.\d+/.test(line),
    );
}

function dateJa(date: string | null): string {
  const parts = date?.slice(0, 10).split("-").map(Number);
  return parts?.[1] && parts[2] ? `${parts[1]}月${parts[2]}日` : "";
}

function factFor(name: string, rank: RankResult, storyId: string): CopyFact {
  const release = rank.primary;
  const focus =
    rank.releases.find((r) => tagKind(r.tagName) === rank.kind) ?? release;
  const version = release ? (semver(release.tagName) ?? "") : "";
  const advisoryPoints = rank.advisories.map(
    (a) =>
      `${dateJa(a.publishedAt)}公開の ${a.ghsaId}: ${a.summary ?? "公開セキュリティ情報"}`,
  );
  const ordered = [...rank.releases].sort(
    (a, b) => Number(b === focus) - Number(a === focus),
  );
  const releasePoints = ordered.flatMap((r) => {
    const points = bodyPoints(r.body);
    return points.length
      ? points.map((p, i) =>
          i === 0
            ? `${dateJa(r.publishedAt)}、${semver(r.tagName) ?? r.tagName} を公開。${p}`
            : p,
        )
      : [`${dateJa(r.publishedAt)}、${semver(r.tagName) ?? r.tagName} を公開`];
  });
  const points = [...advisoryPoints, ...releasePoints].slice(0, 8);
  const thesis =
    rank.advisories[0]?.summary ??
    bodyPoints(focus?.body ?? null)[0] ??
    "リリース公開";
  const sources = [
    ...new Set(
      [
        ...rank.advisories.map((a) => a.htmlUrl),
        ...rank.releases.map((r) => r.htmlUrl),
      ].filter((s): s is string => !!s),
    ),
  ];
  return {
    storyId,
    subject: name,
    decision:
      rank.visibility === "human" || rank.visibility === "silent"
        ? "hold"
        : "print_new",
    occurredOn: rank.publishedAt?.slice(0, 10) ?? "",
    versionLabel: version,
    thesis: thesis.split("。")[0]?.slice(0, 40) ?? "リリース公開",
    points: points.length ? points : ["リリースが公開された"],
    sources,
    holdReason: rank.reason,
  };
}

function templateCopy(c: Candidate): PackageLlmOutput {
  return {
    headline: `${c.name}${c.rank.kind !== "security" && c.fact.versionLabel ? ` ${c.fact.versionLabel}` : ""}: ${c.fact.thesis}`,
    lead: `${c.fact.points.map((p) => p.replace(/。$/, "")).join("。 ")}。`,
    sources: c.fact.sources,
    kind: c.rank.kind ?? "other",
  };
}

/** 許可集合は入力内の数字 + UTC/JST 日付とその月日。事実の意味全体の検証ではない。 */
export function validateGeneratedCopy(
  copy: PackageLlmOutput,
  input: PackageLlmInput,
  expectedKind: string,
): void {
  if (copy.kind !== expectedKind) throw new Error("kind 不一致");
  const allowedUrls = new Set(
    [...input.releases, ...input.advisories]
      .map((r) => r.htmlUrl)
      .filter(Boolean),
  );
  const text = `${copy.headline}\n${copy.lead}`;
  const textUrls = text.match(/https?:\/\/[^\s<>「」]+/g) ?? [];
  if ([...copy.sources, ...textUrls].some((url) => !allowedUrls.has(url)))
    throw new Error("入力にない URL");
  const raw = JSON.stringify(input);
  const numbers = new Set(raw.match(/\d+/g) ?? []);
  for (const event of [...input.releases, ...input.advisories]) {
    if (!event.publishedAt) continue;
    const date = new Date(event.publishedAt);
    if (Number.isNaN(date.getTime())) continue;
    for (const d of [
      date.toISOString().slice(0, 10),
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date),
    ]) {
      for (const part of d.split("-")) {
        numbers.add(part);
        numbers.add(String(Number(part)));
      }
    }
  }
  if ((text.match(/\d+/g) ?? []).some((n) => !numbers.has(n)))
    throw new Error("入力にない数字");
}

function sortCandidates(a: Candidate, b: Candidate): number {
  return (
    (b.rank.rank ?? 0) - (a.rank.rank ?? 0) ||
    (b.rank.publishedAt ?? "").localeCompare(a.rank.publishedAt ?? "") ||
    a.name.localeCompare(b.name)
  );
}

export async function generateNight(
  store: SqlitePaperStore,
  date: string,
  opts: {
    userId?: string;
    llm?: LlmConfig;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ edition: Edition; stats: GenerateStats }> {
  validateEditionDate(date);
  const users = store.listUserIds();
  const userId = opts.userId ?? "zaru";
  if (!users.includes(userId))
    throw new Error(`カタログにユーザ ${userId} がない`);
  const stats: GenerateStats = {
    print: 0,
    human: 0,
    silent: 0,
    deferred: 0,
    windowEmpty: 0,
    llmOk: 0,
    llmFallback: 0,
    copiesWritten: 0,
    copyReused: 0,
    editionReused: false,
  };
  const saved = store.getEdition(date, userId);
  if (saved)
    return {
      edition: saved,
      stats: {
        ...stats,
        print: saved.items.length,
        human: saved.holds,
        editionReused: true,
      },
    };
  const latest = store.latestEditionDate();
  if (latest && date <= latest)
    throw new Error("過去の日付の生成には別の検証 DB を使う");
  const follows = new Map<string, Set<string>>();
  for (const u of users)
    follows.set(u, new Set(await store.listUserPackages(u)));
  const names = [
    ...new Set([...follows.values()].flatMap((set) => [...set])),
  ].sort();
  const candidates: Candidate[] = [];
  for (const name of names) {
    const cursor = store.getCursor(name);
    const versions = [cursor?.lastSeenVersion, cursor?.lastPrintedVersion]
      .filter((v): v is string => !!v)
      .sort(compareVersions);
    const advisories = await store.listAdvisories(name);
    const rank = rankFromRaw({
      date,
      releases: await store.listReleases(name),
      advisories,
      cursorVersion: versions.at(-1) ?? null,
      seenAdvisories: new Set(
        advisories
          .filter((a) => store.hasStory(`security:${name}:${a.ghsaId}`))
          .map((a) => a.ghsaId),
      ),
    });
    if (rank.visibility === "skip") {
      stats.windowEmpty++;
      continue;
    }
    const storyIds = rank.advisories.length
      ? rank.advisories.map((a) => `security:${name}:${a.ghsaId}`)
      : [
          `release:${name}:${rank.primary ? semver(rank.primary.tagName) : "unknown"}`,
        ];
    const storyId = storyIds[0];
    if (!storyId) throw new Error("Story id がない");
    candidates.push({
      name,
      rank,
      storyIds,
      input: inputFor(name, rank),
      fact: factFor(name, rank, storyId),
    });
  }
  candidates.sort(sortCandidates);
  const selection = new Map<string, Candidate[]>();
  for (const u of users)
    selection.set(
      u,
      candidates
        .filter(
          (c) =>
            c.rank.visibility === "print_candidate" &&
            follows.get(u)?.has(c.name),
        )
        .slice(0, 8),
    );
  const union = new Set(
    [...selection.values()].flatMap((rows) => rows.map((c) => c.name)),
  );
  const copies: PackageCopy[] = [];
  const copyByName = new Map<string, PackageCopy>();
  const decisions: NightDecision[] = [];
  const cursors: CursorUpdate[] = [];
  for (const c of candidates) {
    if (c.rank.visibility === "skip") continue;
    const visibility =
      c.rank.visibility === "print_candidate"
        ? union.has(c.name)
          ? "print"
          : "deferred"
        : c.rank.visibility;
    let fingerprint: string | null = null;
    if (visibility === "print") {
      fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            t: c.rank.releases.map((r) => r.tagName).sort(),
            g: c.rank.advisories.map((a) => a.ghsaId).sort(),
          }),
        )
        .digest("hex");
      let copy = store.getCopy(c.name, fingerprint);
      if (copy) stats.copyReused++;
      else {
        let result = templateCopy(c);
        let bodySource: "template" | "llm" = "template";
        if (opts.llm) {
          try {
            const output = await completePackageCopy(
              opts.llm,
              c.input,
              result.kind,
              opts.fetchImpl,
            );
            validateGeneratedCopy(output, c.input, result.kind);
            result = output;
            bodySource = "llm";
            stats.llmOk++;
          } catch (err) {
            stats.llmFallback++;
            console.error(
              JSON.stringify({
                msg: "generate.fallback",
                package: c.name,
                status: err instanceof GatewayError ? err.status : null,
              }),
            );
          }
        }
        copy = {
          ...result,
          packageName: c.name,
          fingerprint,
          bodySource,
          model: bodySource === "llm" ? (opts.llm?.model ?? null) : null,
        };
        copies.push(copy);
        stats.copiesWritten++;
      }
      copyByName.set(c.name, copy);
    }
    if (visibility === "human") stats.human++;
    if (visibility === "silent") stats.silent++;
    if (visibility === "deferred") stats.deferred++;
    for (const storyId of c.storyIds) {
      decisions.push({
        storyId,
        packageName: c.name,
        visibility,
        decision:
          visibility === "print" || visibility === "deferred"
            ? "print_new"
            : "hold",
        rank: c.rank.rank,
        fingerprint,
        fact: visibility === "silent" ? null : c.fact,
        factsJson: JSON.stringify(c.input),
        reason: c.rank.reason,
      });
    }
    if (visibility === "print" || visibility === "human") {
      const newVersion = c.rank.primary ? semver(c.rank.primary.tagName) : null;
      for (const id of store.heldStories(c.name)) {
        if (!newVersion || c.storyIds.includes(id)) continue;
        const event = parseStoryId(id).event;
        if (
          !semver(event) ||
          compareVersions(newVersion, semver(event) ?? "0.0.0") <= 0
        )
          continue;
        decisions.push({
          storyId: id,
          packageName: c.name,
          decision: "resolve",
          visibility: "silent",
          rank: null,
          fingerprint: null,
          fact: null,
          factsJson: JSON.stringify(c.input),
          reason: "新しい版で旧 hold を解消",
        });
      }
      // security のみの更新でも semver は戻さない。
      const previous = store.getCursor(c.name)?.lastSeenVersion;
      const version =
        previous && newVersion && compareVersions(previous, newVersion) > 0
          ? previous
          : newVersion;
      cursors.push({
        packageName: c.name,
        version,
        publishedAt: c.rank.primary?.publishedAt ?? null,
        printed: visibility === "print",
      });
    }
  }
  const papers: UserPaper[] = users.map((u) => {
    const items: PaperItem[] = (selection.get(u) ?? []).map((c) => {
      const copy = copyByName.get(c.name);
      const storyId = c.storyIds[0];
      if (!copy || !storyId) throw new Error("生成済みコピーがない");
      return { packageName: c.name, storyId, rank: c.rank.rank ?? 0, copy };
    });
    const held = candidates
      .filter(
        (c) => c.rank.visibility === "human" && follows.get(u)?.has(c.name),
      )
      .map((c) => ({ subject: c.name, reason: c.rank.reason }));
    return {
      userId: u,
      items,
      edition: renderEditionFromCopies(date, items, held),
    };
  });
  store.commitNight(date, copies, decisions, cursors, papers);
  const paper = papers.find((p) => p.userId === userId);
  if (!paper) throw new Error("ユーザ号がない");
  stats.print = paper.items.length;
  stats.human = paper.edition.holds;
  return { edition: paper.edition, stats };
}
