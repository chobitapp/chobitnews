import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { validateEditionDate } from "./rank.ts";

export function parseGenerateArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      date: { type: "string" },
      fixture: { type: "string" },
      catalog: { type: "string" },
      user: { type: "string", default: "zaru" },
      llm: { type: "boolean", default: false },
      output: { type: "string" },
    },
  });
  if (!values.date) throw new Error("generate には --date が必要");
  validateEditionDate(values.date);
  if (!!values.fixture === !!values.catalog)
    throw new Error("--fixture と --catalog は片方だけ指定する");
  if (values.catalog && !existsSync(values.catalog))
    throw new Error("指定したカタログが存在しない");
  return { ...values, date: values.date };
}
