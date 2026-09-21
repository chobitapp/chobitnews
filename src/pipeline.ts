import type { DatabaseSync } from "node:sqlite";
import {
  insertEdition,
  insertInvestigation,
  insertJudgment,
  insertSnapshot,
  insertStory,
  listOpenStories,
  resolveStory,
  touchStory,
} from "./db.ts";
import { detectDrifts, formatDriftLead } from "./inventory.ts";
import type { Edition, EditionItem, InventoryRow } from "./types.ts";

function renderEdition(
  date: string,
  items: EditionItem[],
  holds: number,
): string {
  const lines = [`# chobitnews ${date}`, ""];
  if (items.length === 0) {
    lines.push("新ニュースなし。");
    if (holds > 0) {
      lines.push(
        `開いている担当は ${holds} 本。thesis は継続、覆す条件未達のため再掲載しない。`,
      );
    }
    return `${lines.join("\n")}\n`;
  }
  for (const item of items) {
    lines.push(`## ${item.headline}`);
    lines.push(item.lead);
    lines.push("");
  }
  if (holds > 0) {
    lines.push(`（ほか ${holds} 本は継続中だが、今日は動かないので書かない）`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 1夜分。GitHub を見る前に開いている Story を読む、という順序は
 * 呼び出し側が inventory を渡す前提で、判断は必ず既存 Story と突き合わせる。
 */
export function runNight(
  db: DatabaseSync,
  date: string,
  inventory: InventoryRow[],
): Edition {
  insertSnapshot(db, date, inventory);

  const drifts = detectDrifts(inventory);
  const drifting = new Set(drifts.map((d) => d.packageName));
  const open = listOpenStories(db);
  const items: EditionItem[] = [];
  let holds = 0;

  for (const drift of drifts) {
    const id = `drift:${drift.packageName}`;
    const existing = open.find((s) => s.id === id);
    const facts = { byVersion: drift.byVersion };

    if (!existing) {
      insertStory(db, {
        id,
        kind: "drift",
        subject: drift.packageName,
        thesis: `${drift.packageName} がリポジトリ間で世代割れしている`,
        status: "developing",
        flipCondition: `全リポジトリの ${drift.packageName} が同じバージョンになる`,
        openedOn: date,
        lastTouched: date,
      });
      const invId = insertInvestigation(db, date, id, facts);
      insertJudgment(db, date, id, invId, "print_new", {
        reason: "新規の世代割れ",
        flipMet: false,
      });
      items.push({
        storyId: id,
        headline: `${drift.packageName} の世代割れ`,
        lead: formatDriftLead(drift),
      });
      continue;
    }

    const invId = insertInvestigation(db, date, id, facts);
    insertJudgment(db, date, id, invId, "hold", {
      reason: "thesis は継続。覆す条件未達。再掲載しない",
      flipMet: false,
    });
    touchStory(db, id, date);
    holds += 1;
  }

  for (const story of open) {
    if (story.kind !== "drift") {
      continue;
    }
    if (drifting.has(story.subject)) {
      continue;
    }
    const invId = insertInvestigation(db, date, story.id, { aligned: true });
    insertJudgment(db, date, story.id, invId, "resolve", {
      reason: "覆す条件に達した",
      flipMet: true,
    });
    resolveStory(db, story.id, date);
    items.push({
      storyId: story.id,
      headline: `${story.subject} の世代割れは解消`,
      lead: `${story.thesis} → 全リポジトリが揃った。担当を閉じる。`,
    });
  }

  const body = renderEdition(date, items, holds);
  insertEdition(db, date, body, items);
  return { date, items, body, holds };
}
