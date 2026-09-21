import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTemplateEdition } from "./copy.ts";
import { openDb } from "./db.ts";
import { fetchInventory, readGithubToken } from "./github.ts";
import { detectDrifts } from "./inventory.ts";
import { generateItemWithLlm, readXaiApiKey } from "./llm.ts";
import { runNight } from "./pipeline.ts";
import { SAMPLE_EDITION_DATE, SAMPLE_FACTS } from "./sample-facts.ts";
import type { InventoryRow } from "./types.ts";

function alignOnePackage(
  rows: InventoryRow[],
  packageName: string,
): InventoryRow[] {
  const versions = [
    ...new Set(
      rows.filter((r) => r.packageName === packageName).map((r) => r.version),
    ),
  ];
  const target = versions[0];
  if (!target) {
    return rows;
  }
  return rows.map((row) =>
    row.packageName === packageName ? { ...row, version: target } : row,
  );
}

async function verifyGithub(): Promise<void> {
  const token = readGithubToken();
  const { login, rows } = await fetchInventory(token);
  console.log(`viewer: ${login}`);
  console.log(`tracked rows: ${rows.length}`);

  const byPkg = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byPkg.get(row.packageName) ?? new Set();
    set.add(`${row.repo}@${row.version}`);
    byPkg.set(row.packageName, set);
  }
  for (const [pkg, entries] of [...byPkg.entries()].sort()) {
    console.log(`\n${pkg}`);
    for (const entry of [...entries].sort()) {
      console.log(`  ${entry}`);
    }
  }

  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, "verify.sqlite"));

  const day1 = runNight(db, "day-1", rows);
  const day2 = runNight(db, "day-2", rows);

  const drifts = detectDrifts(rows);
  let day3Rows = rows;
  if (drifts[0]) {
    day3Rows = alignOnePackage(rows, drifts[0].packageName);
    console.log(
      `\n3日目は検証のため ${drifts[0].packageName} を仮に揃える（GitHubは変更しない）`,
    );
  }
  const day3 = runNight(db, "day-3", day3Rows);

  for (const edition of [day1, day2, day3]) {
    console.log("\n-----");
    console.log(edition.body.trimEnd());
    console.log(`(items=${edition.items.length}, holds=${edition.holds})`);
  }
}

async function verifyCopy(): Promise<void> {
  const edition = renderTemplateEdition(SAMPLE_EDITION_DATE, SAMPLE_FACTS);
  console.log(edition.body.trimEnd());
  console.log(`(items=${edition.items.length}, holds=${edition.holds})`);

  if (process.argv.includes("--llm")) {
    const key = readXaiApiKey();
    if (!key) {
      throw new Error(
        "XAI_API_KEY がない。LLM 生成はスキップできないので終わる。",
      );
    }
    const printed = SAMPLE_FACTS.filter((f) => f.decision === "print_new");
    console.log("\n----- LLM -----");
    for (const fact of printed) {
      const item = await generateItemWithLlm(SAMPLE_EDITION_DATE, fact, key);
      console.log(item);
      console.log("");
    }
  }
}

const cmd = process.argv[2];
if (cmd === "github") {
  await verifyGithub();
} else if (cmd === "copy") {
  await verifyCopy();
} else {
  console.error("usage: tsx src/cli.ts github | copy [--llm]");
  process.exit(1);
}
