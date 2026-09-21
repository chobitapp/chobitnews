CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  repo TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  thesis TEXT NOT NULL,
  status TEXT NOT NULL,
  flip_condition TEXT NOT NULL,
  opened_on TEXT NOT NULL,
  last_touched TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investigations (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  investigation_id INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (investigation_id) REFERENCES investigations(id)
);

CREATE TABLE IF NOT EXISTS editions (
  date TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edition_items (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  lead TEXT NOT NULL,
  FOREIGN KEY (date) REFERENCES editions(date),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);
