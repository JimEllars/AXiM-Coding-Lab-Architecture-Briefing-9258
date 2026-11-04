/**
 * The dashboard keeps its own copy of the fleet coordinates
 * (`src/lib/fleetRegistry.js`) so the browser bundle never has to import worker
 * code. Two copies drift — this one already had: `ROBOTICS` pointed at
 * `axim-robotics-lab`, which is a 404 on GitHub, and `ASGUARD` was spelled
 * `axim-asguard-system-app-1` against the worker's `AXiM-Asguard-System-App-1`.
 *
 * Rather than trust review, this suite imports the worker's authoritative
 * `AXiM_ECOSYSTEM_REGISTRY` and asserts key-by-key parity in both directions.
 * A repo added on one side only, a renamed repo, or a re-typed owner now fails
 * CI instead of producing a silent 404 in the cockpit.
 */
import { describe, it, expect } from 'vitest';
import {
  FLEET_REGISTRY,
  CANONICAL_OWNER,
  resolveFleetCoordinates,
  findRuntimeMismatches,
} from './fleetRegistry';
import { AXiM_ECOSYSTEM_REGISTRY, CANONICAL_OWNER as WORKER_OWNER } from '../../edge-coder-worker/src/registry';

describe('fleet registry parity with the edge worker', () => {
  it('pins the same canonical owner as the worker', () => {
    expect(CANONICAL_OWNER).toBe(WORKER_OWNER);
    expect(CANONICAL_OWNER).toBe('JimEllars');
  });

  it('registers exactly the same project keys', () => {
    expect(Object.keys(FLEET_REGISTRY).sort()).toEqual(Object.keys(AXiM_ECOSYSTEM_REGISTRY).sort());
  });

  it('matches repo, owner and default branch for every key', () => {
    const mismatches = Object.entries(AXiM_ECOSYSTEM_REGISTRY)
      .map(([key, workerEntry]) => {
        const dashboardEntry = FLEET_REGISTRY[key];
        if (!dashboardEntry) return `${key}: missing from the dashboard registry`;
        const diffs = [];
        if (dashboardEntry.repo !== workerEntry.repo) diffs.push(`repo "${dashboardEntry.repo}" != "${workerEntry.repo}"`);
        if (dashboardEntry.owner !== workerEntry.owner) diffs.push(`owner "${dashboardEntry.owner}" != "${workerEntry.owner}"`);
        if (dashboardEntry.defaultBranch !== workerEntry.defaultBranch) {
          diffs.push(`defaultBranch "${dashboardEntry.defaultBranch}" != "${workerEntry.defaultBranch}"`);
        }
        return diffs.length > 0 ? `${key}: ${diffs.join(', ')}` : null;
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('never lists a repository whose name differs only by case from the worker', () => {
    // GitHub resolves case-insensitively but `raw.githubusercontent.com` and
    // audit logs do not; exact spelling keeps both halves talking about one repo.
    for (const entry of Object.values(FLEET_REGISTRY)) {
      const workerMatch = Object.values(AXiM_ECOSYSTEM_REGISTRY).find(
        (worker) => worker.repo.toLowerCase() === entry.repo.toLowerCase()
      );
      expect(workerMatch?.repo).toBe(entry.repo);
    }
  });
});

describe('resolveFleetCoordinates', () => {
  it('resolves a project key to canonical coordinates', () => {
    expect(resolveFleetCoordinates('ROBOTICS')).toEqual({
      owner: 'JimEllars',
      repo: 'AXiM-Robotics-Lab-Program-4198',
      defaultBranch: 'main',
    });
  });

  it('resolves a lower-case key', () => {
    expect(resolveFleetCoordinates('core').repo).toBe('axim-core-v1.2');
  });

  it('resolves a bare repository name', () => {
    expect(resolveFleetCoordinates('onyx_mk3')).toMatchObject({ owner: 'JimEllars', repo: 'onyx_mk3' });
  });

  it('resolves an owner/repo slug and pins the canonical owner', () => {
    expect(resolveFleetCoordinates('some-fork/axim-core-v1.2')).toEqual({
      owner: 'JimEllars',
      repo: 'axim-core-v1.2',
      defaultBranch: 'main',
    });
  });

  it('falls back to CORE for an empty value instead of throwing', () => {
    expect(resolveFleetCoordinates(undefined).repo).toBe('axim-core-v1.2');
    expect(resolveFleetCoordinates('   ').repo).toBe('axim-core-v1.2');
  });

  it('keeps an unknown repository name but still pins the owner', () => {
    expect(resolveFleetCoordinates('JimEllars/brand-new-repo')).toEqual({
      owner: 'JimEllars',
      repo: 'brand-new-repo',
      defaultBranch: 'main',
    });
  });
});

describe('findRuntimeMismatches', () => {
  it('accepts the paths the runtime hints suggest', () => {
    expect(findRuntimeMismatches('MuJoCo / URDF', ['robot/axim_arm.urdf', 'robot/scene.mjcf'])).toEqual([]);
    expect(findRuntimeMismatches('PlatformIO Firmware', ['platformio.ini', 'src/main.cpp'])).toEqual([]);
    expect(findRuntimeMismatches('FreeCAD / OpenUSD', ['models/bracket.py'])).toEqual([]);
  });

  it('flags a path the worker would route to a different validator', () => {
    expect(findRuntimeMismatches('FreeCAD / OpenUSD', ['src/app.ts'])).toEqual(['src/app.ts']);
    expect(findRuntimeMismatches('MuJoCo / URDF', ['robot/arm.py'])).toEqual(['robot/arm.py']);
  });

  it('is case-insensitive about the extension and ignores blank entries', () => {
    expect(findRuntimeMismatches('Python Sandbox', ['SCRIPTS/Pipeline.PY', ''])).toEqual([]);
  });

  it('returns nothing for an unknown runtime so the operator is not blocked', () => {
    expect(findRuntimeMismatches('Some Future Runtime', ['src/app.ts'])).toEqual([]);
  });
});
