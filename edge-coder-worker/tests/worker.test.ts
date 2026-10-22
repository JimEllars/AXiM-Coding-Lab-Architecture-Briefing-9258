import { expect, test, describe } from 'vitest';
import { validateCodeSyntax, sanitizeVulnerabilityVectors } from '../src/code_generator';

describe('Worker Tests', () => {
  describe('PHP Code Validation', () => {
    test('Validates matching braces in PHP', () => {
      const validPhp = '<?php function hello() { return true; }';
      const result = validateCodeSyntax(validPhp, 'test.php');
      expect(result.valid).toBe(true);
    });

    test('Catches missing <?php tag in PHP', () => {
      const invalidPhp = 'function hello() { return true; }';
      const result = validateCodeSyntax(invalidPhp, 'test.php');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing opening <?php tag');
    });

    test('Catches mismatched braces in PHP', () => {
      const invalidPhp = '<?php function hello() { return true; ';
      const result = validateCodeSyntax(invalidPhp, 'test.php');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Mismatched curly braces in PHP');
    });
  });

  describe('PHP Sanitization', () => {
    test('Detects shell_exec', () => {
      const maliciousPhp = '<?php shell_exec("ls -la");';
      const result = sanitizeVulnerabilityVectors(maliciousPhp);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('Detected potential PHP command injection');
    });

    test('Detects eval', () => {
      const maliciousPhp = '<?php eval($_POST["code"]);';
      const result = sanitizeVulnerabilityVectors(maliciousPhp);
      expect(result.safe).toBe(false);
    });

    test('Detects insecure superglobal concatenation', () => {
      const maliciousPhp = '<?php echo $_GET["name"] . " Hello";';
      const result = sanitizeVulnerabilityVectors(maliciousPhp);
      expect(result.safe).toBe(false);
    });

    test('Passes safe PHP', () => {
      const safePhp = '<?php echo "Hello World";';
      const result = sanitizeVulnerabilityVectors(safePhp);
      expect(result.safe).toBe(true);
    });
  });
});
