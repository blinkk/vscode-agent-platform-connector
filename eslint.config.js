// @ts-check
import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {...globals.node},
    },
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow intentionally-unused bindings prefixed with `_`, e.g. when
      // destructuring to omit a property via the rest spread.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Keep ESLint and Prettier in sync: report formatting as lint errors and
  // disable any stylistic rules that would conflict with Prettier. Must be
  // last so it wins over earlier configs.
  prettierRecommended,
);
