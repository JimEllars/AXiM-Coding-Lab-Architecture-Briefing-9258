// @vitest-environment jsdom
/**
 * Render smoke suite for the dashboard.
 *
 * Until this file existed the repo had zero React tests. `npm run lint`,
 * `vitest` and `vite build` all pass on JSX that throws the moment React
 * renders it, which is how PromptTerminal and Telemetry shipped with
 * temporal-dead-zone `ReferenceError`s that blanked their pages behind the
 * layout ErrorBoundary. Every routed page and the shared components are mounted
 * here so a render-time crash fails CI instead of the operator's screen.
 *
 * Kept deliberately dumb: mount, assert the tree rendered, unmount. Behaviour
 * belongs in targeted tests; this is the "does it explode" net.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { installDomShims } from '../test/domShims';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Each case is `[module path, export name, options]`.
 *
 * `props` are the arguments the component needs to produce markup;
 * `allowsEmptyRender` marks components that intentionally render `null` until
 * they receive props or data (a command palette that is closed, a reasoning
 * drawer with no active task), so the "produced DOM" assertion stays
 * meaningful everywhere else.
 */
const CASES = [
  ['components/PromptTerminal', 'PromptTerminal', {}],
  ['components/SwarmLogConsole', 'SwarmLogConsole', {}],
  ['components/PipelineMonitor', 'PipelineMonitor', {}],
  ['components/DiffViewer', 'DiffViewer', { allowsEmptyRender: true }],
  ['components/CognitiveReasoning', 'CognitiveReasoning', { allowsEmptyRender: true }],
  ['components/CommandPalette', 'CommandPalette', { props: { isOpen: true, onClose: () => {} } }],
  ['components/layout/DashboardLayout', 'DashboardLayout', {}],
  ['pages/Cockpit', 'Cockpit', {}],
  ['pages/PullRequests', 'PullRequests', {}],
  ['pages/Repositories', 'Repositories', {}],
  ['pages/RepositoryDetail', 'RepositoryDetail', {}],
  ['pages/Topology', 'Topology', {}],
  ['pages/AuditLogs', 'AuditLogs', {}],
  ['pages/Settings', 'Settings', {}],
  ['pages/SecOps', 'SecOps', {}],
  ['pages/KnowledgeBase', 'KnowledgeBase', {}],
  ['pages/AgentRegistry', 'AgentRegistry', {}],
  ['pages/Telemetry', 'Telemetry', {}],
  ['pages/Login', 'Login', {}],
  ['pages/AuthCallback', 'AuthCallback', {}],
];

let container = null;
let root = null;

beforeEach(() => {
  installDomShims();
  // A render is not a network call. `labService` talks to Supabase and the
  // worker; stub `fetch` so an unguarded call rejects instead of hanging.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  );
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('dashboard render smoke', () => {
  for (const [modulePath, name, options] of CASES) {
    it(`mounts ${name} without throwing`, async () => {
      const module = await import(/* @vite-ignore */ `../${modulePath}`);
      const Component = module.default;
      expect(typeof Component).toBe('function');

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      let thrown = null;
      try {
        await act(async () => {
          root.render(
            <MemoryRouter initialEntries={['/repositories/demo-repo-1']}>
              <Component {...(options.props || {})} />
            </MemoryRouter>
          );
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown && `${name}: ${thrown.message}`).toBeNull();

      if (!options.allowsEmptyRender) {
        expect(container.innerHTML.length).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});
