-- 本番カタログ（必要最低限）。スパイクの drift 表は含めない。
-- D1 は FK を既定で強制する。node:sqlite では PRAGMA foreign_keys = ON が必要。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL UNIQUE,
  github_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_credentials (
  user_id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  refresh_lock_until TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_repos (
  user_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  included INTEGER NOT NULL,
  reason TEXT NOT NULL,
  pushed_at TEXT,
  PRIMARY KEY (user_id, repo),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE packages (
  name TEXT PRIMARY KEY,
  ecosystem TEXT NOT NULL DEFAULT 'npm',
  github_repo TEXT,
  npm_directory TEXT,
  npm_fetched_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE user_packages (
  user_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  PRIMARY KEY (user_id, package_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (package_name) REFERENCES packages(name) ON DELETE CASCADE
);

CREATE TABLE package_releases (
  package_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  published_at TEXT,
  html_url TEXT,
  body TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (package_name, tag_name),
  FOREIGN KEY (package_name) REFERENCES packages(name) ON DELETE CASCADE
);

CREATE TABLE package_advisories (
  package_name TEXT NOT NULL,
  ghsa_id TEXT NOT NULL,
  published_at TEXT,
  summary TEXT,
  html_url TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (package_name, ghsa_id),
  FOREIGN KEY (package_name) REFERENCES packages(name) ON DELETE CASCADE
);

CREATE INDEX idx_user_repos_owner ON user_repos(owner);
CREATE INDEX idx_user_packages_package ON user_packages(package_name);
CREATE INDEX idx_package_releases_published ON package_releases(package_name, published_at);
