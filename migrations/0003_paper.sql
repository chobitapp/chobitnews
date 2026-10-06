CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  thesis TEXT NOT NULL,
  status TEXT NOT NULL,           -- printed | held | resolved | dropped
  flip_condition TEXT NOT NULL,
  opened_on TEXT NOT NULL,
  last_touched TEXT NOT NULL
);

CREATE TABLE investigations (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE judgments (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  investigation_id INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (investigation_id) REFERENCES investigations(id)
);

CREATE TABLE editions (
  date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  hold_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'composed',
  PRIMARY KEY (date, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE edition_items (
  date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  story_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  headline TEXT NOT NULL,
  lead TEXT NOT NULL,
  PRIMARY KEY (date, user_id, package_name),
  FOREIGN KEY (date, user_id) REFERENCES editions(date, user_id) ON DELETE CASCADE,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);
