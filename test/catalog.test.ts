import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureClients } from "../src/catalog/clients.ts";
import { deskNamesFromManifest, isDeniedPackage } from "../src/catalog/desk.ts";
import { ingestUserOss } from "../src/catalog/ingest.ts";
import { githubRepoFromNpm, tagMatchesPackage } from "../src/catalog/npm.ts";
import {
  loadOssFixture,
  loadWorldFixture,
  seedWorld,
} from "../src/catalog/seed.ts";
import { openCatalogDb, SqliteCatalogStore } from "../src/catalog/store.ts";
import type { OssClients } from "../src/catalog/types.ts";

const now = "2026-09-21T04:30:00.000Z";

describe("固定世界から OSS カタログを機械収集する", () => {
  let db: DatabaseSync;

  afterEach(() => {
    db?.close();
  });

  it("同じ sqlite ファイルを二度開いても CREATE TABLE しない", () => {
    const dir = mkdtempSync(join(tmpdir(), "chobitnews-"));
    const path = join(dir, "catalog.sqlite");
    const first = openCatalogDb(path);
    first.close();
    const second = openCatalogDb(path);
    try {
      const row = second
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
        )
        .get() as { name: string } | undefined;
      expect(row?.name).toBe("users");
    } finally {
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema_migrations が無い既存 DB でも再オープンできる", () => {
    const dir = mkdtempSync(join(tmpdir(), "chobitnews-"));
    const path = join(dir, "catalog.sqlite");
    const first = openCatalogDb(path);
    first.exec("DROP TABLE schema_migrations");
    first.close();
    const second = openCatalogDb(path);
    try {
      expect(second.prepare("SELECT id FROM users").all()).toEqual([]);
    } finally {
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("OAuth 済みの zaru と Beat 10 リポがシードされる", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    await seedWorld(store);

    const oauth = await store.getOauth("zaru");
    expect(oauth?.accessTokenEnc).toBe("fixture:authorized");
    expect(oauth?.refreshTokenEnc).toBe("fixture:authorized");

    const repos = await store.listIncludedRepos("zaru");
    expect(repos).toHaveLength(10);
    expect(repos.map((r) => r.repo)).toContain("zaru/chobitnews");
    expect(repos.map((r) => r.repo)).toContain("chobitapp/chobittube");
    expect(repos.every((r) => r.reason === "personal_recent")).toBe(true);
  });

  it("マニフェストから名簿を切り、deny と root 無しを落とす", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    const world = loadWorldFixture();
    const oss = loadOssFixture();
    await seedWorld(store, world);

    const stats = await ingestUserOss(
      store,
      createFixtureClients(world, oss),
      "zaru",
      now,
    );

    const expected = new Set<string>();
    for (const manifest of Object.values(world.manifests)) {
      for (const name of deskNamesFromManifest(manifest)) {
        expected.add(name);
      }
    }

    expect(stats.repos).toBe(10);
    expect(stats.manifests).toBe(8);
    expect(stats.packages).toBe(expected.size);
    expect(stats.incomplete).toEqual([]);

    const followed = await store.listUserPackages("zaru");
    expect(followed).toEqual([...expected].sort());
    expect(followed).not.toContain("@types/node");
    expect(followed).not.toContain("postcss");
    expect(followed).not.toContain("autoprefixer");
    expect(isDeniedPackage("@types/react")).toBe(true);
  });

  it("Releases は OSS に紐づき、monorepo はパッケージ名の tag だけ残す", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    const world = loadWorldFixture();
    const oss = loadOssFixture();
    await seedWorld(store, world);
    await ingestUserOss(store, createFixtureClients(world, oss), "zaru", now);

    const wrangler = await store.getPackage("wrangler");
    expect(wrangler?.githubRepo).toBe("cloudflare/workers-sdk");
    expect(wrangler?.npmDirectory).toBe("packages/wrangler");

    const tags = await store.listReleases("wrangler");
    expect(tags.map((r) => r.tagName)).toEqual(["wrangler@4.135.0"]);

    const honoAdvisories = await store.listAdvisories("hono");
    expect(honoAdvisories.map((a) => a.ghsaId)).toEqual([
      "GHSA-hxh3-vqpv-xpqv",
    ]);

    const vitest = await store.listReleases("vitest");
    expect(vitest.map((r) => r.tagName)).toEqual(["v5.0.1", "v5.0.0"]);
  });

  it("同じ OSS は 1 行で、複数ユーザが follow する", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    const world = loadWorldFixture();
    const oss = loadOssFixture();
    await seedWorld(store, world);

    const inner = createFixtureClients(world, oss);
    const clients: OssClients = {
      ...inner,
      async readPackageJson(repo: string) {
        if (repo === "alice/demo") {
          return JSON.stringify({
            dependencies: { wrangler: "^4.0.0", hono: "^4.0.0" },
          });
        }
        return inner.readPackageJson(repo);
      },
    };

    await ingestUserOss(store, clients, "zaru", now);

    await store.upsertUser({
      id: "alice",
      githubLogin: "alice",
      githubId: "1",
      createdAt: now,
    });
    await store.upsertUserRepo({
      userId: "alice",
      repo: "alice/demo",
      owner: "alice",
      included: 1,
      reason: "personal_recent",
      pushedAt: now,
    });
    await ingestUserOss(store, clients, "alice", now);

    const wranglers = (await store.listPackages()).filter(
      (pkg) => pkg.name === "wrangler",
    );
    expect(wranglers).toHaveLength(1);
    expect(await store.listPackageFollowers("wrangler")).toEqual([
      "alice",
      "zaru",
    ]);
    expect(await store.listPackageFollowers("hono")).toEqual(["alice", "zaru"]);
    expect(await store.listUserPackages("alice")).toEqual(["hono", "wrangler"]);
    expect(await store.listReleases("wrangler")).toHaveLength(1);
  });

  it("同じユーザの再収集は follow を差し替え、OSS 行は共有のまま", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    const world = loadWorldFixture();
    const oss = loadOssFixture();
    await seedWorld(store, world);
    const clients = createFixtureClients(world, oss);
    await ingestUserOss(store, clients, "zaru", now);
    const again = await ingestUserOss(store, clients, "zaru", now);

    expect(again.packages).toBeGreaterThan(0);
    expect(await store.listReleases("wrangler")).toHaveLength(1);
    expect(await store.listUserPackages("zaru")).toContain("wrangler");
  });

  it("存在しない OSS への follow は FK で落ちる", async () => {
    db = openCatalogDb();
    const store = new SqliteCatalogStore(db);
    await store.upsertUser({
      id: "zaru",
      githubLogin: "zaru",
      githubId: "235650",
      createdAt: now,
    });
    await expect(
      store.replaceUserPackages("zaru", ["not-a-real-package"]),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("npm repository の正規化", () => {
  it("文字列・git+ssh・directory 付きを org/repo にする", () => {
    expect(githubRepoFromNpm("https://github.com/honojs/hono.git")).toEqual({
      githubRepo: "honojs/hono",
      directory: null,
    });
    expect(
      githubRepoFromNpm("git+ssh://git@github.com:cloudflare/workers-sdk.git"),
    ).toEqual({
      githubRepo: "cloudflare/workers-sdk",
      directory: null,
    });
    expect(
      githubRepoFromNpm({
        type: "git",
        url: "git+https://github.com/cloudflare/workers-sdk.git",
        directory: "packages/wrangler",
      }),
    ).toEqual({
      githubRepo: "cloudflare/workers-sdk",
      directory: "packages/wrangler",
    });
    expect(githubRepoFromNpm("https://gitlab.com/foo/bar")).toEqual({
      githubRepo: null,
      directory: null,
    });
  });

  it("monorepo はパッケージ名を含む tag だけ採用する", () => {
    expect(tagMatchesPackage("wrangler@4.135.0", "wrangler", true)).toBe(true);
    expect(tagMatchesPackage("miniflare@4.0.0", "wrangler", true)).toBe(false);
    expect(tagMatchesPackage("v5.0.1", "vitest", false)).toBe(true);
  });
});
