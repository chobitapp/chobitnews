import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  countInvestigations,
  getStory,
  listJudgments,
  openDb,
} from "../src/db.ts";
import { runNight } from "../src/pipeline.ts";
import type { InventoryRow } from "../src/types.ts";

const drifting: InventoryRow[] = [
  {
    repo: "zaru/cinema-ticketing",
    manifestPath: "package.json",
    packageName: "wrangler",
    version: "^4.133.0",
  },
  {
    repo: "zaru/ticket-do",
    manifestPath: "package.json",
    packageName: "wrangler",
    version: "^4.37.1",
  },
];

const aligned: InventoryRow[] = drifting.map((row) => ({
  ...row,
  version: "^4.133.0",
}));

describe("記者が日をまたいで同じ Story を追う", () => {
  let db: DatabaseSync;

  afterEach(() => {
    db?.close();
  });

  it("1日目は新規掲載、2日目は見送り、3日目は解消だけ書く", () => {
    db = openDb();

    const day1 = runNight(db, "2026-09-21", drifting);
    expect(day1.items).toHaveLength(1);
    expect(day1.items[0]?.headline).toContain("wrangler");
    expect(day1.body).toContain("世代割れ");
    expect(getStory(db, "drift:wrangler")?.status).toBe("developing");
    expect(listJudgments(db, "2026-09-21")[0]?.decision).toBe("print_new");

    const day2 = runNight(db, "2026-09-22", drifting);
    expect(day2.items).toHaveLength(0);
    expect(day2.holds).toBe(1);
    expect(day2.body).toContain("新ニュースなし");
    expect(getStory(db, "drift:wrangler")?.status).toBe("developing");
    expect(listJudgments(db, "2026-09-22")[0]?.decision).toBe("hold");

    const day3 = runNight(db, "2026-09-23", aligned);
    expect(day3.items).toHaveLength(1);
    expect(day3.items[0]?.headline).toContain("解消");
    expect(getStory(db, "drift:wrangler")?.status).toBe("resolved");
    expect(listJudgments(db, "2026-09-23")[0]?.decision).toBe("resolve");
    expect(countInvestigations(db, "drift:wrangler")).toBe(3);
  });

  it("2日目の判断は孤立せず、1日目の thesis と覆す条件を前提にする", () => {
    db = openDb();
    runNight(db, "2026-09-21", drifting);
    runNight(db, "2026-09-22", drifting);

    const story = getStory(db, "drift:wrangler");
    expect(story?.openedOn).toBe("2026-09-21");
    expect(story?.lastTouched).toBe("2026-09-22");
    expect(story?.flipCondition).toContain("同じバージョン");

    const hold = listJudgments(db, "2026-09-22")[0];
    expect(hold).toBeDefined();
    const reasons = JSON.parse(hold?.reasonsJson ?? "{}") as {
      flipMet: boolean;
      reason: string;
    };
    expect(reasons.flipMet).toBe(false);
    expect(reasons.reason).toContain("再掲載しない");
  });
});
