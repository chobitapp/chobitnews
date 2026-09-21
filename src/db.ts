import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { EditionItem, InventoryRow, Story } from "./types.ts";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function openDb(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(schemaPath, "utf8"));
  return db;
}

export function insertSnapshot(
  db: DatabaseSync,
  date: string,
  rows: InventoryRow[],
): void {
  const stmt = db.prepare(
    `INSERT INTO snapshots (date, repo, manifest_path, package_name, version)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    stmt.run(date, row.repo, row.manifestPath, row.packageName, row.version);
  }
}

export function insertStory(db: DatabaseSync, story: Story): void {
  db.prepare(
    `INSERT INTO stories
      (id, kind, subject, thesis, status, flip_condition, opened_on, last_touched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    story.id,
    story.kind,
    story.subject,
    story.thesis,
    story.status,
    story.flipCondition,
    story.openedOn,
    story.lastTouched,
  );
}

export function getStory(db: DatabaseSync, id: string): Story | undefined {
  return db
    .prepare(
      `SELECT id, kind, subject, thesis, status, flip_condition AS flipCondition,
            opened_on AS openedOn, last_touched AS lastTouched
     FROM stories WHERE id = ?`,
    )
    .get(id) as Story | undefined;
}

export function listOpenStories(db: DatabaseSync): Story[] {
  return db
    .prepare(
      `SELECT id, kind, subject, thesis, status, flip_condition AS flipCondition,
            opened_on AS openedOn, last_touched AS lastTouched
     FROM stories
     WHERE status NOT IN ('resolved', 'dropped')
     ORDER BY id`,
    )
    .all() as Story[];
}

export function touchStory(db: DatabaseSync, id: string, date: string): void {
  db.prepare(`UPDATE stories SET last_touched = ? WHERE id = ?`).run(date, id);
}

export function resolveStory(db: DatabaseSync, id: string, date: string): void {
  db.prepare(
    `UPDATE stories SET status = 'resolved', last_touched = ? WHERE id = ?`,
  ).run(date, id);
}

export function insertInvestigation(
  db: DatabaseSync,
  date: string,
  storyId: string,
  facts: unknown,
): number {
  const result = db
    .prepare(
      `INSERT INTO investigations (date, story_id, facts_json) VALUES (?, ?, ?)`,
    )
    .run(date, storyId, JSON.stringify(facts));
  return Number(result.lastInsertRowid);
}

export function insertJudgment(
  db: DatabaseSync,
  date: string,
  storyId: string,
  investigationId: number,
  decision: string,
  reasons: unknown,
): void {
  db.prepare(
    `INSERT INTO judgments (date, story_id, investigation_id, decision, reasons_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(date, storyId, investigationId, decision, JSON.stringify(reasons));
}

export function insertEdition(
  db: DatabaseSync,
  date: string,
  body: string,
  items: EditionItem[],
): void {
  db.prepare(`INSERT INTO editions (date, body) VALUES (?, ?)`).run(date, body);
  const stmt = db.prepare(
    `INSERT INTO edition_items (date, story_id, headline, lead)
     VALUES (?, ?, ?, ?)`,
  );
  for (const item of items) {
    stmt.run(date, item.storyId, item.headline, item.lead);
  }
}

export function listJudgments(db: DatabaseSync, date: string) {
  return db
    .prepare(
      `SELECT story_id AS storyId, decision, reasons_json AS reasonsJson
     FROM judgments WHERE date = ? ORDER BY id`,
    )
    .all(date) as { storyId: string; decision: string; reasonsJson: string }[];
}

export function countInvestigations(db: DatabaseSync, storyId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM investigations WHERE story_id = ?`)
    .get(storyId) as { n: number };
  return row.n;
}
