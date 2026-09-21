import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type {
  OauthCredential,
  PackageAdvisory,
  PackageRelease,
  PackageRow,
  UserRepo,
  UserRow,
} from "./types.ts";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

export function openCatalogDb(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  applyCatalogMigrations(db);
  return db;
}

function applyCatalogMigrations(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  // 初回 ingest で作った DB は schema_migrations を持たない。
  const hasUsers = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
    )
    .get() as { ok: number } | undefined;
  if (hasUsers) {
    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
    ).run("0001_catalog.sql", new Date().toISOString());
  }

  const applied = new Set(
    (
      db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]
    ).map((row) => row.id),
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const insert = db.prepare(
    `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
  );
  for (const id of files) {
    if (applied.has(id)) {
      continue;
    }
    db.exec(readFileSync(join(migrationsDir, id), "utf8"));
    insert.run(id, new Date().toISOString());
  }
}

export interface CatalogStore {
  upsertUser(user: UserRow): Promise<void>;
  upsertOauth(cred: OauthCredential): Promise<void>;
  getOauth(userId: string): Promise<OauthCredential | undefined>;
  upsertUserRepo(repo: UserRepo): Promise<void>;
  listIncludedRepos(userId: string): Promise<UserRepo[]>;
  upsertPackage(pkg: PackageRow): Promise<void>;
  getPackage(name: string): Promise<PackageRow | undefined>;
  listPackages(): Promise<PackageRow[]>;
  replaceUserPackages(userId: string, packageNames: string[]): Promise<void>;
  listUserPackages(userId: string): Promise<string[]>;
  listPackageFollowers(packageName: string): Promise<string[]>;
  upsertRelease(row: PackageRelease): Promise<void>;
  listReleases(packageName: string): Promise<PackageRelease[]>;
  upsertAdvisory(row: PackageAdvisory): Promise<void>;
  listAdvisories(packageName: string): Promise<PackageAdvisory[]>;
}

export class SqliteCatalogStore implements CatalogStore {
  constructor(private readonly db: DatabaseSync) {}

  async upsertUser(user: UserRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO users (id, github_login, github_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           github_login = excluded.github_login,
           github_id = excluded.github_id`,
      )
      .run(user.id, user.githubLogin, user.githubId, user.createdAt);
  }

  async upsertOauth(cred: OauthCredential): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO oauth_credentials (
           user_id, access_token_enc, refresh_token_enc,
           access_expires_at, refresh_expires_at, refresh_lock_until, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           access_token_enc = excluded.access_token_enc,
           refresh_token_enc = excluded.refresh_token_enc,
           access_expires_at = excluded.access_expires_at,
           refresh_expires_at = excluded.refresh_expires_at,
           refresh_lock_until = excluded.refresh_lock_until,
           updated_at = excluded.updated_at`,
      )
      .run(
        cred.userId,
        cred.accessTokenEnc,
        cred.refreshTokenEnc,
        cred.accessExpiresAt,
        cred.refreshExpiresAt,
        cred.refreshLockUntil,
        cred.updatedAt,
      );
  }

  async getOauth(userId: string): Promise<OauthCredential | undefined> {
    const row = this.db
      .prepare(
        `SELECT user_id AS userId, access_token_enc AS accessTokenEnc,
                refresh_token_enc AS refreshTokenEnc,
                access_expires_at AS accessExpiresAt,
                refresh_expires_at AS refreshExpiresAt,
                refresh_lock_until AS refreshLockUntil,
                updated_at AS updatedAt
         FROM oauth_credentials WHERE user_id = ?`,
      )
      .get(userId) as OauthCredential | undefined;
    return row;
  }

  async upsertUserRepo(repo: UserRepo): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_repos (user_id, repo, owner, included, reason, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, repo) DO UPDATE SET
           owner = excluded.owner,
           included = excluded.included,
           reason = excluded.reason,
           pushed_at = excluded.pushed_at`,
      )
      .run(
        repo.userId,
        repo.repo,
        repo.owner,
        repo.included,
        repo.reason,
        repo.pushedAt,
      );
  }

  async listIncludedRepos(userId: string): Promise<UserRepo[]> {
    return this.db
      .prepare(
        `SELECT user_id AS userId, repo, owner, included, reason,
                pushed_at AS pushedAt
         FROM user_repos
         WHERE user_id = ? AND included = 1
         ORDER BY repo`,
      )
      .all(userId) as UserRepo[];
  }

  async upsertPackage(pkg: PackageRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO packages (name, ecosystem, github_repo, npm_directory, npm_fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           github_repo = COALESCE(excluded.github_repo, packages.github_repo),
           npm_directory = COALESCE(excluded.npm_directory, packages.npm_directory),
           npm_fetched_at = COALESCE(excluded.npm_fetched_at, packages.npm_fetched_at)`,
      )
      .run(
        pkg.name,
        pkg.ecosystem,
        pkg.githubRepo,
        pkg.npmDirectory,
        pkg.npmFetchedAt,
        pkg.createdAt,
      );
  }

  async getPackage(name: string): Promise<PackageRow | undefined> {
    return this.db
      .prepare(
        `SELECT name, ecosystem, github_repo AS githubRepo,
                npm_directory AS npmDirectory, npm_fetched_at AS npmFetchedAt,
                created_at AS createdAt
         FROM packages WHERE name = ?`,
      )
      .get(name) as PackageRow | undefined;
  }

  async listPackages(): Promise<PackageRow[]> {
    return this.db
      .prepare(
        `SELECT name, ecosystem, github_repo AS githubRepo,
                npm_directory AS npmDirectory, npm_fetched_at AS npmFetchedAt,
                created_at AS createdAt
         FROM packages ORDER BY name`,
      )
      .all() as PackageRow[];
  }

  async replaceUserPackages(
    userId: string,
    packageNames: string[],
  ): Promise<void> {
    this.db.prepare(`DELETE FROM user_packages WHERE user_id = ?`).run(userId);
    const stmt = this.db.prepare(
      `INSERT INTO user_packages (user_id, package_name) VALUES (?, ?)`,
    );
    for (const name of packageNames) {
      stmt.run(userId, name);
    }
  }

  async listUserPackages(userId: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT package_name AS packageName FROM user_packages
         WHERE user_id = ? ORDER BY package_name`,
      )
      .all(userId) as { packageName: string }[];
    return rows.map((row) => row.packageName);
  }

  async listPackageFollowers(packageName: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT user_id AS userId FROM user_packages
         WHERE package_name = ? ORDER BY user_id`,
      )
      .all(packageName) as { userId: string }[];
    return rows.map((row) => row.userId);
  }

  async upsertRelease(row: PackageRelease): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO package_releases
           (package_name, tag_name, published_at, html_url, body, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(package_name, tag_name) DO UPDATE SET
           published_at = excluded.published_at,
           html_url = excluded.html_url,
           body = excluded.body,
           fetched_at = excluded.fetched_at`,
      )
      .run(
        row.packageName,
        row.tagName,
        row.publishedAt,
        row.htmlUrl,
        row.body,
        row.fetchedAt,
      );
  }

  async listReleases(packageName: string): Promise<PackageRelease[]> {
    return this.db
      .prepare(
        `SELECT package_name AS packageName, tag_name AS tagName,
                published_at AS publishedAt, html_url AS htmlUrl, body,
                fetched_at AS fetchedAt
         FROM package_releases
         WHERE package_name = ?
         ORDER BY published_at DESC, tag_name DESC`,
      )
      .all(packageName) as PackageRelease[];
  }

  async upsertAdvisory(row: PackageAdvisory): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO package_advisories
           (package_name, ghsa_id, published_at, summary, html_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(package_name, ghsa_id) DO UPDATE SET
           published_at = excluded.published_at,
           summary = excluded.summary,
           html_url = excluded.html_url,
           fetched_at = excluded.fetched_at`,
      )
      .run(
        row.packageName,
        row.ghsaId,
        row.publishedAt,
        row.summary,
        row.htmlUrl,
        row.fetchedAt,
      );
  }

  async listAdvisories(packageName: string): Promise<PackageAdvisory[]> {
    return this.db
      .prepare(
        `SELECT package_name AS packageName, ghsa_id AS ghsaId,
                published_at AS publishedAt, summary, html_url AS htmlUrl,
                fetched_at AS fetchedAt
         FROM package_advisories
         WHERE package_name = ?
         ORDER BY ghsa_id`,
      )
      .all(packageName) as PackageAdvisory[];
  }
}
