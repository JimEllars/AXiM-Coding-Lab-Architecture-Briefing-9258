// @vitest-environment jsdom
/**
 * Dispatch-path tests for the cockpit Prompt Terminal.
 *
 * `render-smoke.test.jsx` proves PromptTerminal mounts. It cannot prove the
 * thing the terminal exists to do: take the operator's runtime and target paths
 * and put them in the payload the worker routes on. A wrong `runtime_env` does
 * not throw — it silently sends generated code to the wrong validator, so the
 * failure shows up much later as an `[AST_CHECK]` rejection on a run that cost
 * an LLM call.
 *
 * These tests assert on the payload handed to `labService.triggerTask`, which is
 * the last thing the component owns before the network. Nothing here mocks the
 * component's internals; the DOM is driven the way a user drives it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { installDomShims } from '../test/domShims';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { triggerTask, getRepositories, getKnowledge, logToConsole } = vi.hoisted(() => ({
  triggerTask: vi.fn(async () => ({ ok: true })),
  getRepositories: vi.fn(async () => [{ id: 'core', name: 'axim-core-v1.2' }]),
  getKnowledge: vi.fn(async () => []),
  logToConsole: vi.fn(),
}));

vi.mock('../services/labService', () => ({
  labService: { triggerTask, getRepositories, getKnowledge, logToConsole },
}));

import PromptTerminal from './PromptTerminal';

let container = null;
let root = null;

/** React tracks input values on the DOM node, so a raw `.value` assignment is
 *  swallowed on the next render. Going through the native setter is what a
 *  real keystroke does. */
function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLSelectElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function typeInto(element, value) {
  await act(async () => {
    setNativeValue(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function mount() {
  const module = await import('./PromptTerminal');
  const Component = module.default;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Component />
      </MemoryRouter>
    );
  });
  return container;
}

/** The deploy control is gated on the operator role; without this the button is
 *  disabled and a click silently does nothing, which would make every assertion
 *  below pass for the wrong reason. */
function grantOperatorRole() {
  localStorage.setItem('axim_user_role', 'super_user');
}

function deployButton() {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => /DEPLOY SWARM|TRANSMITTING PAYLOAD/i.test(candidate.textContent || ''));
  if (!button) throw new Error('Deploy button not found in PromptTerminal');
  return button;
}

beforeEach(() => {
  installDomShims();
  grantOperatorRole();
  triggerTask.mockClear();
  // A render is not a network call. `getFilePreview` and friends would
  // otherwise reject against jsdom's absent origin.
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

describe('PromptTerminal dispatch payload', () => {
  it('sends the selected runtime as runtime_env', async () => {
    await mount();

    const runtimeSelect = container.querySelector('#axim-target-runtime');
    expect(runtimeSelect).not.toBeNull();

    await typeInto(runtimeSelect, 'FreeCAD / OpenUSD');
    await typeInto(container.querySelector('#axim-target-files'), 'models/bracket.py');
    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'sweep a 40mm bracket');
    await typeInto(container.querySelector('#axim-target-repo'), 'axim-core-v1.2');

    await act(async () => {
      deployButton().click();
    });

    expect(triggerTask).toHaveBeenCalledTimes(1);
    const payload = triggerTask.mock.calls[0][0];

    expect(payload.runtime_env).toBe('FreeCAD / OpenUSD');
    expect(payload.target_file_paths).toEqual(['models/bracket.py']);
    expect(payload.instruction_prompt).toBe('sweep a 40mm bracket');
    expect(payload.repository_name).toBe('axim-core-v1.2');
    expect(payload.project_key).toBe('axim-core-v1.2');
    expect(payload.origin_source).toBe('Manual_Dev_Cockpit');
    expect(payload.delegate_to_jules).toBe(false);
  });

  it('splits comma-separated target paths and keeps the MuJoCo runtime intact', async () => {
    await mount();

    await typeInto(container.querySelector('#axim-target-runtime'), 'MuJoCo / URDF');
    await typeInto(container.querySelector('#axim-target-files'), 'robot/axim_arm.urdf, robot/scene.mjcf');
    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'add a wrist joint');

    await act(async () => {
      deployButton().click();
    });

    const payload = triggerTask.mock.calls[0][0];
    expect(payload.runtime_env).toBe('MuJoCo / URDF');
    expect(payload.target_file_paths).toEqual(['robot/axim_arm.urdf', 'robot/scene.mjcf']);
  });

  it('routes to the Jules engine only when the operator selects it', async () => {
    await mount();

    await typeInto(container.querySelector('#axim-execution-engine'), 'Jules Agent (External Google Cloud)');
    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'bump the SDK version');

    await act(async () => {
      deployButton().click();
    });

    expect(triggerTask.mock.calls[0][0].delegate_to_jules).toBe(true);
  });

  it('surfaces a runtime/path mismatch hint without blocking dispatch', async () => {
    await mount();

    await typeInto(container.querySelector('#axim-target-runtime'), 'FreeCAD / OpenUSD');
    await typeInto(container.querySelector('#axim-target-files'), 'src/main.cpp');

    expect(container.textContent).toContain('RUNTIME/PATH MISMATCH');

    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'anything');
    await act(async () => {
      deployButton().click();
    });

    // A warning is a hint, not a gate: the worker stays the authority on
    // syntax, and refusing here would strand the operator with no reason.
    expect(triggerTask).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch an empty prompt', async () => {
    await mount();

    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), '   ');

    await act(async () => {
      deployButton().click();
    });

    expect(triggerTask).not.toHaveBeenCalled();
  });

  it('keeps the deploy control disabled for a non-operator role', async () => {
    localStorage.setItem('axim_user_role', 'engineer');
    await mount();

    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'attempt');
    expect(deployButton().disabled).toBe(true);
  });

  it('does not dispatch when the edge call rejects, and reports it to the console', async () => {
    triggerTask.mockRejectedValueOnce(new Error('edge unreachable'));
    await mount();

    await typeInto(container.querySelector('textarea[aria-label="Task prompt"]'), 'will fail');

    await act(async () => {
      deployButton().click();
    });

    expect(triggerTask).toHaveBeenCalledTimes(1);
    expect(logToConsole).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('edge unreachable') })
    );
    // The operator's prompt has to survive a failed dispatch, otherwise the
    // text is gone and they have to type the task again.
    expect(container.querySelector('textarea[aria-label="Task prompt"]').value).toBe('will fail');
  });
});
