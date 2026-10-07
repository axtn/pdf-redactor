import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Disable formatting rules before applying our non-conflicting correctness rules.
  prettier,
  {
    rules: {
      curly: ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: ['directive', 'import', 'function', 'class', 'block-like', 'export'],
          next: '*',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: ['function', 'class', 'block-like', 'export', 'return', 'throw'],
        },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: 'multiline-expression', next: '*' },
        { blankLine: 'always', prev: '*', next: 'multiline-expression' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'any', prev: 'directive', next: 'directive' },
      ],
      'lines-around-comment': [
        'error',
        {
          beforeBlockComment: true,
          beforeLineComment: true,
          allowBlockStart: true,
          allowClassStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    'pdf-assets/**',
    'public/licenses/**',
    'public/pdfjs/**',
    'public/mupdf/**',
    '.next/**',
    '.next-test/**',
    'out/**',
    '.wrangler/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
]);
