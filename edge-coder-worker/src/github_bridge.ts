import { Env } from './ingress';

export interface GithubContext {
  owner: string;
  repo: string;
  path: string;
  baseBranch?: string;
}

export interface FileState {
  content: string;
  sha: string;
}

/**
 * Standardized headers for all GitHub REST API interactions.
 */
function getGithubHeaders(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AXiM-Coding-Lab-Swarm'
  };
}

/**
 * STEP 1: Fetch the current state of a file to feed into the Onyx LLM Proxy.
 */
export async function fetchCurrentFileState(
  ctx: GithubContext, 
  env: Env
): Promise<FileState> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${ctx.path}?ref=${ctx.baseBranch || 'main'}`;
  
  const response = await fetch(url, { headers: getGithubHeaders(env.GITHUB_PAT) });
  
  if (!response.ok) {
    throw new Error(`[VCS_ERROR] Failed to fetch file state: ${response.statusText}`);
  }

  const data: any = await response.json();
  const decodedContent = atob(data.content);
  
  return {
    content: decodedContent,
    sha: data.sha
  };
}

/**
 * STEP 2: Create a new branch for the AI to work on.
 */
export async function createTaskBranch(
  ctx: GithubContext, 
  newBranchName: string, 
  env: Env
): Promise<void> {
  const base = ctx.baseBranch || 'main';
  
  const refUrl = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${base}`;
  const refResponse = await fetch(refUrl, { headers: getGithubHeaders(env.GITHUB_PAT) });
  
  if (!refResponse.ok) {
    throw new Error(`[VCS_ERROR] Failed to fetch base branch reference: ${refResponse.statusText}`);
  }
  
  const refData: any = await refResponse.json();
  const baseSha = refData.object.sha;

  const createUrl = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/git/refs`;
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: getGithubHeaders(env.GITHUB_PAT),
    body: JSON.stringify({
      ref: `refs/heads/${newBranchName}`,
      sha: baseSha
    })
  });

  if (!createResponse.ok) {
    throw new Error(`[VCS_ERROR] Failed to create branch ${newBranchName}: ${createResponse.statusText}`);
  }
}

/**
 * STEP 3: Commit the LLM-generated code to the newly created branch.
 */
export async function commitGeneratedCode(
  ctx: GithubContext,
  branchName: string,
  newContent: string,
  fileSha: string,
  commitMessage: string,
  env: Env
): Promise<void> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${ctx.path}`;
  const encodedContent = btoa(unescape(encodeURIComponent(newContent)));

  const response = await fetch(url, {
    method: 'PUT',
    headers: getGithubHeaders(env.GITHUB_PAT),
    body: JSON.stringify({
      message: commitMessage,
      content: encodedContent,
      sha: fileSha,
      branch: branchName
    })
  });

  if (!response.ok) {
    throw new Error(`[VCS_ERROR] Failed to commit code: ${response.statusText}`);
  }
}

/**
 * STEP 4: Open a Pull Request for human (or autonomous) review.
 */
export async function openPullRequest(
  ctx: GithubContext,
  branchName: string,
  prTitle: string,
  prBody: string,
  env: Env
): Promise<string> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls`;
  const base = ctx.baseBranch || 'main';

  const response = await fetch(url, {
    method: 'POST',
    headers: getGithubHeaders(env.GITHUB_PAT),
    body: JSON.stringify({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: base
    })
  });

  if (!response.ok) {
    throw new Error(`[VCS_ERROR] Failed to open Pull Request: ${response.statusText}`);
  }

  const data: any = await response.json();
  return data.html_url;
}
/**
 * STEP 5: Merge a Pull Request.
 */
export async function mergePullRequest(
  ctx: GithubContext,
  prNumber: number,
  env: Env
): Promise<void> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${prNumber}/merge`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: getGithubHeaders(env.GITHUB_PAT),
    body: JSON.stringify({
      commit_title: `Merge PR #${prNumber}`,
      merge_method: 'squash'
    })
  });

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errorJson: any = await response.json();
      if (errorJson && errorJson.message) {
        errorDetail = errorJson.message;
      }
    } catch (e) {
      // Ignore
    }
    throw new Error(`Failed to merge PR #${prNumber}: [${response.status}] ${errorDetail}`);
  }
}
