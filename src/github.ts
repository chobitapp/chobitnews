import { execFileSync } from "node:child_process";
import { rowsFromPackageJson } from "./inventory.ts";
import type { InventoryRow } from "./types.ts";

const QUERY = `
query ($n: Int!) {
  viewer {
    login
    repositories(
      first: $n
      orderBy: { field: PUSHED_AT, direction: DESC }
      ownerAffiliations: [OWNER, COLLABORATOR]
      isFork: false
      isArchived: false
    ) {
      nodes {
        nameWithOwner
        pushedAt
        object(expression: "HEAD:package.json") {
          ... on Blob {
            text
          }
        }
      }
    }
  }
}
`;

type GraphQlRepo = {
  nameWithOwner: string;
  pushedAt: string;
  object: { text: string } | null;
};

type GraphQlResponse = {
  data?: {
    viewer: {
      login: string;
      repositories: { nodes: GraphQlRepo[] };
    };
  };
  errors?: { message: string }[];
};

export function readGithubToken(): string {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "GitHub トークンがない。GITHUB_TOKEN を置くか `gh auth login` する。",
    );
  }
}

export async function fetchInventory(
  token: string,
  repoLimit = 40,
): Promise<{ login: string; rows: InventoryRow[] }> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "chobitnews-verify",
    },
    body: JSON.stringify({ query: QUERY, variables: { n: repoLimit } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GraphQlResponse;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("GitHub GraphQL が data を返さなかった");
  }

  const rows: InventoryRow[] = [];
  for (const repo of json.data.viewer.repositories.nodes) {
    if (!repo.object?.text) {
      continue;
    }
    rows.push(
      ...rowsFromPackageJson(
        repo.nameWithOwner,
        "package.json",
        repo.object.text,
      ),
    );
  }
  return { login: json.data.viewer.login, rows };
}
