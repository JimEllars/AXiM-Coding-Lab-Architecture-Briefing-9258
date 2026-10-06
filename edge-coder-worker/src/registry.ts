export interface RepoDefinition {
  key: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  type: "cloudflare-pages" | "cloudflare-worker" | "hybrid" | "rust";
  testCommand: string;
}

export const AXiM_ECOSYSTEM_REGISTRY: Record<string, RepoDefinition> = {
  CORE: { key: "CORE", owner: "JimEllars", repo: "axim-core-v1.2", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  SUPPORT: { key: "SUPPORT", owner: "JimEllars", repo: "AXiM-Support-System-1.1-4538", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  SPEEDREPORT: { key: "SPEEDREPORT", owner: "JimEllars", repo: "SpeedReport.org-Speed-Test-App-9642", defaultBranch: "main", type: "hybrid", testCommand: "npm test" },
  ONYX: { key: "ONYX", owner: "JimEllars", repo: "onyx_mk3", defaultBranch: "main", type: "rust", testCommand: "cargo test --workspace" },
  ELLARS: { key: "ELLARS", owner: "JimEllars", repo: "ELLARS.us.com-Frontend-Site-1.1-1974", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" },
  DEMAND_LETTER: { key: "DEMAND_LETTER", owner: "JimEllars", repo: "Decentralized-Demand-Letter-Generator-Development-8155", defaultBranch: "main", type: "cloudflare-pages", testCommand: "npm test" }
};

export function resolveRepoMetadata(projectKey?: string, fallbackRepo?: string): { owner: string; repo: string; defaultBranch: string } {
  if (projectKey && AXiM_ECOSYSTEM_REGISTRY[projectKey.toUpperCase()]) {
    const target = AXiM_ECOSYSTEM_REGISTRY[projectKey.toUpperCase()];
    return { owner: target.owner, repo: target.repo, defaultBranch: target.defaultBranch };
  }
  return { owner: "JimEllars", repo: fallbackRepo || "axim-core-v1.2", defaultBranch: "main" };
}
