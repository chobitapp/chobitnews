import type { ManifestJson } from "./types.ts";

const DENY_PREFIXES = [
  "@types/",
  "@tsconfig/",
  "eslint-",
  "@eslint/",
  "@babel/",
  "prettier",
] as const;

const DENY_EXACT = new Set([
  "prettier",
  "dotenv",
  "tslib",
  "postcss",
  "autoprefixer",
]);

export function isDeniedPackage(name: string): boolean {
  if (DENY_EXACT.has(name)) {
    return true;
  }
  return DENY_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix),
  );
}

export function deskNamesFromManifest(manifest: ManifestJson): string[] {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = manifest[field];
    if (!deps) {
      continue;
    }
    for (const name of Object.keys(deps)) {
      if (!isDeniedPackage(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

export function parseManifestJson(source: string): ManifestJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const pkg = parsed as ManifestJson;
  return {
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
  };
}
