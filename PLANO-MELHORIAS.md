# Plano de Melhoria — Vértice Invest

> **Documento vivo.** Marque `[x]` ao concluir cada item e atualize o status da fase.
> Última atualização: 2026-05-31

## Como usar
- Cada item tem um ID estável (B1, M1, I1, S1, D1, T1, A1...). Referencie o ID nos commits (ex.: `fix(B1): tornar v2StartDate dinâmico`).
- Ordem recomendada de execução: **Fase 0 → 1 → 2 → 3 → 4 → 5** (ver "Sequenciamento" no fim).

## Progresso geral
| Categoria | Concluído | Total |
|---|---|---|
| Fase 0 — Segurança crítica | 3 | 5 |
| Bugs (B) | 0 | 12 |
| Melhorias/Refatorações (M) | 0 | 14 |
| Implementações (I) | 0 | 14 |
| Segurança (S) | 0 | 12 |
| Infra/DevOps (D) | 0 | 13 |
| Testes (T) | 0 | 12 |
| Acessibilidade/UX (A) | 0 | 12 |

---

## Context

O Vértice é uma plataforma de análise quantitativa financeira (Ações, FIIs, Cripto): monorepo React 18 + Vite (`/client`) e Node.js/Express + MongoDB (`/server`), com engines proprietárias de scoring/portfólio, integrações de mercado (Yahoo, Brapi, Fundamentus, BCB), IA (Gemini) e pagamentos (Mercado Pago).

Uma auditoria completa (backend, frontend, infra/segurança) revelou um MVP funcional com fundamentos sólidos (auth JWT, rate limiting, helmet, CORS, matemática financeira segura, FIFO/TWRR), mas **frágil para escalar**: segredos de produção expostos no histórico do git, ausência de CI/CD, lint e testes, componentes/engines monolíticos, e um bug de filtro por data.

**Decisões:** (1) Remediação de segredos é **prioridade #1** (rotação de TODAS as chaves + limpeza de histórico). (2) Abrangência completa. (3) Implementação item a item.

---

## FASE 0 — Remediação de Segurança Crítica (BLOQUEANTE)

Confirmado: `.env` foi removido do tracking (commit `e23da24`), **mas permanece em 6 commits do histórico** com segredos vivos.

- [ ] **F0.1 — Rotacionar TODAS as chaves comprometidas** (antes de limpar histórico; assumir vazamento total):
  - [x] `JWT_SECRET` e `JWT_REFRESH_SECRET` — gerados novos e aplicados ao `.env` local (⚠️ replicar no ambiente de produção; invalida sessões/força re-login)
  - [ ] `MONGO_URI` — resetar senha de `contatoverticeinvest_db_user` no Atlas (idealmente novo user com escopo mínimo) — **ação no painel Atlas (usuário)**
  - [ ] `API_KEY` (Gemini), `BRAPI_TOKEN`, `SENTRY_DSN` — **regenerar nos painéis (usuário)**
  - [ ] `MP_ACCESS_TOKEN` + `MP_WEBHOOK_SECRET` (Mercado Pago — produção financeira, urgente) — **painel MP (usuário)**
  - [ ] `SMTP_*` — **provedor de email (usuário)**
- [ ] **F0.2 — Limpar histórico do git** (`.env` está em 6 commits). filter-repo/BFG indisponíveis (sem Python/Java); usar `git filter-branch` nativo + `git push --force`. **Operação destrutiva — aguardando confirmação do método.**
- [x] **F0.3 — Criar `.env.example`** com todas as chaves vazias/descritas
- [x] **F0.4 — Secret scanning** — `.gitleaks.toml` + workflow CI `.github/workflows/secret-scan.yml` + pre-commit husky (`.husky/pre-commit`) que bloqueia `.env` e roda gitleaks se instalado
- [x] **F0.5 — `.gitignore`** reforçado: `.env`, `.env.*` ignorados, `!.env.example` rastreável

> Nenhum trabalho de feature deve começar antes de F0.1 e F0.2 concluídos.

---

## CATEGORIA 1 — Correções de Bugs

- [ ] **B1** — `v2StartDate` fixo em `'2026-05-09'` quebra filtro de sinais → tornar dinâmico (config/relativo) · `server/controllers/researchController.js:202`
- [ ] **B2** — `failCount` sem teto pode blacklistar errado → `Math.min(999, (failCount||0)+1)` + validação de tipo · `server/services/marketDataService.js:~145`
- [ ] **B3** — Câmbio USD/BRL histórico usa snapshot atual → P&L histórico incorreto; buscar câmbio por data · `server/services/financialService.js:~150`
- [ ] **B4** — Limite JSON 10KB rejeita exportações de ranking grandes → aumentar limite na rota ou paginar · `server/app.js:~60`
- [ ] **B5** — `resolvePapel`/`isPapelFII` por substring frágil → garantir `fiiSubType` na ingestão · `server/services/engines/scoringEngine.js:~152`
- [ ] **B6** — SSL desabilitado (`rejectUnauthorized:false`) no fallback macro → HTTPS com timeout · `server/services/macroDataService.js:~122`
- [ ] **B7** — `catch {}` silenciosos engolem erros → logar motivo em cada camada · `macroDataService.js:~55`, `fundamentusService.js:~140`
- [ ] **B8** — Email regex permissivo aceita inválidos → regex estrito + Zod · `server/models/User.js:~19`
- [ ] **B9** — Mutações de carteira sem feedback → adicionar toasts sucesso/erro · `client/src/pages/Wallet.tsx`
- [ ] **B10** — `refreshProfile()` engole erro → expor estado de erro; retry/logout controlado · `client/src/contexts/AuthContext.tsx:51-53`
- [ ] **B11** — Dois entrypoints (`server.js` vs `index.js`) → consolidar; remover morto · `server/server.js`, `server/index.js`
- [ ] **B12** — Threshold Fundamentus (`dataMap.size < 100`) só fora de teste → aplicar sempre + alertar · `server/services/fundamentusService.js:~145`

---

## CATEGORIA 2 — Melhorias / Refatorações

- [ ] **M1** — Quebrar `calculateProfileScores()` (368 linhas) em helpers puros por perfil + penalidades reutilizáveis · `scoringEngine.js:169-552`
- [ ] **M2** — Extrair `ExplainableAIRenderer` para componente próprio + memoização · `client/src/pages/Research.tsx:228-319`
- [ ] **M3** — Decompor `AddAssetModal` (791 linhas) em `useAssetForm`/`usePriceFetch`/`useAssetValidation` + subcomponentes
- [ ] **M4** — Criar hook `useFeatureAccess(feature, minPlan)` e eliminar gating duplicado · `Research.tsx`, `Wallet.tsx`, `AssetTable.tsx`
- [ ] **M5** — Extrair cálculo de KPIs para `utils/kpiCalculations.ts` · `client/src/contexts/WalletContext.tsx:172-222`
- [ ] **M6** — `React.memo` em gráficos Recharts e modais pesados · `EvolutionChart`, `PerformanceChart`, `AssetDetailModal`
- [ ] **M7** — `Promise.allSettled` no fetch de research (resiliência) · `client/src/hooks/useDashboardData.ts:~109`
- [ ] **M8** — Centralizar `staleTime`/`gcTime`/retry do React Query em config único
- [ ] **M9** — Mover hardcoded p/ `SystemConfig`/env: `BUY_THRESHOLD=70`, `MAX_CRYPTO_PER_PROFILE`, `CACHE_DURATION`, CDI `11.25`, listas de setores/tickers
- [ ] **M10** — Substituir ~280 `console.log` por `logger` estruturado (JSON) com contexto · `server/**`
- [ ] **M11** — Biblioteca base de UI: `Modal`, `Skeleton`, `Alert`, `Tooltip` · `client/src/components/ui/`
- [ ] **M12** — Consolidar tokens de cor/tipografia (3 tons de "card" divergentes) · `tailwind.config.js`, `index.css`
- [ ] **M13** — Limpar `package.json` raiz de ~30 deps extraviadas (lodash, rxjs, date-fns...) · `/package.json`
- [ ] **M14** — Índices Mongo faltantes: `lastFundamentalsDate`, `fiiSubType`, `(sector,type)`, `(user,date)` · `server/models/*.js`

---

## CATEGORIA 3 — Implementações / Novas Features

- [ ] **I1** — Error Boundary global + por página, integrado ao Sentry · `client/src/App.tsx`, `components/ErrorBoundary.tsx`
- [ ] **I2** — Health check `/api/health` (Mongo, cache, dependências) · `server/routes`, `server/app.js`
- [ ] **I3** — Cache Redis para market data + macro (TTL alinhado ao fechamento) · `marketDataService.js`, `macroDataService.js`
- [ ] **I4** — Circuit breaker + retry/backoff para integrações externas · `server/services/*`
- [ ] **I5** — Rate limiting por usuário em rotas caras (`/research/*`, `/wallet/*`) · `server/app.js`, middleware
- [ ] **I6** — Cache do plano/assinatura (TTL 5–10min) em vez de hit no DB por request · `server/middleware/authMiddleware.js`
- [ ] **I7** — OpenAPI/Swagger documentando endpoints `/api`
- [ ] **I8** — Lazy-load das abas da Wallet via `React.lazy` · `client/src/pages/Wallet.tsx`
- [ ] **I9** — Validação Zod centralizada em todas as rotas de escrita + sanitização · `validateResource.js`, `schemas/`
- [ ] **I10** — Validação de assinatura de webhook MP com `MP_WEBHOOK_SECRET` · `server/routes/webhookRoutes.js`
- [ ] **I11** — Transações atômicas (`mongoose.session`) nas mutações de carteira · `server/controllers/walletController.js`
- [ ] **I12** — Skeleton screens padronizados + estados erro/loading granulares por query
- [ ] **I13** — Painel admin de configuração (editar `SystemConfig` sem deploy) — depende de M9
- [ ] **I14** — MFA/2FA opcional (TOTP) · `authController.js`, models

---

## CATEGORIA 4 — Segurança

- [ ] **S1** — 🔴 Rotação de segredos + limpeza de histórico (= Fase 0)
- [ ] **S2** — 🔴 `.env.example` + secret scanning (gitleaks) no pre-commit e CI
- [ ] **S3** — 🟠 Validação de assinatura webhook Mercado Pago (= I10) · `webhookRoutes.js`
- [ ] **S4** — 🟠 Auditar TODAS as rotas admin p/ garantir `requireAdmin` · `server/routes/*`
- [ ] **S5** — 🟠 Invalidar `RefreshToken` no logout (garantir delete no DB) · `authController.js`
- [ ] **S6** — 🟡 Requisitos de senha mais fortes (caractere especial, senhas comuns) · `authController.js:~66` + Zod
- [ ] **S7** — 🟡 Proteção CSRF + cookies `SameSite=Strict` · `server/app.js`, helmet
- [ ] **S8** — 🟡 Sanitização anti-injeção NoSQL/XSS além do Mongoose
- [ ] **S9** — 🟡 Não logar PII em claro (email no downgrade de plano) · `authMiddleware.js:~30`
- [ ] **S10** — 🟡 Pin do `@google/genai` (hoje `*`) e upgrade `axios ^1.7` · `server/package.json`
- [ ] **S11** — 🟠 Criptografia em repouso (Atlas) + revisão LGPD de dados enviados ao Gemini
- [ ] **S12** — 🟡 Dependabot/`npm audit` automatizado no CI

---

## CATEGORIA 5 — Infraestrutura / DevOps

- [ ] **D1** — CI GitHub Actions: lint + typecheck + test + build em cada PR · `.github/workflows/ci.yml`
- [ ] **D2** — ESLint (client + server) com regras compartilhadas · `eslint.config.js`
- [ ] **D3** — Prettier + formatação consistente · `.prettierrc`
- [ ] **D4** — TypeScript strict no client + resolver 9 `@ts-ignore` (tipos React Router) · `client/tsconfig.json`
- [ ] **D5** — Husky + lint-staged (pre-commit: lint, format, secret scan) · `.husky/`
- [ ] **D6** — Dockerfile (server) + docker-compose (server+mongo)
- [ ] **D7** — Cobertura de testes no Vitest com gate mínimo (~70% em utils financeiros) · `vitest.config.ts`
- [ ] **D8** — Conventional Commits + commitlint
- [ ] **D9** — Branch protection no `main` (PR + CI verde)
- [ ] **D10** — Script de build do server + `build:all` no raiz · `/package.json`
- [ ] **D11** — Sourcemaps de produção (upload p/ Sentry, não público) · `client/vite.config.ts`
- [ ] **D12** — Logging estruturado JSON + correlation IDs (`x-request-id`) · `server/config/logger.js`
- [ ] **D13** — Investigar bundle/`dist` de 16MB do client

---

## CATEGORIA 6 — Testes

Hoje: ~4 specs no backend e **1 teste no frontend** para 67 componentes.

- [ ] **T1** — Unit dos helpers do scoringEngine (Graham/Bazin/PEG, confidence, gates)
- [ ] **T2** — Unit do draft competitivo + penalidades (vazio, todos rejeitados, caps de setor) · `portfolioEngine.js`
- [ ] **T3** — Unit dos sinais (RSI/Volume/Suporte, correlações) · `signalEngine.js`
- [ ] **T4** — Service tests: `marketDataService` (cache, blacklist, fallback)
- [ ] **T5** — Service tests: `fundamentusService` (parsing, cálculos reversos, validação)
- [ ] **T6** — Service tests: `aiResearchService` (orquestração, delta) com mocks
- [ ] **T7** — Integração: auth → ranking → portfólio end-to-end · `server/tests/integration`
- [ ] **T8** — Edge cases financeiros: FIFO (venda > posição), dividendo 0/negativo, data futura
- [ ] **T9** — Hook tests: `useDashboardData`, `useWallet`
- [ ] **T10** — Component tests: `Wallet`, `Research`, `AddAssetModal`
- [ ] **T11** — Context tests: `AuthContext`, `WalletContext` (mutations + demo mode)
- [ ] **T12** — E2E (Playwright): login → adicionar ativo → research → gating de plano · `e2e/`

---

## CATEGORIA 7 — Acessibilidade / UX

- [ ] **A1** — `aria-label`/descrições em gráficos Recharts · `EvolutionChart`, `PerformanceChart`, `AllocationChart`
- [ ] **A2** — `scope` em headers de tabela + associação linha↔header · `AssetTable.tsx`
- [ ] **A3** — Focus trap + tecla `Escape` em todos os modais (via `Modal` base — M11)
- [ ] **A4** — `aria-labelledby` no título dos modais · `AssetDetailModal`, `AddAssetModal`
- [ ] **A5** — Live region (`aria-live`) p/ erros de validação · `AddAssetModal`, `Input`
- [ ] **A6** — Hierarquia semântica de headings nos cards de KPI · `EquitySummary.tsx`
- [ ] **A7** — HTML semântico (`section`/`article`/`aside`) no lugar de `div` genérica
- [ ] **A8** — Auditoria de contraste WCAG AA (slate-600 sobre `#080C14`, badges)
- [ ] **A9** — Gestão de foco ao abrir/fechar modal e no toggle de senha · `Input.tsx`
- [ ] **A10** — Navegação por teclado em dropdowns (setas) + ordem de tab explícita
- [ ] **A11** — Estados de erro visíveis (substituir `catch` silenciosos por toast/Alert)
- [ ] **A12** — Documentação README + CONTRIBUTING + ARCHITECTURE · raiz

---

## Sequenciamento (Fases)

- **Fase 0 — Segurança crítica (bloqueante):** F0.1–F0.5 (S1, S2)
- **Fase 1 — Estabilização:** B1–B12, I1, I2, I10/S3, S4, S5
- **Fase 2 — Fundação de qualidade:** D1–D5, D7, D8, T1–T3
- **Fase 3 — Refatoração:** M1–M14, T4–T11
- **Fase 4 — Evolução:** I3–I9, I11–I14, D6, D9–D13
- **Fase 5 — Polimento:** A1–A12, T12

---

## Verificação (por fase)

- **Fase 0:** `git log --all -- .env` vazio após `filter-repo`; app sobe com chaves novas; `gitleaks detect` limpo.
- **Bugs:** teste de regressão por bug; `npm test` no `/server` verde.
- **CI/Lint:** PR de teste roda lint + typecheck + test + build e bloqueia em falha.
- **Refatorações:** cobertura ≥70% nos módulos; snapshot do ranking antes/depois para garantir paridade.
- **Features:** `/api/health` 200 com status; webhook MP rejeita assinatura inválida; abas da Wallet sob demanda.
- **A11y:** axe-core/Lighthouse nas páginas principais; navegação 100% por teclado nos modais.
- **E2E:** suíte Playwright verde no fluxo completo.
