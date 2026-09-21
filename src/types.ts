export type InventoryRow = {
  repo: string;
  manifestPath: string;
  packageName: string;
  version: string;
};

export type Drift = {
  packageName: string;
  byVersion: Record<string, string[]>;
};

export type Story = {
  id: string;
  kind: string;
  subject: string;
  thesis: string;
  status: string;
  flipCondition: string;
  openedOn: string;
  lastTouched: string;
};

export type JudgmentDecision = "print_new" | "hold" | "resolve";

export type EditionItem = {
  storyId: string;
  headline: string;
  lead: string;
};

export type Edition = {
  date: string;
  items: EditionItem[];
  body: string;
  holds: number;
};
