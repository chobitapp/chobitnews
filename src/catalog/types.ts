export type UserRow = {
  id: string;
  githubLogin: string;
  githubId: string;
  createdAt: string;
};

export type OauthCredential = {
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  refreshLockUntil: string | null;
  updatedAt: string;
};

export type UserRepo = {
  userId: string;
  repo: string;
  owner: string;
  included: number;
  reason: string;
  pushedAt: string | null;
};

export type PackageRow = {
  name: string;
  ecosystem: string;
  githubRepo: string | null;
  npmDirectory: string | null;
  npmFetchedAt: string | null;
  createdAt: string;
};

export type PackageRelease = {
  packageName: string;
  tagName: string;
  publishedAt: string | null;
  htmlUrl: string | null;
  body: string | null;
  fetchedAt: string;
};

export type PackageAdvisory = {
  packageName: string;
  ghsaId: string;
  publishedAt: string | null;
  summary: string | null;
  htmlUrl: string | null;
  fetchedAt: string;
};

export type ManifestJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type WorldUser = {
  id: string;
  github_login: string;
  github_id: string;
  created_at: string;
  oauth: {
    access_token_enc: string;
    refresh_token_enc: string;
    access_expires_at: string;
    refresh_expires_at: string;
    refresh_lock_until: string | null;
    updated_at: string;
  };
  repos: {
    repo: string;
    owner: string;
    included: number;
    reason: string;
    pushed_at: string | null;
  }[];
};

export type WorldFixture = {
  seeded_at: string;
  users: WorldUser[];
  manifests: Record<string, ManifestJson>;
};

export type OssNpmRecord = {
  repository?: unknown;
};

export type OssReleaseRecord = {
  tag_name: string;
  published_at?: string | null;
  html_url?: string | null;
  body?: string | null;
};

export type OssAdvisoryRecord = {
  ghsa_id: string;
  published_at?: string | null;
  summary?: string | null;
  html_url?: string | null;
};

export type OssFixture = {
  npm: Record<string, OssNpmRecord>;
  releases: Record<string, OssReleaseRecord[]>;
  advisories: Record<string, OssAdvisoryRecord[]>;
};

export type NpmMapping = {
  githubRepo: string | null;
  directory: string | null;
};

export type GithubRelease = {
  tagName: string;
  publishedAt: string | null;
  htmlUrl: string | null;
  body: string | null;
};

export type GithubAdvisory = {
  ghsaId: string;
  publishedAt: string | null;
  summary: string | null;
  htmlUrl: string | null;
};

export type OssClients = {
  readPackageJson(repo: string): Promise<string | null>;
  npmPackage(name: string): Promise<OssNpmRecord | null>;
  listReleases(repo: string): Promise<GithubRelease[]>;
  listAdvisories(packageName: string): Promise<GithubAdvisory[]>;
};

export type IngestStats = {
  userId: string;
  repos: number;
  manifests: number;
  packages: number;
  mapped: number;
  unmapped: number;
  releases: number;
  advisories: number;
  incomplete: string[];
};
