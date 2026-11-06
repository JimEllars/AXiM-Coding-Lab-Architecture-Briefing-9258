import { Env } from './ingress';
import { fetchCurrentFileState, fetchRepositoryDependencies, createTaskBranch, commitGeneratedCode, openPullRequest, GithubContext } from './github_bridge';
import { dispatchCallbackWebhook } from './callback_dispatcher';
import { reportGreenMachineTelemetry } from './telemetry';
import { recordOpenPullRequest, releaseTaskLock } from './locks';

let step_count = 0;
let tokens_consumed = 0;
let exit_code = 0;

export function cleanSanitizedCodeBlob(rawText: string): string {
  let clean = rawText.trim();

  // Strip leading/trailing code fences strictly
  clean = clean.replace(/^\s*```[a-zA-Z]*\s*\n/gm, '');
  clean = clean.replace(/\n\s*```\s*$/gm, '');

  const codeBlockRegex = /^```[a-z]*\n([\s\S]*?)\n```$/i;
  const match = clean.match(codeBlockRegex);
  if (match) {
    clean = match[1].trim();
  }

  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].trim() === '```') lines.pop();
    clean = lines.join('\n').trim();
  }

  // Remove any remaining code fences at the start or end
  clean = clean.replace(/^\s*```[a-zA-Z]*\s*\n/m, '');
  clean = clean.replace(/\n\s*```\s*$/m, '');

  return clean.trim();
}

async function requestCognitiveCodeGeneration(
  currentCode: string,
  instructions: string,
  runtime_env: string,
  dependenciesContext: string,
  env: Env,
  assigned_model?: string
): Promise<{ code: string; providerUsed: "deepseek" | "anthropic"; failoverTriggered: boolean }> {
  const systemInstructions = `You are an expert full-stack systems engineer specializing in ${runtime_env} architecture. Output ONLY raw source code without markdown code fences.`;
  const promptBody = `### Workspace Dependencies:\n${dependenciesContext}\n\n### Original Source:\n${currentCode}\n\n### Directives:\n${instructions}`;

  // Attempt A: DeepSeek Primary
  try {
    const deepseekPayload = {
      provider: "deepseek",
      prompt: promptBody,
      options: { model: assigned_model || "deepseek-coder", temperature: 0.2, system: systemInstructions }
    };

    const response = await fetch(env.SUPABASE_LLM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}` },
      body: JSON.stringify(deepseekPayload),
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) throw new Error(`DeepSeek Error HTTP ${response.status}: ${await response.text()}`);
    const result: any = await response.json();
    if (result.error) throw new Error(`DeepSeek Error: ${result.error}`);

    return { code: cleanSanitizedCodeBlob(result.content || ""), providerUsed: "deepseek", failoverTriggered: false };
  } catch (err: any) {
    console.warn(`[LLM_CASCADE] DeepSeek primary failed (${err.message}). Failing over to Anthropic Claude 3.5 Sonnet.`);

    // Attempt B: Anthropic Claude 3.5 Fallback
    const anthropicPayload = {
      provider: "anthropic",
      prompt: promptBody,
      options: { model: "claude-3-5-sonnet-20241022", temperature: 0.2, system: systemInstructions }
    };

    const fallbackRes = await fetch(env.SUPABASE_LLM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}` },
      body: JSON.stringify(anthropicPayload),
      signal: AbortSignal.timeout(15000)
    });

    if (!fallbackRes.ok) throw new Error(`Anthropic Fallback Error HTTP ${fallbackRes.status}: ${await fallbackRes.text()}`);
    const fallbackResult: any = await fallbackRes.json();
    if (fallbackResult.error) throw new Error(`Anthropic Fallback Error: ${fallbackResult.error}`);

    return { code: cleanSanitizedCodeBlob(fallbackResult.content || ""), providerUsed: "anthropic", failoverTriggered: true };
  }
}





async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env, cfRay?: string, truncated: boolean = false, runtimeEnv: string = 'Node.js Edge', assigned_model?: string): Promise<void> {
  const telemetryBody = [{
    app_id: 'axim-coding-lab',
    endpoint: '/v1/gitops/pr-creation',
    method: 'POST',
    status_code: 200,
    error_message: null,
    metadata: { task_id: taskId, trigger_origin: source, pull_request_target: prUrl, cf_ray: cfRay || 'unknown' }
  }];

  // Update the payload sent back to public.coding_tasks upon a successful generation
  await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'apikey': env.SUPABASE_SECRET_KEY
    },
    body: JSON.stringify({
      context: {
        truncated: truncated,
        execution_target: 'Python/Node',
        runtime_env: runtimeEnv,
        assigned_model: assigned_model
      }
    })
  });

  await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'apikey': env.SUPABASE_SECRET_KEY
    },
    body: JSON.stringify(telemetryBody)
  });
}

async function logLabFaultToCore(taskId: string, error: any, env: Env): Promise<void> {
  try {
    step_count++;
    const errorBody = {
      task_id: taskId,
      component: 'axim-coding-lab-generator',
      error_message: error.message,
      stack_trace: error.stack || '',
      status: 'FAILED',
      created_at: new Date().toISOString()
    };

    await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'apikey': env.SUPABASE_SECRET_KEY
      },
      body: JSON.stringify(errorBody)
    });
  } catch (e) {
    console.error('[CORE_LOGGING_CRASH] Failed to sync error state back to database:', e);
  }
}


export function sanitizeVulnerabilityVectors(code: string): { safe: boolean; error?: string } {
  // Regex check for obvious raw unescaped variable concatenations often injected by LLMs into SQL template strings
  // Example: `SELECT * FROM users WHERE id = ${id}`
  // We check for `.*SELECT.*\$\{.*\}.*` inside backticks or similar patterns for basic SQL injection vectors
  const sqlInjectionPattern = /`\s*(SELECT|INSERT|UPDATE|DELETE).+?\$\{.+?\}.*?`/i;

  if (sqlInjectionPattern.test(code)) {
    return { safe: false, error: 'Detected potential SQL injection vector: Unescaped variable concatenation in template string.' };
  }

  // Generic concatenated SQL pattern: "SELECT * FROM " + var
  const stringConcatInjection = /["']\s*(SELECT|INSERT|UPDATE|DELETE).+?["']\s*\+/i;
  if (stringConcatInjection.test(code)) {
     return { safe: false, error: 'Detected potential SQL injection vector: String concatenation in SQL query.' };
  }

  const phpDangerousExecution = /\b(eval|system|passthru|exec|shell_exec|popen|proc_open|assert)\s*\(/i;
  const phpSuperGlobalConcat = /(\$_(GET|POST|REQUEST|SERVER|COOKIE))\[.*?\]\s*\./i;
  const roboticsMotorOverride = /\b(force_override|override_motor|infinite_loop)\b|while\s*\(\s*true\s*\)/i;

  if (phpDangerousExecution.test(code) || phpSuperGlobalConcat.test(code)) {
    return { safe: false, error: 'Detected potential PHP command injection or insecure superglobal concatenation' };
  }

  // The sink list above only covers direct code execution, and the superglobal
  // rule above only fires on concatenation. A web shell does not need either:
  // `<?php include $_GET['f']; ?>` never concatenates anything and never calls
  // eval, and `$x = $_POST['c']; $x();` is a variable-function call. Guard the
  // remaining PHP sinks, but only inside files that actually read request input
  // — that keeps the backtick and variable-variable rules from firing on
  // JavaScript template literals.
  const phpRequestInput = /\$_(GET|POST|REQUEST|COOKIE|FILES|SERVER|ENV)\b/;
  if (phpRequestInput.test(code)) {
    if (/\b(include|include_once|require|require_once)\s*[\s(]/i.test(code)) {
      return { safe: false, error: 'Detected potential PHP file inclusion (LFI/RFI) driven by request input.' };
    }
    if (/\b(call_user_func|call_user_func_array|create_function|forward_static_call|unserialize|extract|parse_str|preg_replace)\s*\(/i.test(code)) {
      return { safe: false, error: 'Detected potential PHP dynamic dispatch or deserialization sink reachable from request input.' };
    }
    if (/`[^`\n]+`/.test(code)) {
      return { safe: false, error: 'Detected potential PHP backtick shell execution.' };
    }
    if (/\$\$[A-Za-z_]/.test(code)) {
      return { safe: false, error: 'Detected potential PHP variable-variable indirection in a request-handling file.' };
    }
  }

  if (roboticsMotorOverride.test(code)) {
    return { safe: false, error: 'Detected ungrounded motor overrides or infinite loops in robotics firmware.' };
  }

  return { safe: true };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Universal Scene Description (`.usda`).
 *
 * The dashboard has offered a `FreeCAD / OpenUSD` runtime since Sprint 1.6, but
 * nothing downstream validated the `.usda` half of it: any text at all passed.
 * A USDA stage is a textual prim tree that opens with `#usda 1.0` and scopes
 * prims with braces, so a generated stage missing either is not loadable.
 *
 * `.usd` is deliberately not judged here: it is a container format that may
 * hold binary crate data, which this validator never sees as text.
 */
export function validateUsdStage(code: string): ValidationResult {
  if (!/^\s*#usda\s+1\.0\s*$/m.test(code)) {
    return { valid: false, error: 'USDA stage is missing the `#usda 1.0` header.' };
  }

  // Strip strings and comments before counting braces: prim names and asset
  // paths legitimately contain them.
  const stripped = code
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"[^"\n]*"/g, '""')
    .replace(/#[^\n]*/g, '');

  const openBraces = (stripped.match(/\{/g) || []).length;
  const closeBraces = (stripped.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { valid: false, error: `Unbalanced USDA prim scopes: ${openBraces} open vs ${closeBraces} close.` };
  }

  if (!/\bdef\s+\w+/.test(stripped)) {
    return { valid: false, error: 'USDA stage defines no prims (no `def <Type>` statement).' };
  }

  return { valid: true };
}

/**
 * FreeCAD Python scripts must import a real geometry API, call it with
 * arguments, and actually produce output (show / recompute / export). A script
 * that merely defines classes still satisfies a brace count, which is why the
 * old check waved broken models through.
 */
export function validateFreeCadScript(code: string): ValidationResult {
  const hasGeometryImport = /^\s*(?:import\s+(FreeCAD|Part|Sketcher|Draft|Mesh)|from\s+(FreeCAD|Part|Sketcher|Draft|Mesh)\s+import)/m.test(code);
  if (!hasGeometryImport) {
    return { valid: false, error: 'FreeCAD script does not import FreeCAD, Part, Sketcher, Draft or Mesh.' };
  }

  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return { valid: false, error: `Mismatched parentheses in FreeCAD script: ${openParens} open vs ${closeParens} close.` };
  }

  // Geometry primitives must be constructed with dimensions, not bare calls.
  const barePrimitive = /\b(?:Part\.make[A-Za-z]+|Draft\.make[A-Za-z]+)\s*\(\s*\)/;
  if (barePrimitive.test(code)) {
    return { valid: false, error: 'FreeCAD geometry primitive called without dimensions (e.g. Part.makeBox() with no arguments).' };
  }

  const sketcherCall = /\bSketcher\.[A-Za-z]+\s*\(|Sketcher::SketchObject/;
  if (sketcherCall.test(code) && !/\baddGeometry\s*\(|\baddConstraint\s*\(/.test(code)) {
    return { valid: false, error: 'Sketcher used without addGeometry/addConstraint; sketch cannot produce geometry.' };
  }

  const producesOutput = /Part\.show\s*\(|\.recompute\s*\(|Part\.export[A-Za-z]*\s*\(|Mesh\.export\s*\(/.test(code);
  if (!producesOutput) {
    return { valid: false, error: 'FreeCAD script never shows, recomputes or exports geometry; nothing would be produced.' };
  }

  return { valid: true };
}

function countXmlTagBalance(xml: string): string | null {
  // Strip comments, CDATA, declarations and doctypes before counting tags.
  const stripped = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  const stack: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(stripped)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing === '/') continue;
    if (closing === '/') {
      const open = stack.pop();
      if (open !== name) {
        return `Unbalanced XML tags: expected </${open ?? 'none'}> but found </${name}>.`;
      }
    } else {
      stack.push(name);
    }
  }

  if (stack.length > 0) {
    return `Unclosed XML tags: ${stack.join(', ')}.`;
  }
  return null;
}

function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z_:][-\w.:]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(tag)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseNumberList(value: string | undefined): number[] | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/).map((token) => Number(token));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * MuJoCo `<default class="…">` joint templates, resolved one level deep.
 *
 * Real MJCF models put `range`/`axis` on a template and omit them on every
 * joint that inherits it:
 *
 *     <default><joint axis="0 0 1" range="-1.57 1.57"/></default>
 *     <default class="arm"><joint range="0 1.57"/></default>
 *     <joint name="shoulder" type="hinge" class="arm"/>
 *
 * The validator read only the joint's own attributes, so every class-inherited
 * joint was rejected as "missing a valid range", burning the one-shot retry and
 * failing a model MuJoCo loads happily. `childclass` chains are flattened to
 * "the nearest enclosing class template wins, then the unnamed template"; that
 * covers the idiom without inventing a limit the document does not contain.
 */
function mjcfDefaultJointTemplates(code: string): {
  main: Record<string, string>;
  byClass: Record<string, Record<string, string>>;
} {
  const main: Record<string, string> = {};
  const byClass: Record<string, Record<string, string>> = {};

  // Walk `<default>` open/close and `<joint>` tags in document order so nested
  // class blocks attribute their templates to the right class.
  const tagPattern = /<\/?default\b[^>]*>|<joint\b[^>]*>/g;
  const openClasses: (string | undefined)[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(code)) !== null) {
    const tag = match[0];

    if (/^<\/default/i.test(tag)) {
      openClasses.pop();
      continue;
    }
    if (/^<default/i.test(tag)) {
      const className = attributesOf(tag).class;
      openClasses.push(className);
      continue;
    }

    if (openClasses.length === 0) continue; // a real joint, not a template

    const enclosingClass = [...openClasses].reverse().find((name) => typeof name === 'string');
    const target = enclosingClass ? (byClass[enclosingClass] ||= {}) : main;
    Object.assign(target, attributesOf(tag));
  }

  return { main, byClass };
}

/**
 * Hardware-as-Code validation for MuJoCo (MJCF) and URDF models.
 *
 * Joint limits and inertials are what make a simulated model physically
 * meaningful: an unconstrained hinge, or a body with no mass, loads in MuJoCo
 * but behaves nothing like the hardware. Both are rejected here rather than
 * discovered during a fleet run.
 */
export function validateMuJoCoModel(code: string, filePath: string): ValidationResult {
  const isUrdf = filePath.toLowerCase().endsWith('.urdf') || /<robot\b/.test(code);

  const balanceError = countXmlTagBalance(code);
  if (balanceError) return { valid: false, error: balanceError };

  if (isUrdf) {
    if (!/<robot\b[^>]*name\s*=/.test(code)) {
      return { valid: false, error: 'URDF root <robot> element is missing a name attribute.' };
    }
    if (!/<link\b/.test(code) || !/<joint\b/.test(code)) {
      return { valid: false, error: 'URDF must declare at least one <link> and one <joint>.' };
    }

    const jointBlocks = code.match(/<joint\b[\s\S]*?<\/joint>/g) || [];
    for (const block of jointBlocks) {
      const jointType = attributesOf(block.match(/<joint\b[^>]*>/)?.[0] || '').type;
      if (jointType === 'revolute' || jointType === 'prismatic') {
        const limitTag = block.match(/<limit\b[^>]*\/?>/)?.[0];
        const limitAttrs = limitTag ? attributesOf(limitTag) : {};
        const lower = Number(limitAttrs.lower);
        const upper = Number(limitAttrs.upper);
        if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
          return { valid: false, error: `URDF ${jointType} joint is missing valid <limit lower="…" upper="…"> bounds.` };
        }
      }
    }

    const inertialBlocks = code.match(/<inertial\b[\s\S]*?<\/inertial>/g) || [];
    if (inertialBlocks.length === 0) {
      return { valid: false, error: 'URDF model defines no <inertial> data; links would be massless.' };
    }
    for (const block of inertialBlocks) {
      const mass = Number(attributesOf(block.match(/<mass\b[^>]*\/?>/)?.[0] || '').value);
      if (!Number.isFinite(mass) || mass <= 0) {
        return { valid: false, error: 'URDF <inertial> must carry a positive <mass value="…">.' };
      }
    }
    return { valid: true };
  }

  if (!/<mujoco\b/.test(code)) {
    return { valid: false, error: 'MuJoCo model is missing the <mujoco> root element.' };
  }

  // Template joints live inside `<default>`; they are class definitions, not
  // bodies, so they must not be validated as real joints (a template carries no
  // `name`). Strip the default blocks before scanning.
  const bodyOnly = code.replace(/<default\b[^>]*>[\s\S]*?<\/default>/g, '');

  const jointTags = bodyOnly.match(/<joint\b[^>]*>/g) || [];
  const jointTemplates = mjcfDefaultJointTemplates(code);
  for (const tag of jointTags) {
    const ownAttrs = attributesOf(tag);
    // Resolution order in MJCF: the joint's own attributes win, then its
    // `class` template, then the unnamed default template.
    const template = ownAttrs.class
      ? { ...jointTemplates.main, ...(jointTemplates.byClass[ownAttrs.class] || {}) }
      : jointTemplates.main;
    const attrs = { ...template, ...ownAttrs };

    if (!attrs.name) {
      return { valid: false, error: 'MuJoCo <joint> is missing a name attribute.' };
    }
    if (attrs.type === 'hinge' || attrs.type === 'slide') {
      const range = parseNumberList(attrs.range);
      if (!range || range.length !== 2 || range[1] <= range[0]) {
        return { valid: false, error: `MuJoCo ${attrs.type} joint "${attrs.name}" is missing a valid range="min max" limit.` };
      }
      if (!parseNumberList(attrs.axis) || parseNumberList(attrs.axis)?.length !== 3) {
        return { valid: false, error: `MuJoCo ${attrs.type} joint "${attrs.name}" is missing a three-component axis.` };
      }
    }
  }

  const inertialTags = bodyOnly.match(/<inertial\b[^>]*>/g) || [];
  for (const tag of inertialTags) {
    const mass = Number(attributesOf(tag).mass);
    if (!Number.isFinite(mass) || mass <= 0) {
      return { valid: false, error: 'MuJoCo <inertial> must declare a positive mass attribute.' };
    }
    if (!parseNumberList(attributesOf(tag).pos)) {
      return { valid: false, error: 'MuJoCo <inertial> must declare a pos="x y z" attribute.' };
    }
  }

  return { valid: true };
}

/**
 * PlatformIO project config: needs a named env, a board and a framework.
 */
export function validatePlatformIoConfig(code: string): ValidationResult {
  if (!/^\s*\[env:[^\]]+\]\s*$/m.test(code)) {
    return { valid: false, error: 'platformio.ini has no [env:<name>] section.' };
  }
  if (!/^\s*board\s*=\s*\S+/m.test(code)) {
    return { valid: false, error: 'platformio.ini is missing a board = <target> entry.' };
  }
  if (!/^\s*platform\s*=\s*\S+/m.test(code)) {
    return { valid: false, error: 'platformio.ini is missing a platform = <vendor> entry.' };
  }
  if (!/^\s*framework\s*=\s*\S+/m.test(code)) {
    return { valid: false, error: 'platformio.ini is missing a framework = <name> entry.' };
  }
  return { valid: true };
}

/**
 * PlatformIO firmware source.
 *
 * A translation unit (`.cpp`/`.cc`/`.ino`) needs at least one `#include` so it
 * links against a HAL, and an Arduino sketch additionally needs `setup()`,
 * `loop()` and `<Arduino.h>`.
 *
 * A header is a different contract. Headers used to be routed here too and
 * rejected with "no #include", so a perfectly legal declaration-only header
 *
 *     #pragma once
 *     struct MotorState { float rpm; };
 *
 * failed validation, burned the retry and dead-ended the task. What a header
 * actually needs is an include guard.
 */
export function validatePlatformIoFirmware(code: string, filePath: string): ValidationResult {
  const lowered = filePath.toLowerCase();
  const isHeader = /\.(h|hpp|hh)$/.test(lowered);
  const isSketch = lowered.endsWith('.ino');

  if (isHeader) {
    const hasIncludeGuard =
      /#pragma\s+once/.test(code) ||
      /#ifndef\s+[A-Za-z_]\w*[\s\S]*?#define\s+[A-Za-z_]\w*/.test(code);
    if (!hasIncludeGuard) {
      return { valid: false, error: 'C/C++ header has no include guard (#pragma once or #ifndef/#define).' };
    }
    return { valid: true };
  }

  if (!/#include\s*[<"]/.test(code)) {
    return { valid: false, error: 'Firmware source has no #include; it will not link against a HAL.' };
  }

  if (isSketch) {
    if (!/\bvoid\s+setup\s*\(\s*(?:void)?\s*\)/.test(code)) {
      return { valid: false, error: 'Arduino sketch is missing void setup().' };
    }
    if (!/\bvoid\s+loop\s*\(\s*(?:void)?\s*\)/.test(code)) {
      return { valid: false, error: 'Arduino sketch is missing void loop().' };
    }
    if (!/#include\s*[<"]Arduino\.h[>"]/.test(code)) {
      return { valid: false, error: 'Arduino sketch does not include <Arduino.h>.' };
    }
  }

  return { valid: true };
}

/**
 * Files this worker treats as hardware-as-code artifacts.
 *
 * Must stay in step with the routed validators in {@link validateCodeSyntax}
 * and with `RUNTIME_EXPECTED_EXTENSIONS` in `src/lib/fleetRegistry.js` — the
 * dashboard promises the operator a runtime contract, so an extension missing
 * here is a promise the worker cannot keep.
 */
export function isHardwareAsCodeFile(filePath: string): boolean {
  const lowered = filePath.toLowerCase();
  return (
    lowered.endsWith('.py') ||
    lowered.endsWith('.xml') ||
    lowered.endsWith('.mjcf') ||
    lowered.endsWith('.urdf') ||
    lowered.endsWith('.ino') ||
    lowered.endsWith('.cpp') ||
    lowered.endsWith('.cc') ||
    lowered.endsWith('.h') ||
    lowered.endsWith('.hpp') ||
    lowered.endsWith('.hh') ||
    lowered.endsWith('.usd') ||
    lowered.endsWith('.usda') ||
    lowered.endsWith('platformio.ini')
  );
}

/**
 * Routes a generated file to the right structural/AST validator.
 *
 * Returned errors are fed straight back into the one-shot LLM retry, so each
 * message has to name the exact defect.
 */
export function validateCodeSyntax(code: string, filePath: string): ValidationResult {
  const loweredPath = filePath.toLowerCase();
  const isPython = loweredPath.endsWith('.py');
  const isJS = /\.[jt]sx?$/.test(loweredPath);
  const isJSON = loweredPath.endsWith('.json');
  const isPlatformIoConfig = loweredPath.endsWith('platformio.ini');
  const isYamlOrToml = loweredPath.endsWith('.toml') || loweredPath.endsWith('.yaml') || loweredPath.endsWith('.yml') ||
    (loweredPath.endsWith('.ini') && !isPlatformIoConfig);
  const isPHP = loweredPath.endsWith('.php');
  // `.mjcf` and `.urdf` are unambiguous: those extensions only ever hold a
  // robotics model. `.xml` is not. The dashboard advertises `.xml` under both
  // `ROS 2 / Python` (launch files, `<launch>`) and `MuJoCo / URDF`, so routing
  // every `.xml` to the MuJoCo validator rejected every well-formed ROS 2
  // launch file with "missing the <mujoco> root element" — the operator saw a
  // green runtime/path hint, dispatched, and lost the LLM run in `[AST_CHECK]`.
  // Decide from the document, not the extension: a robotics root element means
  // it is a model, anything else is ordinary XML.
  const isMuJoCo = loweredPath.endsWith('.mjcf') ||
    loweredPath.endsWith('.urdf') ||
    (loweredPath.endsWith('.xml') && /<(mujoco|robot)\b/.test(code));
  const isUsda = loweredPath.endsWith('.usda');
  // `.hpp`/`.hh` were missing, so a C++ header with either spelling skipped the
  // include-guard gate entirely and fell through as "valid" no matter what.
  const isEmbeddedCpp = ['.cpp', '.h', '.hpp', '.hh', '.ino', '.cc'].some((ext) => loweredPath.endsWith(ext));

  if (isJS) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces) {
      return { valid: false, error: `Mismatched curly braces: ${openBraces} open vs ${closeBraces} close.` };
    }
    if (openParens !== closeParens) {
      return { valid: false, error: `Mismatched parentheses: ${openParens} open vs ${closeParens} close.` };
    }

    const backticks = (code.match(/`/g) || []).length;
    if (backticks % 2 !== 0) {
      return { valid: false, error: `Unclosed template literal (backticks).` };
    }

    if (code.match(/^\s*import\s+from\s+['"]/m)) {
      return { valid: false, error: `Broken import statement missing imported bindings.` };
    }
  } else if (isPython) {
    const hasTabs = /^\t+/m.test(code);
    const hasSpaces = /^ +/m.test(code);
    if (hasTabs && hasSpaces) {
      return { valid: false, error: 'Mixed indentation (tabs and spaces).' };
    }

    const blockDefs = code.match(/^(?:\s*)(?:def|class|if|elif|else|for|while|try|except|finally|with)\b.*$/gm);
    if (blockDefs) {
      for (const def of blockDefs) {
        const cleanDef = def.replace(/#.*$/, '').trim();
        if (!cleanDef.endsWith(':')) {
          return { valid: false, error: `Block definition missing colon: ${cleanDef}` };
        }
      }
    }

    const lookFreeCad = /^\s*(?:import|from)\s+(FreeCAD|Part|Sketcher|Draft|Mesh)\b/m.test(code);
    if (lookFreeCad) {
      const freeCadResult = validateFreeCadScript(code);
      if (!freeCadResult.valid) return freeCadResult;
    }
  } else if (isJSON) {
    try {
      JSON.parse(code);
    } catch (err: any) {
      return { valid: false, error: `Invalid JSON structure: ${err.message}` };
    }
  } else if (isPlatformIoConfig) {
    return validatePlatformIoConfig(code);
  } else if (isYamlOrToml) {
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;

    if (openBrackets !== closeBrackets || openBraces !== closeBraces) {
      return { valid: false, error: 'Malformed configuration file syntax (mismatched brackets or braces).' };
    }

    const doubleQuotes = (code.match(/(?<!\\)"/g) || []).length;
    const singleQuotes = (code.match(/(?<!\\)'/g) || []).length;
    if (doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0) {
      return { valid: false, error: 'Malformed configuration file syntax (unclosed quotes).' };
    }
  } else if (isPHP) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openBraces !== closeBraces) {
      return { valid: false, error: `Mismatched curly braces in PHP: ${openBraces} open vs ${closeBraces} close.` };
    }
    if (openParens !== closeParens) {
      return { valid: false, error: `Mismatched parentheses in PHP: ${openParens} open vs ${closeParens} close.` };
    }
    if (code.trim().length > 0 && !code.includes('<?php')) {
      return { valid: false, error: 'Missing opening <?php tag in PHP file.' };
    }
  } else if (isMuJoCo) {
    return validateMuJoCoModel(code, filePath);
  } else if (loweredPath.endsWith('.xml')) {
    // Ordinary XML (ROS 2 launch files, SDF fragments, package manifests).
    // Structural balance is the only claim this worker can honestly make
    // about it, and it is the same check the MuJoCo validator starts with.
    const balanceError = countXmlTagBalance(code);
    if (balanceError) return { valid: false, error: balanceError };
    if (!/<[A-Za-z_]/.test(code)) {
      return { valid: false, error: 'XML file declares no elements.' };
    }
  } else if (isUsda) {
    return validateUsdStage(code);
  } else if (isEmbeddedCpp) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openBraces !== closeBraces) {
      return { valid: false, error: `Mismatched curly braces in C++: ${openBraces} open vs ${closeBraces} close.` };
    }
    if (openParens !== closeParens) {
      return { valid: false, error: `Mismatched parentheses in C++: ${openParens} open vs ${closeParens} close.` };
    }
    return validatePlatformIoFirmware(code, filePath);
  }

  return { valid: true };
}


export function prepareContextWindow(content: string, threshold: number = 32000): { content: string, truncated: boolean } {
  if (content.length > threshold) {
    return {
      content: content.substring(0, threshold),
      truncated: true
    };
  }
  return {
    content: content,
    truncated: false
  };
}

export async function executeAutonomousCodingTask(task: any, env: Env, writer?: any): Promise<void> {
  const startTime = Date.now();

  const sendEvent = async (type: string, message: string) => {
    if (writer) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ type, message })}\n\n`)).catch(() => {});
    }
  };
  const taskId = task.taskId || `auto-${Date.now()}`;
  const resolved = resolveRepoMetadata(task.project_key || task.repository_name || task.repo);
  const owner = task.repository_owner || resolved.owner || 'JimEllars';
  const repo = task.repository_name || task.repo || resolved.repo || 'axim-core-v1.2';
  // Attempt to parse instructions for file path if not provided
  let path = task.target_file_paths ? task.target_file_paths[0] : task.target_file_path;
  if (!path) {
    const match = task.instructions?.match(/(?:in|at|on) `?([a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+)`?/);
    path = match ? match[1] : 'README.md';
  }
  const githubCtx = { owner, repo, path };

  let pipelineSucceeded = false;
  try {
    step_count++;
    console.log(`[AUTONOMOUS_CODER] Task ${taskId} started for ${path}`);
    await sendEvent('reasoning_step', JSON.stringify({ step: 1, title: '[INGRESS]', content: 'Transmitting payload to edge router and fetching current file state...', status: 'complete' }));
    const currentFile = await fetchCurrentFileState(githubCtx, env);
    const { content: contextContent, truncated } = prepareContextWindow(currentFile.content);
    await sendEvent('reasoning_step', JSON.stringify({ step: 2, title: '[BRAIN]', content: 'Injecting organizational context and fetching dependencies...', status: 'complete' }));
    const depsContext = await fetchRepositoryDependencies(githubCtx, env);

    let organizationalContext = "";
    if (task.contextIds && task.contextIds.length > 0) {
      const idsQuery = task.contextIds.map((id: any) => `"${id}"`).join(',');
      const knowledgeRes = await fetch(`${env.SUPABASE_URL}/rest/v1/knowledge_nodes?id=in.(${idsQuery})`, {
        headers: {
          'apikey': env.SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`
        }
      });
      if (knowledgeRes.ok) {
        const nodes: any = await knowledgeRes.json();
        organizationalContext = nodes.map((n: any) => `[Org Rule: ${n.title}] ${n.content}`).join('\n');
      }
    }

    const promptBody = `### Organizational Knowledge / Rules:\n${organizationalContext}\n\n### Task: ${task.title}\n\n### Instructions:\n${task.instructions}\n\n### Code:\n${contextContent}`;

    const active_model = (task.priority === 'high' || (task.instructions && (task.instructions.toLowerCase().includes('refactor') || task.instructions.toLowerCase().includes('security')))) ? 'claude-3-5' : 'deepseek-coder';
    await sendEvent('reasoning_step', JSON.stringify({ step: 3, title: '[ANALYSIS]', content: 'Generating patch via ' + active_model + '...', status: 'complete' }));
    const activeRuntime = task.runtime_env || task.context?.runtime_env || 'Node.js Edge';
    const { code: generatedCode, providerUsed } = await requestCognitiveCodeGeneration(
      contextContent,
      task.instructions,
      activeRuntime,
      depsContext,
      env,
      active_model
    );
    let modifiedCode = generatedCode;

    const currentLock = await env.TASK_LOCKS.get(`lock:${taskId}`);
    if (!currentLock) {
      await sendEvent('log', '[ABORT] Task lock evicted by administrator. Halting pipeline before Git commit.');
      throw new Error('Task was forcefully evicted. Pipeline aborted.');
    }

    await sendEvent('reasoning_step', JSON.stringify({ step: 4, title: '[AST_CHECK]', content: 'Validating structural syntax of the generated code...', status: 'complete' }));
    let syntaxCheck = validateCodeSyntax(modifiedCode, path);
    if (!syntaxCheck.valid) {
      console.warn(`[AUTONOMOUS_CODER] Syntax Error Detected: ${syntaxCheck.error}. Triggering 1-shot retry.`);
      const retryPrompt = `${task.instructions}\n\nThe generated code had a syntax error: ${syntaxCheck.error}\nPlease provide the fixed raw source code without markdown.`;
      const retryResult = await requestCognitiveCodeGeneration(
        contextContent,
        retryPrompt,
        activeRuntime,
        depsContext,
        env,
        active_model
      );
      modifiedCode = retryResult.code;
      // The retry gets the same gate: a second bad generation must not reach Git.
      syntaxCheck = validateCodeSyntax(modifiedCode, path);
      if (!syntaxCheck.valid) {
        throw new Error(`Generated code still fails structural validation after retry: ${syntaxCheck.error}`);
      }
    }

    // Dangerous-sink screening is a generation invariant, not an Asguard-only
    // courtesy: any origin can be handed a PHP file with eval()/exec() in it.
    await sendEvent('reasoning_step', JSON.stringify({ step: 4.5, title: '[SEC_SWEEP]', content: 'Executing pre-commit vulnerability sanitization...', status: 'complete' }));
    const secCheck = sanitizeVulnerabilityVectors(modifiedCode);
    if (!secCheck.safe) {
      console.warn(`[AUTONOMOUS_CODER] Security vulnerability detected in generated code: ${secCheck.error}`);
      throw new Error(`Pre-commit security validation failed: ${secCheck.error}`);
    }

    const branchName = `axim-bot/ticket-${taskId.substring(0,8)}`;
    await sendEvent('reasoning_step', JSON.stringify({ step: 5, title: '[PATCH_GEN]', content: 'Provisioning branch and committing generated patch...', status: 'complete' }));
    step_count++;
    await createTaskBranch(githubCtx, branchName, env);

    const commitMessage = `fix(auto-remediation): resolve task #${taskId} via coding lab`;
    const commitSha = await commitGeneratedCode(githubCtx, branchName, modifiedCode, currentFile.sha, commitMessage, env);

    const prTitle = `[AXiM Coder] ${task.title}`;
    let prBody = `## Autonomous Engineering Task: ${taskId}\n\n**Requested By:** ${task.requestedBy || 'System'}\n**Priority:** ${task.priority || 'Normal'}\n\n### Instructions\n${task.instructions}\n\n*Review diff and merge.*`;
    if (truncated) {
      prBody += `\n\n> ⚠️ **Notice:** The original file exceeded maximum context limits (32k tokens). The prompt context was automatically truncated before LLM generation. Please carefully review the patch for missing external dependencies.`;
    }
    const prUrl = await openPullRequest(githubCtx, branchName, prTitle, prBody, env);

    // Webhook Callbacks
    //
    // The Support System notification used to send `commit_sha: 'pending'` to
    // `/patch-status`, a route it does not publish: every run 404'd and the
    // notice was dropped. It now posts the real branch commit to
    // `/api/v1/tickets/callback` and parks itself in the DLQ if the relay
    // refuses it. Asguard has no coder-facing route yet; the dispatcher records
    // that as open interlock debt instead of posting at a 404.
    const patchReady = await dispatchCallbackWebhook('support', {
      ticketId: taskId,
      status: 'PATCH_READY',
      prUrl,
      commitSha,
      patchDetails: `Branch ${branchName} — ${path}`
    }, env);
    if (!patchReady.ok) {
      console.warn(`[AUTONOMOUS_CODER] patch-ready callback for ${taskId} not delivered:`, patchReady.error, patchReady.dlqKey ?? 'no-dlq-key');
    }

    console.log(`[AUTONOMOUS_CODER] Task ${taskId} PR opened at ${prUrl}`);
    // Remember the pull request and drop the run lease. The lease used to be
    // left to expire after an hour on success, which answered every Support
    // System retry with "already processing" even though nothing was running.
    await recordOpenPullRequest(env.TASK_LOCKS, taskId, prUrl);
    step_count++;
    tokens_consumed += 1500; // Approximated tokens
    exit_code = 0;
    await reportLabExecutionTelemetry(taskId, task.requestedBy || 'Autonomous', prUrl, env, undefined, undefined, activeRuntime, 'auto');
    pipelineSucceeded = true;

    const computeDurationMs = Date.now() - startTime;
    await reportGreenMachineTelemetry(
      taskId,
      providerUsed,
      task.repo || 'axim-core-v1.2',
      prUrl,
      1000, // prompt tokens
      500,  // completion tokens
      computeDurationMs,
      env
    );
  } catch (error: any) {
    throw error;
  } finally {
    if (!pipelineSucceeded) {
      await releaseTaskLock(env.TASK_LOCKS, taskId).catch(() => {});
    }
  }
}

export async function executeCodingPipeline(payload: any, env: Env, writer?: any, ctx?: any): Promise<void> {
    await executeAutonomousCodingTask(payload, env, writer);
}
