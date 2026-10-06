import type { DatabaseSync } from "node:sqlite";
import { SqliteCatalogStore } from "./catalog/store.ts";
import type { CopyFact } from "./copy.ts";
import type { PackageLlmOutput } from "./llm.ts";
import type { Visibility } from "./rank.ts";
import type { Edition } from "./types.ts";

export type PackageCopy = PackageLlmOutput & {
  packageName: string;
  fingerprint: string;
  bodySource: "template" | "llm";
  model: string | null;
};
export type Cursor = {
  packageName: string;
  lastSeenVersion: string | null;
  lastSeenOn: string | null;
  lastPrintedVersion: string | null;
  lastPrintedOn: string | null;
};
export type NightDecision = {
  storyId: string;
  packageName: string;
  decision: "print_new" | "hold" | "resolve";
  visibility: Visibility;
  rank: number | null;
  fingerprint: string | null;
  fact: CopyFact | null;
  factsJson: string;
  reason: string;
};
export type PaperItem = {
  packageName: string;
  storyId: string;
  rank: number;
  copy: PackageCopy;
};
export type UserPaper = {
  userId: string;
  edition: Edition;
  items: PaperItem[];
};
export type CursorUpdate = {
  packageName: string;
  version: string | null;
  publishedAt: string | null;
  printed: boolean;
};

/** この段階はローカル SQLite。async D1 アダプタは本番化で足す。 */
export class SqlitePaperStore extends SqliteCatalogStore {
  constructor(db: DatabaseSync) {
    super(db);
  }

  listUserIds(): string[] {
    return (
      this.db.prepare("SELECT id FROM users ORDER BY id").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
  }
  latestEditionDate(): string | null {
    return (
      this.db.prepare("SELECT MAX(date) AS date FROM editions").get() as {
        date: string | null;
      }
    ).date;
  }
  getEdition(date: string, userId: string): Edition | undefined {
    const row = this.db
      .prepare(
        "SELECT body, hold_count AS holds FROM editions WHERE date=? AND user_id=?",
      )
      .get(date, userId) as { body: string; holds: number } | undefined;
    if (!row) return undefined;
    const items = this.db
      .prepare(`SELECT story_id AS storyId, headline, lead FROM edition_items
      WHERE date=? AND user_id=? ORDER BY rank DESC, rowid`)
      .all(date, userId) as Edition["items"];
    return { date, body: row.body, holds: row.holds, items };
  }
  getCursor(packageName: string): Cursor | undefined {
    return this.db
      .prepare(`SELECT package_name AS packageName, last_seen_version AS lastSeenVersion,
      last_seen_on AS lastSeenOn, last_printed_version AS lastPrintedVersion, last_printed_on AS lastPrintedOn
      FROM package_cursors WHERE package_name=?`)
      .get(packageName) as Cursor | undefined;
  }
  hasStory(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM stories WHERE id=?").get(id);
  }
  heldStories(packageName: string): string[] {
    return (
      this.db
        .prepare("SELECT id FROM stories WHERE subject=? AND status='held'")
        .all(packageName) as { id: string }[]
    ).map((r) => r.id);
  }
  getCopy(name: string, fingerprint: string): PackageCopy | undefined {
    const row = this.db
      .prepare(`SELECT package_name AS packageName, fingerprint, headline, lead,
      sources_json AS sourcesJson, kind, body_source AS bodySource, model FROM package_copies
      WHERE package_name=? AND fingerprint=?`)
      .get(name, fingerprint) as
      | (Omit<PackageCopy, "sources"> & { sourcesJson: string })
      | undefined;
    if (!row) return undefined;
    const { sourcesJson, ...rest } = row;
    return { ...rest, sources: JSON.parse(sourcesJson) as string[] };
  }

  /** LLM を待つ間は DB に書かない。全ユーザの号・判断・cursor を一緒に確定する。 */
  commitNight(
    date: string,
    copies: PackageCopy[],
    decisions: NightDecision[],
    cursors: CursorUpdate[],
    papers: UserPaper[],
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const lastDate = this.latestEditionDate();
      if (lastDate && date <= lastDate)
        throw new Error(
          "保存済み号の日付以前には書き込めない。号を再読するか別の検証 DB を使う",
        );
      for (const c of copies) {
        this.db
          .prepare(`INSERT OR IGNORE INTO package_copies
          (package_name,fingerprint,headline,lead,sources_json,kind,body_source,model,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(
            c.packageName,
            c.fingerprint,
            c.headline,
            c.lead,
            JSON.stringify(c.sources),
            c.kind,
            c.bodySource,
            c.model,
            new Date().toISOString(),
          );
      }
      for (const d of decisions) {
        this.db
          .prepare(`INSERT INTO night_decisions
          (date,story_id,package_name,decision,visibility,rank,fingerprint,copy_fact_json,reason) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(
            date,
            d.storyId,
            d.packageName,
            d.decision,
            d.visibility,
            d.rank,
            d.fingerprint,
            d.fact ? JSON.stringify(d.fact) : null,
            d.reason,
          );
        if (d.decision === "resolve") {
          this.db
            .prepare(
              "UPDATE stories SET status='resolved', last_touched=? WHERE id=? AND status='held'",
            )
            .run(date, d.storyId);
        } else if (d.visibility === "print" || d.visibility === "human") {
          this.db
            .prepare(`INSERT OR IGNORE INTO stories
            (id,kind,subject,thesis,status,flip_condition,opened_on,last_touched) VALUES (?,?,?,?,?,?,?,?)`)
            .run(
              d.storyId,
              d.storyId.startsWith("security:") ? "security" : "release",
              d.packageName,
              d.fact?.thesis ?? "",
              d.visibility === "print" ? "printed" : "held",
              "新しい版が出る",
              date,
              date,
            );
        }
        if (this.hasStory(d.storyId)) {
          this.db
            .prepare("UPDATE stories SET last_touched=? WHERE id=?")
            .run(date, d.storyId);
          const row = this.db
            .prepare(
              "INSERT INTO investigations (date,story_id,facts_json) VALUES (?,?,?)",
            )
            .run(date, d.storyId, d.factsJson);
          this.db
            .prepare(
              "INSERT INTO judgments (date,story_id,investigation_id,decision,reasons_json) VALUES (?,?,?,?,?)",
            )
            .run(
              date,
              d.storyId,
              row.lastInsertRowid,
              d.decision,
              JSON.stringify([d.reason]),
            );
        }
      }
      for (const c of cursors) {
        if (!c.version) continue;
        this.db
          .prepare(
            "INSERT OR IGNORE INTO package_cursors (package_name) VALUES (?)",
          )
          .run(c.packageName);
        this.db
          .prepare(`UPDATE package_cursors SET
          prev_seen_version=last_seen_version, prev_seen_published_at=last_seen_published_at, prev_seen_on=last_seen_on,
          prev_printed_version=last_printed_version, prev_printed_on=last_printed_on,
          last_seen_version=?, last_seen_published_at=?, last_seen_on=?,
          last_printed_version=CASE WHEN ? THEN ? ELSE last_printed_version END,
          last_printed_on=CASE WHEN ? THEN ? ELSE last_printed_on END WHERE package_name=?`)
          .run(
            c.version,
            c.publishedAt,
            date,
            c.printed ? 1 : 0,
            c.version,
            c.printed ? 1 : 0,
            date,
            c.packageName,
          );
      }
      for (const p of papers) {
        this.db
          .prepare(
            "INSERT INTO editions (date,user_id,body,item_count,hold_count) VALUES (?,?,?,?,?)",
          )
          .run(date, p.userId, p.edition.body, p.items.length, p.edition.holds);
        for (const item of p.items) {
          this.db
            .prepare(
              `INSERT INTO edition_items (date,user_id,package_name,story_id,rank,headline,lead) VALUES (?,?,?,?,?,?,?)`,
            )
            .run(
              date,
              p.userId,
              item.packageName,
              item.storyId,
              item.rank,
              item.copy.headline,
              item.copy.lead,
            );
        }
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
