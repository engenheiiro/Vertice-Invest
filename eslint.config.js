// ESLint flat config (v9) — monorepo Vértice (client TS/React + server Node ESM).
// Filosofia: erros apenas para bugs reais (rules-of-hooks, no-undef, etc.);
// estilo/qualidade como 'warn' para não inundar o código legado.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(// --- Ignorados globais ---
{
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/dev-dist/**',
    '**/build/**',
    '.backups/**',
    'server/logs/**',
    'coverage/**',
    '**/*.config.{js,ts,cjs,mjs}',
    '.husky/**',
  ],
}, // --- Base JS recomendada (todos os arquivos) ---
js.configs.recommended, // --- Client: TypeScript + React ---
{
  files: ['client/src/**/*.{ts,tsx}'],
  extends: [...tseslint.configs.recommended],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.browser },
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
  },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // Pragmático para a base existente:
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
}, // --- Server: Node ESM (JS) ---
{
  files: ['server/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.node },
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
}, // --- E2E (Playwright, TypeScript fora de client/src) ---
{
  files: ['client/e2e/**/*.ts'],
  extends: [...tseslint.configs.recommended],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.node },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, // --- Testes (Vitest) ---
{
  files: ['**/*.{test,spec}.{js,ts,tsx}', 'server/tests/**/*.js'],
  languageOptions: {
    globals: {
      ...globals.node,
      describe: 'readonly',
      it: 'readonly',
      test: 'readonly',
      expect: 'readonly',
      vi: 'readonly',
      beforeEach: 'readonly',
      afterEach: 'readonly',
      beforeAll: 'readonly',
      afterAll: 'readonly',
    },
  },
}, // --- Desliga regras de estilo que conflitam com o Prettier (por último) ---
prettier);
