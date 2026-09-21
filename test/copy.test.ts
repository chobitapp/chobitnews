import { describe, expect, it } from "vitest";
import { renderTemplateEdition, templateHeadline } from "../src/copy.ts";
import { SAMPLE_EDITION_DATE, SAMPLE_FACTS } from "../src/sample-facts.ts";

describe("同じ事実からテンプレで号を書く", () => {
  it("print_new だけ項になり、hold は今日書かないものへ", () => {
    const edition = renderTemplateEdition(SAMPLE_EDITION_DATE, SAMPLE_FACTS);
    expect(edition.items).toHaveLength(4);
    expect(edition.holds).toBe(2);
    expect(edition.items.map((i) => i.storyId)).toEqual([
      "release:wrangler:4.135.0",
      "release:vitest:5.0.0",
      "release:zod:4.6.0",
      "security:hono:4.13.7",
    ]);
    expect(edition.body).toContain("## 今日書かないもの");
    expect(edition.body).toContain("TypeScript 7.0");
    expect(edition.body).toContain("Biome 2.5.14");
    expect(edition.body).not.toContain("世代割れ");
  });

  it("見出しは対象と版と一点で、手元ピンを持たない", () => {
    const wrangler = SAMPLE_FACTS[0];
    if (!wrangler) {
      throw new Error("SAMPLE_FACTS[0] が無い");
    }
    expect(templateHeadline(wrangler)).toBe(
      "wrangler 4.135: Flagship をローカルで評価する",
    );
    for (const fact of SAMPLE_FACTS) {
      expect(JSON.stringify(fact)).not.toMatch(/\^[0-9]/);
    }
  });
});
