/**
 * Dashboard-side view of the AXiM fleet.
 *
 * `edge-coder-worker/src/registry.ts` is the authority the worker actually
 * routes with. This module is the dashboard's copy of the same coordinates,
 * kept deliberately small: it exists so the cockpit can resolve a project key
 * to `owner/repo` for file previews without importing worker code into the
 * browser bundle.
 *
 * The two copies had already drifted: this file used to live inline in
 * `labService.js` with `ROBOTICS -> axim-robotics-lab`, a repository that does
 * not exist (`GET /repos/JimEllars/axim-robotics-lab` is a 404), and
 * `ASGUARD -> axim-asguard-system-app-1` against the worker's
 * `AXiM-Asguard-System-App-1`. `fleetRegistry.test.js` now asserts parity with
 * the worker table key-by-key, so the next drift fails CI instead of a preview
 * request.
 *
 * `repo` values must be the exact GitHub spelling: the API tolerates case, but
 * `raw.githubusercontent.com` and log forensics do not.
 */

export const CANONICAL_OWNER = 'JimEllars';

/** @typedef {{ key: string, owner: string, repo: string, defaultBranch: string, type: string }} FleetEntry */

/** @type {Record<string, FleetEntry>} */
export const FLEET_REGISTRY = {
  CORE: { key: 'CORE', owner: CANONICAL_OWNER, repo: 'axim-core-v1.2', defaultBranch: 'main', type: 'hybrid' },
  SUPPORT: { key: 'SUPPORT', owner: CANONICAL_OWNER, repo: 'AXiM-Support-System-1.1-4538', defaultBranch: 'main', type: 'hybrid' },
  SPEEDREPORT: { key: 'SPEEDREPORT', owner: CANONICAL_OWNER, repo: 'SpeedReport.org-Speed-Test-App-9642', defaultBranch: 'main', type: 'hybrid' },
  ONYX: { key: 'ONYX', owner: CANONICAL_OWNER, repo: 'onyx_mk3', defaultBranch: 'main', type: 'rust' },
  ELLARS: { key: 'ELLARS', owner: CANONICAL_OWNER, repo: 'ELLARS.us.com-Frontend-Site-1.1-1974', defaultBranch: 'main', type: 'cloudflare-pages' },
  DEMAND_LETTER: { key: 'DEMAND_LETTER', owner: CANONICAL_OWNER, repo: 'Decentralized-Demand-Letter-Generator-Development-8155', defaultBranch: 'main', type: 'cloudflare-pages' },
  ACADEMY: { key: 'ACADEMY', owner: CANONICAL_OWNER, repo: 'AXiM-Academy-App-1-188', defaultBranch: 'main', type: 'cloudflare-pages' },
  FRONTEND: { key: 'FRONTEND', owner: CANONICAL_OWNER, repo: 'AXiM-Web3-Frontend-Development-7312', defaultBranch: 'main', type: 'cloudflare-pages' },
  ASGUARD: { key: 'ASGUARD', owner: CANONICAL_OWNER, repo: 'AXiM-Asguard-System-App-1', defaultBranch: 'main', type: 'hybrid' },
  CODING_LAB: { key: 'CODING_LAB', owner: CANONICAL_OWNER, repo: 'AXiM-Coding-Lab-Architecture-Briefing-9258', defaultBranch: 'main', type: 'hybrid' },
  ROBOTICS: { key: 'ROBOTICS', owner: CANONICAL_OWNER, repo: 'AXiM-Robotics-Lab-Program-4198', defaultBranch: 'main', type: 'hybrid' },
};

/**
 * Resolves a project key (`CORE`), a `owner/repo` slug, or a bare repository
 * name into GitHub coordinates, mirroring `resolveRepoMetadata()` in the
 * worker's `registry.ts`.
 *
 * The owner is always pinned to {@link CANONICAL_OWNER}: the worker rejects a
 * non-canonical owner override, so the dashboard must not send one either.
 *
 * @param {string|undefined|null} value
 * @returns {{ owner: string, repo: string, defaultBranch: string }}
 */
export function resolveFleetCoordinates(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return { owner: CANONICAL_OWNER, repo: FLEET_REGISTRY.CORE.repo, defaultBranch: 'main' };
  }

  const byKey = FLEET_REGISTRY[raw.toUpperCase()];
  if (byKey) {
    return { owner: byKey.owner, repo: byKey.repo, defaultBranch: byKey.defaultBranch };
  }

  const parts = raw.split('/').filter(Boolean);
  const repoName = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
  const lowered = repoName.toLowerCase();

  const known = Object.values(FLEET_REGISTRY).find((entry) => entry.repo.toLowerCase() === lowered);
  if (known) {
    return { owner: CANONICAL_OWNER, repo: known.repo, defaultBranch: known.defaultBranch };
  }

  return { owner: CANONICAL_OWNER, repo: repoName, defaultBranch: 'main' };
}

/**
 * Extensions the worker's `validateCodeSyntax()` actually routes to a
 * structural / hardware-as-code validator. Used by the terminal to warn when a
 * runtime and a target path disagree, which otherwise burns an LLM run on code
 * the worker rejects in `[AST_CHECK]`.
 */
export const RUNTIME_EXPECTED_EXTENSIONS = {
  'Node.js Edge': ['.ts', '.tsx', '.js', '.jsx', '.json'],
  'Python Sandbox': ['.py'],
  'Embedded C++ (ESP32-S3)': ['.ino', '.cpp', '.h', '.cc'],
  'PlatformIO Firmware': ['.ini', '.cpp', '.h', '.ino'],
  'ROS 2 / Python': ['.py', '.xml', '.yaml', '.yml', '.toml'],
  'FreeCAD / OpenUSD': ['.py', '.usd', '.usda'],
  'MuJoCo / URDF': ['.xml', '.mjcf', '.urdf'],
};

/**
 * Returns the target paths whose extension the selected runtime does not
 * cover. An empty array means every path is plausible for that runtime.
 *
 * @param {string} runtime
 * @param {string[]} paths
 * @returns {string[]}
 */
export function findRuntimeMismatches(runtime, paths) {
  const expected = RUNTIME_EXPECTED_EXTENSIONS[runtime];
  if (!expected || !Array.isArray(paths)) return [];
  return paths.filter((path) => {
    const lowered = String(path).toLowerCase();
    return lowered.length > 0 && !expected.some((ext) => lowered.endsWith(ext));
  });
}
