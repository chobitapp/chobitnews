import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogStore } from "./store.ts";
import type { OssFixture, WorldFixture } from "./types.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

export function loadWorldFixture(): WorldFixture {
  return JSON.parse(
    readFileSync(join(fixturesDir, "world.json"), "utf8"),
  ) as WorldFixture;
}

export function loadOssFixture(): OssFixture {
  return JSON.parse(
    readFileSync(join(fixturesDir, "oss.json"), "utf8"),
  ) as OssFixture;
}

export async function seedWorld(
  store: CatalogStore,
  world: WorldFixture = loadWorldFixture(),
): Promise<void> {
  for (const user of world.users) {
    await store.upsertUser({
      id: user.id,
      githubLogin: user.github_login,
      githubId: user.github_id,
      createdAt: user.created_at,
    });
    await store.upsertOauth({
      userId: user.id,
      accessTokenEnc: user.oauth.access_token_enc,
      refreshTokenEnc: user.oauth.refresh_token_enc,
      accessExpiresAt: user.oauth.access_expires_at,
      refreshExpiresAt: user.oauth.refresh_expires_at,
      refreshLockUntil: user.oauth.refresh_lock_until,
      updatedAt: user.oauth.updated_at,
    });
    for (const repo of user.repos) {
      await store.upsertUserRepo({
        userId: user.id,
        repo: repo.repo,
        owner: repo.owner,
        included: repo.included,
        reason: repo.reason,
        pushedAt: repo.pushed_at,
      });
    }
  }
}
