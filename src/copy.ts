import type { Edition, EditionItem, JudgmentDecision } from "./types.ts";

/** 紙面1項の調査結果。手元の使用バージョンは持たない。 */
export type CopyFact = {
  storyId: string;
  subject: string;
  decision: JudgmentDecision;
  occurredOn: string;
  versionLabel: string;
  thesis: string;
  points: string[];
  sources: string[];
  holdReason?: string;
};

export const COPY_SYSTEM_PROMPT = `あなたは個人向け GitHub 朝刊の記者。与えた JSON の事実だけを使い、日本語で1項を書く。
- 事実にない数字・機能・日付を足さない
- 手元の使用バージョンやリポジトリ間の世代割れに触れない
- 形式は次のみ:
## 見出し

本文（2〜5文。いつ、何が変わったか）

出典: URL（複数なら " / " 区切り）
- 見出しは「対象 版: 一点」の短さ。本文は公式の言い方を優先する`;

export function copyUserPrompt(date: string, fact: CopyFact): string {
  return `号の日付: ${date}\n事実:\n${JSON.stringify(fact, null, 2)}`;
}

function dateJa(iso: string): string {
  const parts = iso.split("-").map(Number);
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) {
    return iso;
  }
  return `${month}月${day}日`;
}

export function templateHeadline(fact: CopyFact): string {
  if (fact.versionLabel) {
    return `${fact.subject} ${fact.versionLabel}: ${fact.thesis}`;
  }
  return `${fact.subject}: ${fact.thesis}`;
}

export function templateLead(fact: CopyFact): string {
  const body = fact.points.join("。");
  const sources = fact.sources.join(" / ");
  return `${dateJa(fact.occurredOn)}。${body}。\n\n出典: ${sources}`;
}

export function renderTemplateEdition(
  date: string,
  facts: CopyFact[],
): Edition {
  const printed = facts.filter((f) => f.decision === "print_new");
  const held = facts.filter((f) => f.decision === "hold");
  const items: EditionItem[] = printed.map((fact) => ({
    storyId: fact.storyId,
    headline: templateHeadline(fact),
    lead: templateLead(fact),
  }));

  const lines = [`# chobitnews ${date}`, ""];
  if (items.length === 0) {
    lines.push("新ニュースなし。");
  } else {
    for (const item of items) {
      lines.push(`## ${item.headline}`);
      lines.push(item.lead);
      lines.push("");
    }
  }
  if (held.length > 0) {
    lines.push("## 今日書かないもの");
    lines.push("");
    for (const fact of held) {
      lines.push(`- ${fact.subject}: ${fact.holdReason ?? "hold"}`);
    }
    lines.push("");
  }
  const body = `${lines.join("\n")}\n`;
  return { date, items, body, holds: held.length };
}
