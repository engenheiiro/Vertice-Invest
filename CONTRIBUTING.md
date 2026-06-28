# Contribuindo com o Vértice

Guia rápido de desenvolvimento. Para a visão de arquitetura, veja [`ARCHITECTURE.md`](ARCHITECTURE.md); para o mapa detalhado de "onde mexer", [`CLAUDE.md`](CLAUDE.md).

---

## Fluxo de trabalho

1. Crie um branch a partir de `main`.
2. Faça as mudanças com testes.
3. `npm run lint` e `npm test` devem passar localmente.
4. Abra um PR — o CI (lint → typecheck → testes → build) precisa estar verde.

O `main` é protegido: mudanças entram via PR com CI verde.

---

## Convenções de código

- **Backend é ES Modules.** Use `import`/`export`, **nunca** `require()`.
- **Matemática financeira:** sempre use os helpers de `server/utils/mathUtils.js` (`safeFloat`, `safeAdd`, `safeDiv`, ...). Nunca opere floats crus em valores monetários.
- **Segredos:** nunca hardcode; use `process.env`. O `.env` é gitignored e o pre-commit bloqueia segredos.
- **Logs:** use o `logger` (Winston) de `server/config/logger.js`, não `console.log`. Toda linha já é carimbada com o correlation id da requisição.
- **Frontend:** Tailwind primeiro (evite CSS custom); hooks no topo do componente, guards (`if (!data) return null`) só depois de todos os hooks; primitivos de UI em `client/src/components/ui/`.
- **Validação de entrada:** rotas de escrita usam schemas Zod (`server/schemas/`) via o middleware `validate`.

---

## Commits (Conventional Commits)

O `commit-msg` valida via commitlint. Formato:

```
<tipo>(<escopo>): <resumo no imperativo>

<corpo opcional, linhas < 100 chars>
```

Tipos comuns: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`, `build`.

Exemplo:
```
feat(wallet): adiciona filtro por setor na carteira
```

---

## Hooks de git (Husky)

- **pre-commit:** bloqueia `.env`, roda secret-scan (gitleaks, se instalado) e `lint-staged` (ESLint `--fix` nos arquivos staged).
- **commit-msg:** valida o formato Conventional Commits.

Se o ambiente não expõe `bash`/`npx` ao hook (ex.: GitHub Desktop no Windows), o lint é pulado com aviso — o CI roda o ESLint completo de qualquer forma.

---

## Testes

- Framework: **Vitest** (instalado separadamente em `client/` e `server/`).
- Backend: specs em `server/tests/*.spec.js`. O conjunto determinístico do CI está em `server/package.json` → `test:ci`. **Ao adicionar um spec novo, inclua-o no `test:ci`.**
- Frontend: `*.test.tsx` ao lado dos componentes, com Testing Library.
- Refatorações de engine devem provar paridade (snapshot do ranking antes/depois).

```bash
npm run test:server
npm run test:client
```

---

## Checklist de PR

Antes de abrir/marcar o PR como pronto, confira:

- [ ] `npm run lint` (root) sem erros.
- [ ] `npm run typecheck` (client + server) sem erros.
- [ ] `npm run test:server` e `npm run test:client` verdes.
- [ ] Specs novos incluídos no `test:ci` (`server/package.json`), se aplicável.
- [ ] Nenhum `console.log`/segredo hardcoded; logs via `logger` (Winston).
- [ ] Valores monetários usam `mathUtils.js` (`safeFloat`/`safeAdd`/...), nunca float cru.
- [ ] Rotas de escrita novas validam entrada com Zod (`validate`) e usam o rate limiter correto (`server/middleware/rateLimiters.js`).
- [ ] Mudanças em engine (scoring/portfolio/signal) preservam as regras invioláveis de [`CLAUDE.md`](CLAUDE.md) — threshold global, ordenação soberana, um perfil por ativo.
- [ ] Mensagens de commit seguem Conventional Commits (validado pelo `commit-msg` hook).
- [ ] CI (lint → typecheck → testes → build) verde no PR.
- [ ] Para mudanças visuais: testado nos dois temas (light/dark) e responsivo (mobile).

---

## Regras de negócio invioláveis

Antes de mexer nas engines (`server/services/engines/`), revise as regras em [`CLAUDE.md`](CLAUDE.md) — ex.: threshold global de compra (score ≥ 70), ordenação soberana por score com desempate por composite estrutural, e um único perfil de risco por ativo no ranking.
