/**
 * Task lifecycle state for the Coding Lab.
 *
 * Two things live in `TASK_LOCKS` under a task id:
 *
 * - `lock:<taskId>`     — a run lease, held while the pipeline is generating.
 * - `pr-open:<taskId>`  — the PR the pipeline already opened for this task.
 *
 * Before this module existed the two ingress routes each invented their own
 * convention: `/api/v1/ingress` wrote `"active"` and `/api/v1/tasks/dispatch`
 * wrote `"in_progress"`, while dispatch only treated the literal
 * `"in_progress"` as busy. A ticket already running through `/api/v1/ingress`
 * was therefore *not* blocked when the Support System retried it against
 * `/api/v1/tasks/dispatch`, and the same file got two pipelines and two PRs.
 *
 * The rule is now: any value at `lock:<taskId>` means the task is busy. Values
 * are only kept for humans reading KV in the dashboard.
 */

export interface TaskLockStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export const TASK_LOCK_PREFIX = 'lock:';
export const OPEN_PR_PREFIX = 'pr-open:';

/** Value written on acquisition. Kept for dashboard readability. */
export const TASK_LOCK_VALUE = 'in_progress';

/** Long enough to cover one generation + PR open; short enough to self-heal. */
export const TASK_LOCK_TTL_SECONDS = 3600;

/** How long a task is remembered as "already has an open PR". */
export const OPEN_PR_TTL_SECONDS = 86_400;

export type AcquireResult =
  | { acquired: true }
  | { acquired: false; reason: 'locked'; heldValue: string | null }
  | { acquired: false; reason: 'pr-open'; prUrl: string };

export async function readTaskLock(store: TaskLockStore, taskId: string): Promise<string | null> {
  return store.get(`${TASK_LOCK_PREFIX}${taskId}`);
}

export async function readOpenPullRequest(
  store: TaskLockStore,
  taskId: string
): Promise<string | null> {
  return store.get(`${OPEN_PR_PREFIX}${taskId}`);
}

/**
 * Claims the run lease for `taskId`, unless the task is already running or has
 * already produced a pull request. Returns the reason on refusal so callers can
 * answer `202 ignored` with the PR URL instead of a generic "busy".
 */
export async function acquireTaskLock(
  store: TaskLockStore,
  taskId: string
): Promise<AcquireResult> {
  const prUrl = await readOpenPullRequest(store, taskId);
  if (prUrl) {
    return { acquired: false, reason: 'pr-open', prUrl };
  }

  const heldValue = await readTaskLock(store, taskId);
  if (heldValue !== null) {
    return { acquired: false, reason: 'locked', heldValue };
  }

  await store.put(`${TASK_LOCK_PREFIX}${taskId}`, TASK_LOCK_VALUE, {
    expirationTtl: TASK_LOCK_TTL_SECONDS
  });
  return { acquired: true };
}

export async function releaseTaskLock(store: TaskLockStore, taskId: string): Promise<void> {
  await store.delete(`${TASK_LOCK_PREFIX}${taskId}`);
}

/**
 * Records the pull request a task produced and drops the run lease in one step.
 *
 * The lease used to be left behind on success and only expired after an hour,
 * which blocked the ticket if Support retried it. Releasing it is only safe
 * because the `pr-open:` marker now carries the dedupe guarantee.
 */
export async function recordOpenPullRequest(
  store: TaskLockStore,
  taskId: string,
  prUrl: string
): Promise<void> {
  await store.put(`${OPEN_PR_PREFIX}${taskId}`, prUrl, { expirationTtl: OPEN_PR_TTL_SECONDS });
  await releaseTaskLock(store, taskId);
}

/** Full reset: the PR closed/merged, or an operator force-unlocked the task. */
export async function clearTaskState(store: TaskLockStore, taskId: string): Promise<void> {
  await store.delete(`${TASK_LOCK_PREFIX}${taskId}`);
  await store.delete(`${OPEN_PR_PREFIX}${taskId}`);
}
