/**
 * Vitest configuration.
 *
 * Two things this file guarantees that Vite's defaults do not:
 *
 * 1. `NODE_ENV` is `test` for the whole run.
 *
 *    `src/components/render-smoke.test.jsx` mounts real components inside
 *    `act()`, and `act()` throws "act(...) is not supported in production builds
 *    of React" the moment it finds `react.production.min.js`. Vite chooses
 *    React's export condition from `process.env.NODE_ENV` — *ahead* of
 *    `config.mode` — so any shell that already exports `NODE_ENV=production`
 *    (container images, `npm run` wrappers, CI runners that set it for the build
 *    step, the operator's own workstation) silently swaps in the production
 *    build and fails all 20 smoke cases with an error that has nothing to do
 *    with the component under test. Pinning it here makes the suite independent
 *    of the caller's environment.
 *
 *    The assignment has to run while this module is evaluated: Vite reads
 *    `process.env.NODE_ENV` inside `resolveConfig`, after the config module
 *    loads but before any test file imports React. `test.env` is too late —
 *    React is already resolved by then.
 *
 * 2. The `@` alias and the React plugin from `vite.config.js` still apply, via
 *    `mergeConfig`, so tests resolve modules exactly the way the bundle does.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

process.env.NODE_ENV = 'test';

/** Resolved from this file, not from `process.cwd()`. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  viteConfig,
  defineConfig({
    // Pinned so `cd edge-coder-worker && npm test` and `npx vitest run` from the
    // repo root both resolve the same test set and the same `@` alias, instead
    // of the subdirectory run finding no files under the root-relative
    // `include` patterns.
    root: projectRoot,
    test: {
      // Per-file `// @vitest-environment jsdom` pragmas stay authoritative: the
      // render smoke suite needs a DOM, the edge worker suite must not pay for
      // one. Node is the safe default for everything that says nothing.
      environment: 'node',
      include: [
        'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
        'edge-coder-worker/tests/**/*.test.ts',
      ],
      // The worker tests spin up a real Miniflare worker per suite; the render
      // smoke suite mounts 20 routed pages. Both blow past Vitest's 5s default
      // on a cold transform cache.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  })
);
