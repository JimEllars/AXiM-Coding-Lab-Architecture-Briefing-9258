export interface RepoDefinition {
  key: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  type: "cloudflare-pages" | "cloudflare-worker" | "hybrid" | "rust";
  testCommand: string;
}

/** Canonical GitHub owner for every ecosystem repository. */
export const CANONICAL_OWNER = "JimEllars";

/**
 * Active AXiM fleet. `repo` values must match the real GitHub repository name
 * (GitHub redirects on case, but the API and webhook URLs should be exact).
 */
export const AXiM_ECOSYSTEM_REGISTRY: Record<string, RepoDefinition> = {
  CORE: { key: "CORE", owner: "JimEllars", repo: "axim-core-v1.2", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  SUPPORT: { key: "SUPPORT", owner: "JimEllars", repo: "AXiM-Support-System-1.1-4538", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  SPEEDREPORT: { key: "SPEEDREPORT", owner: "JimEllars", repo: "SpeedReport.org-Speed-Test-App-9642", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  ONYX: { key: "ONYX", owner: "JimEllars", repo: "onyx_mk3", defaultBranch: "main", type: "rust", testCommand: "cargo test --workspace" },
  ELLARS: { key: "ELLARS", owner: "JimEllars", repo: "ELLARS.us.com-Frontend-Site-1.1-1974", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" },
  DEMAND_LETTER: { key: "DEMAND_LETTER", owner: "JimEllars", repo: "Decentralized-Demand-Letter-Generator-Development-8155", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" },
  ACADEMY: { key: "ACADEMY", owner: "JimEllars", repo: "AXiM-Academy-App-1-188", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" },
  FRONTEND: { key: "FRONTEND", owner: "JimEllars", repo: "AXiM-Web3-Frontend-Development-7312", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" },
  ASGUARD: { key: "ASGUARD", owner: "JimEllars", repo: "AXiM-Asguard-System-App-1", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  CODING_LAB: { key: "CODING_LAB", owner: "JimEllars", repo: "AXiM-Coding-Lab-Architecture-Briefing-9258", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  ROBOTICS: { key: "ROBOTICS", owner: "JimEllars", repo: "AXiM-Robotics-Lab-Program-4198", defaultBranch: "main", type: "hybrid", testCommand: "npm test" }
};

export interface ResolvedRepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
}

/** Splits `owner/repo`, guarding against callers that pass a bare name. */
function parseRepoSlug(value: string): { owner?: string; repo: string } {
  const trimmed = value.trim();
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts.slice(1).join("/") };
  }
  return { repo: trimmed };
}

function findByRepoName(repoName: string): RepoDefinition | undefined {
  const lowered = repoName.toLowerCase();
  return Object.values(AXiM_ECOSYSTEM_REGISTRY).find((entry) => entry.repo.toLowerCase() === lowered);
}

/**
 * Resolves a project key, `owner/repo` slug, or bare repository name into
 * GitHub coordinates.
 *
 * The dashboard sends `JimEllars/repo-name` as `repository_name`, which the
 * previous implementation treated as a repository *name* — producing GitHub
 * calls against `repos/JimEllars/JimEllars/repo-name` and 404s. Slugs are now
 * parsed properly, and the owner is always pinned to {@link CANONICAL_OWNER}.
 */
export function resolveRepoMetadata(projectKey?: string, fallbackRepo?: string): ResolvedRepoMetadata {
  const candidates = [projectKey, fallbackRepo].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const candidate of candidates) {
    const byKey = AXiM_ECOSYSTEM_REGISTRY[candidate.toUpperCase()];
    if (byKey) {
      return { owner: byKey.owner, repo: byKey.repo, defaultBranch: byKey.defaultBranch };
    }

    const parsed = parseRepoSlug(candidate);
    const byRepo = findByRepoName(parsed.repo);
    if (byRepo) {
      if (parsed.owner && parsed.owner !== CANONICAL_OWNER) {
        console.warn(
          `[REGISTRY] non-canonical owner override rejected: "${parsed.owner}/${parsed.repo}" -> "${CANONICAL_OWNER}/${byRepo.repo}"`
        );
      }
      return { owner: CANONICAL_OWNER, repo: byRepo.repo, defaultBranch: byRepo.defaultBranch };
    }

    if (parsed.owner) {
      if (parsed.owner !== CANONICAL_OWNER) {
        console.warn(
          `[REGISTRY] non-canonical owner override rejected: "${parsed.owner}" -> "${CANONICAL_OWNER}" for repo "${parsed.repo}"`
        );
      }
      // Unknown repo, but a well-formed slug: honour the repo name, pin the owner.
      return { owner: CANONICAL_OWNER, repo: parsed.repo, defaultBranch: "main" };
    }
  }

  return { owner: CANONICAL_OWNER, repo: "axim-core-v1.2", defaultBranch: "main" };
}
