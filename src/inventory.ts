import type { Drift, InventoryRow } from "./types.ts";

/** 戦略的に追うパッケージ。dotenv のような付属品は朝刊に出さない。 */
export const TRACKED_PACKAGES = [
  "wrangler",
  "hono",
  "zod",
  "react",
  "vitest",
  "@biomejs/biome",
  "typescript",
  "@typesafe-ai/sdk",
  "@cloudflare/workers-types",
  "@cloudflare/vitest-pool-workers",
] as const;

const tracked = new Set<string>(TRACKED_PACKAGES);

export function isTracked(name: string): boolean {
  return tracked.has(name);
}

export function rowsFromPackageJson(
  repo: string,
  manifestPath: string,
  source: string,
): InventoryRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const pkg = parsed as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const rows: InventoryRow[] = [];
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) {
      continue;
    }
    for (const [packageName, version] of Object.entries(deps)) {
      if (!isTracked(packageName) || typeof version !== "string") {
        continue;
      }
      rows.push({ repo, manifestPath, packageName, version });
    }
  }
  return rows;
}

export function detectDrifts(rows: InventoryRow[]): Drift[] {
  const byPkg = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    let versions = byPkg.get(row.packageName);
    if (!versions) {
      versions = new Map();
      byPkg.set(row.packageName, versions);
    }
    const repos = versions.get(row.version) ?? [];
    if (!repos.includes(row.repo)) {
      repos.push(row.repo);
    }
    versions.set(row.version, repos);
  }

  const drifts: Drift[] = [];
  for (const [packageName, versions] of byPkg) {
    if (versions.size < 2) {
      continue;
    }
    drifts.push({
      packageName,
      byVersion: Object.fromEntries(versions),
    });
  }
  drifts.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return drifts;
}

export function formatDriftLead(drift: Drift): string {
  return Object.entries(drift.byVersion)
    .map(([version, repos]) => `${version}: ${repos.join(", ")}`)
    .join(" / ");
}
