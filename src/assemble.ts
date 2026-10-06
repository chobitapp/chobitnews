import type { PaperItem } from "./paper-store.ts";
import type { Edition } from "./types.ts";

export function renderEditionFromCopies(
  date: string,
  items: PaperItem[],
  held: { subject: string; reason: string }[],
): Edition {
  const lines = [`# chobitnews ${date}`, ""];
  if (!items.length) lines.push("新ニュースなし。", "");
  for (const item of items) {
    lines.push(`## ${item.copy.headline}`, "", item.copy.lead, "");
    if (item.copy.sources.length)
      lines.push(`出典: ${item.copy.sources.join(" / ")}`, "");
  }
  if (held.length) {
    lines.push("## 今日書かないもの", "");
    for (const h of held) lines.push(`- ${h.subject}: ${h.reason}`);
    lines.push("");
  }
  return {
    date,
    body: `${lines.join("\n")}\n`,
    holds: held.length,
    items: items.map((i) => ({
      storyId: i.storyId,
      headline: i.copy.headline,
      lead: i.copy.lead,
    })),
  };
}
