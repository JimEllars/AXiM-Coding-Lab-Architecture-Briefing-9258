import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        React: true,
        JSX: true
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        sourceType: 'module'
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'no-undef': 'error', 
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
      'no-unused-vars': 'off',
      'no-case-declarations': 'off',
      'no-useless-catch': 'off',
      // Sprint 1.6 shipped two components (PromptTerminal, Telemetry) that read a
      // `const` in its temporal dead zone from an effect dependency array, which
      // throws on the first render and blanks the page. `vite build` and
      // `vitest` both accept it, so this rule is the static half of the guard —
      // `src/components/render-smoke.test.jsx` is the runtime half.
      // `functions: false` keeps the usual hoisted-helper pattern legal.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true, allowNamedExports: false }]
    },
  }
];