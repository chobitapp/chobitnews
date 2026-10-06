CREATE TABLE package_copies (
  package_name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  headline TEXT NOT NULL,
  lead TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  kind TEXT NOT NULL,             -- security|major|minor|patch|other
  body_source TEXT NOT NULL,      -- llm|template
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (package_name, fingerprint),
  FOREIGN KEY (package_name) REFERENCES packages(name) ON DELETE CASCADE
);

CREATE TABLE package_cursors (
  package_name TEXT PRIMARY KEY,
  last_seen_version TEXT,
  last_seen_published_at TEXT,
  last_seen_on TEXT,
  last_printed_version TEXT,
  last_printed_on TEXT,
  prev_seen_version TEXT,
  prev_seen_published_at TEXT,
  prev_seen_on TEXT,
  prev_printed_version TEXT,
  prev_printed_on TEXT,
  FOREIGN KEY (package_name) REFERENCES packages(name) ON DELETE CASCADE
);

CREATE TABLE night_decisions (
  date TEXT NOT NULL,
  story_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  decision TEXT NOT NULL,         -- print_new | hold | resolve
  visibility TEXT NOT NULL,       -- print | human | silent | deferred
                                  -- resolve 行は decision=resolve かつ visibility=silent
  rank INTEGER,                   -- silent は NULL
  fingerprint TEXT,               -- print のみ。human/silent/deferred は NULL
  copy_fact_json TEXT,            -- デバッグ用。silent は NULL 可
  reason TEXT,
  PRIMARY KEY (date, story_id)
);

CREATE INDEX idx_night_decisions_pkg ON night_decisions(date, package_name);
CREATE INDEX idx_package_copies_created ON package_copies(created_at);
