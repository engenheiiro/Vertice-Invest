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
    // Worktrees de agente são CHECKOUTS separados do próprio repo: lintá-los
    // duplica cada arquivo e afoga o relatório (1300+ erros de um código que
    // nem está nesta árvore), deixando `npm run lint` sem serventia.
    '.claude/**',
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
    // Cada contexto exporta o Provider (componente) e o hook de consumo no mesmo
    // arquivo — idioma adotado em todo o app. Separar os hooks em módulos próprios
    // só para agradar o Fast Refresh custaria ~157 arquivos de import reescritos
    // por um ganho exclusivo de DX (recarregar a página em vez de preservar
    // estado ao editar o contexto). Em vez de desligar a regra, nomeamos os
    // exports legítimos: qualquer OUTRO export não-componente segue avisando.
    'react-refresh/only-export-components': ['warn', {
      allowConstantExport: true,
      allowExportNames: [
        'useAuth', 'useWallet', 'useTheme', 'useToast', 'useDemo', 'useConfirm',
        'DEFAULT_SUB_ALLOCATION',
      ],
    }],
    // Pragmático para a base existente:
    '@typescript-eslint/no-explicit-any': 'off',
    // ignoreRestSiblings: `const { password, ...safeUser } = user` é como o código
    // DESCARTA campo sensível antes de devolver ao cliente. O nome citado ali existe
    // justamente para não ser usado — avisar sobre ele empurraria para um `_password`
    // que não descarta nada, ou pior, para apagar a linha e vazar o campo.
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
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
    // ignoreRestSiblings: ver a nota no bloco do client — mesmo idioma de descarte
    // (`const { correctOptionIndex, ...rest } = q` antes de mandar o quiz ao aluno).
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
}, // --- Scripts de build do client (Node ESM, fora de src) ---
{
  files: ['client/build-assets/**/*.{js,mjs}'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.node },
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
