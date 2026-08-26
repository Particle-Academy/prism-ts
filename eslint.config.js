import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.parity/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The conformance runner and the agent are plain ESM running on Node, not
    // bundled source — they get Node's globals, which the library never should.
    files: ['conformance/**/*.mjs', 'agent/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
);
