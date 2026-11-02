import { expect, test, describe } from 'vitest';
import {
  AXiM_ECOSYSTEM_REGISTRY,
  CANONICAL_OWNER,
  resolveRepoMetadata
} from '../src/registry';
import { constantTimeEqual } from '../src/utils/crypto';

/** Fleet members the coding lab must be able to address. */
const REQUIRED_FLEET = [
  'CORE',
  'SUPPORT',
  'SPEEDREPORT',
  'ONYX',
  'ROBOTICS',
  'ACADEMY',
  'FRONTEND',
  'ASGUARD'
];

describe('Fleet registry', () => {
  test('every required fleet member is registered', () => {
    for (const key of REQUIRED_FLEET) {
      expect(AXiM_ECOSYSTEM_REGISTRY[key], `${key} missing from registry`).toBeDefined();
      expect(AXiM_ECOSYSTEM_REGISTRY[key].repo.length).toBeGreaterThan(0);
      expect(AXiM_ECOSYSTEM_REGISTRY[key].defaultBranch).toBe('main');
      expect(AXiM_ECOSYSTEM_REGISTRY[key].testCommand.length).toBeGreaterThan(0);
    }
  });

  test('every entry is owned by the canonical owner', () => {
    for (const [key, entry] of Object.entries(AXiM_ECOSYSTEM_REGISTRY)) {
      expect(entry.owner, `${key} owner`).toBe(CANONICAL_OWNER);
      expect(entry.key, `${key} key mismatch`).toBe(key);
    }
  });

  test('no entry points at a placeholder organisation or search-path style repo', () => {
    for (const [key, entry] of Object.entries(AXiM_ECOSYSTEM_REGISTRY)) {
      expect(entry.owner, `${key}`).not.toMatch(/dummy|example|placeholder|axim-organization/i);
      expect(entry.repo.split('/').length, `${key} repo must be a bare repository name`).toBe(1);
    }
  });

  test('ROBOTICS resolves to the real robotics program repository', () => {
    expect(AXiM_ECOSYSTEM_REGISTRY.ROBOTICS.repo).toBe('AXiM-Robotics-Lab-Program-4198');
    expect(resolveRepoMetadata('ROBOTICS')).toEqual({
      owner: 'JimEllars',
      repo: 'AXiM-Robotics-Lab-Program-4198',
      defaultBranch: 'main'
    });
  });

  test('ASGUARD uses the canonical GitHub casing', () => {
    expect(AXiM_ECOSYSTEM_REGISTRY.ASGUARD.repo).toBe('AXiM-Asguard-System-App-1');
  });
});

describe('resolveRepoMetadata', () => {
  test('resolves by project key, case-insensitively', () => {
    expect(resolveRepoMetadata('core').repo).toBe('axim-core-v1.2');
    expect(resolveRepoMetadata('Onyx').repo).toBe('onyx_mk3');
  });

  test('parses an owner/repo slug without doubling the owner', () => {
    // The dashboard sends `repository_name: "JimEllars/axim-core-v1.2"`.
    expect(resolveRepoMetadata('JimEllars/axim-core-v1.2')).toEqual({
      owner: 'JimEllars',
      repo: 'axim-core-v1.2',
      defaultBranch: 'main'
    });
  });

  test('parses a slug for a repo that is not in the registry', () => {
    expect(resolveRepoMetadata('JimEllars/ForemanOS-Construction-Management-Platform-869')).toEqual({
      owner: 'JimEllars',
      repo: 'ForemanOS-Construction-Management-Platform-869',
      defaultBranch: 'main'
    });
  });

  test('resolves a bare repository name against the registry', () => {
    expect(resolveRepoMetadata('AXiM-Support-System-1.1-4538').repo).toBe('AXiM-Support-System-1.1-4538');
  });

  test('coerces a non-canonical owner back to JimEllars', () => {
    expect(resolveRepoMetadata('axim-organization/axim-core-v1.2').owner).toBe(CANONICAL_OWNER);
    expect(resolveRepoMetadata('some-fork/axim-core-v1.2').repo).toBe('axim-core-v1.2');
  });

  test('falls back to CORE for unknown keys with no repo hint', () => {
    expect(resolveRepoMetadata()).toEqual({
      owner: 'JimEllars',
      repo: 'axim-core-v1.2',
      defaultBranch: 'main'
    });
  });

  test('honours the fallback repo argument for unknown keys', () => {
    expect(resolveRepoMetadata(undefined, 'SpeedReport.org-Speed-Test-App-9642').repo).toBe(
      'SpeedReport.org-Speed-Test-App-9642'
    );
  });
});

describe('constant-time secret comparison', () => {
  test('matches identical secrets', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  test('rejects different secrets, prefixes and suffixes', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    expect(constantTimeEqual('abc', 'abc123')).toBe(false);
    expect(constantTimeEqual('abc123', 'abc')).toBe(false);
    expect(constantTimeEqual('', 'abc')).toBe(false);
  });

  test('treats two empty secrets as equal', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
