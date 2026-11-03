import { expect, test, describe } from 'vitest';
import { validateCodeSyntax, sanitizeVulnerabilityVectors, cleanSanitizedCodeBlob } from '../src/code_generator';

describe('PHP code validation', () => {
  test('accepts balanced PHP with an opening tag', () => {
    const result = validateCodeSyntax('<?php function hello() { return true; }', 'test.php');
    expect(result.valid).toBe(true);
  });

  test('rejects PHP with no opening tag', () => {
    const result = validateCodeSyntax('function hello() { return true; }', 'test.php');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing opening <?php tag');
  });

  test('rejects mismatched braces in PHP', () => {
    const result = validateCodeSyntax('<?php function hello() { return true; ', 'test.php');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Mismatched curly braces in PHP');
  });

  test('rejects mismatched parentheses in PHP', () => {
    const result = validateCodeSyntax('<?php echo htmlspecialchars($_GET["name"]; ', 'test.php');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Mismatched parentheses in PHP');
  });
});

describe('PHP dangerous-sink sanitization', () => {
  test('detects shell_exec', () => {
    const result = sanitizeVulnerabilityVectors('<?php shell_exec("ls -la");');
    expect(result.safe).toBe(false);
    expect(result.error).toContain('Detected potential PHP command injection');
  });

  test('detects eval', () => {
    const result = sanitizeVulnerabilityVectors('<?php eval($_POST["code"]);');
    expect(result.safe).toBe(false);
  });

  test('detects system, passthru and proc_open', () => {
    for (const sink of ['system', 'passthru', 'proc_open', 'popen', 'assert']) {
      const result = sanitizeVulnerabilityVectors(`<?php ${sink}($_GET['cmd']);`);
      expect(result.safe, `${sink} should be rejected`).toBe(false);
    }
  });

  test('detects unescaped superglobal concatenation', () => {
    const result = sanitizeVulnerabilityVectors('<?php echo $_GET["name"] . " Hello";');
    expect(result.safe).toBe(false);
  });

  test('detects SQL string concatenation', () => {
    const result = sanitizeVulnerabilityVectors('<?php $q = "SELECT * FROM users WHERE id = " + $id;');
    expect(result.safe).toBe(false);
  });

  test('detects ungrounded robotics motor overrides and infinite loops', () => {
    expect(sanitizeVulnerabilityVectors('#include <Arduino.h>\nvoid loop() { while (true) { } }').safe).toBe(false);
    expect(sanitizeVulnerabilityVectors('force_override(motor);').safe).toBe(false);
  });

  test('passes safe PHP', () => {
    const result = sanitizeVulnerabilityVectors('<?php echo htmlspecialchars($name, ENT_QUOTES);');
    expect(result.safe).toBe(true);
  });

  // The sink list above only covers direct execution, and the superglobal rule
  // only fires on concatenation. A web shell needs neither.
  test('detects request-driven file inclusion (LFI/RFI)', () => {
    expect(sanitizeVulnerabilityVectors("<?php include $_GET['f']; ?>").safe).toBe(false);
    expect(sanitizeVulnerabilityVectors('<?php require_once($_POST["tpl"]); ?>').safe).toBe(false);
  });

  test('detects dynamic dispatch and deserialization sinks next to request input', () => {
    expect(sanitizeVulnerabilityVectors("<?php call_user_func($_GET['cb'], 1); ?>").safe).toBe(false);
    expect(sanitizeVulnerabilityVectors("<?php $o = unserialize($_COOKIE['session']); ?>").safe).toBe(false);
    expect(sanitizeVulnerabilityVectors('<?php extract($_POST); ?>').safe).toBe(false);
  });

  test('detects backtick shell execution and variable-variable indirection', () => {
    expect(sanitizeVulnerabilityVectors('<?php $out = `id`; echo $_GET[\'x\']; ?>').safe).toBe(false);
    expect(sanitizeVulnerabilityVectors('<?php $$name = $_POST[\'v\']; ?>').safe).toBe(false);
  });

  test('leaves ordinary PHP that merely reads a superglobal alone', () => {
    expect(sanitizeVulnerabilityVectors('<?php echo htmlspecialchars($_GET["q"], ENT_QUOTES); ?>').safe).toBe(true);
    expect(sanitizeVulnerabilityVectors('<?php $rows = $db->query("SELECT * FROM t"); ?>').safe).toBe(true);
  });

  test('backticks in JavaScript template literals are not a PHP shell', () => {
    expect(sanitizeVulnerabilityVectors('const label = `total: ${count}`;').safe).toBe(true);
  });
});

describe('JavaScript and JSON validation', () => {
  test('accepts balanced JavaScript', () => {
    expect(validateCodeSyntax('export const add = (a, b) => a + b;', 'src/math.js').valid).toBe(true);
  });

  test('rejects unbalanced template literals', () => {
    const result = validateCodeSyntax('const x = `unclosed;', 'src/x.js');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unclosed template literal');
  });

  test('accepts TypeScript with a balanced JSX component', () => {
    const code = 'export function Badge({ label }: { label: string }) {\n  return <span className="badge">{label}</span>;\n}\n';
    expect(validateCodeSyntax(code, 'src/Badge.tsx').valid).toBe(true);
  });

  test('rejects invalid JSON', () => {
    const result = validateCodeSyntax('{ "a": 1, }', 'config.json');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid JSON structure');
  });
});

describe('Markdown fence cleanup', () => {
  test('strips a fenced block', () => {
    const raw = '```ts\nconst a = 1;\n```';
    expect(cleanSanitizedCodeBlob(raw)).toBe('const a = 1;');
  });

  test('strips a leading fence with no closing fence', () => {
    expect(cleanSanitizedCodeBlob('```python\nimport Part\n')).toBe('import Part');
  });

  test('leaves bare source untouched', () => {
    expect(cleanSanitizedCodeBlob('  const a = 1;  ')).toBe('const a = 1;');
  });
});
