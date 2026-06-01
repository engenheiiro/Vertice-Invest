# Plano de Melhoria — Vértice Invest

> **Documento vivo.** Marque `[x]` ao concluir cada item e atualize o status da fase.
> Última atualização: 2026-05-31

## Como usar
- Cada item tem um ID estável (B1, M1, I1, S1, D1, T1, A1...). Referencie o ID nos commits (ex.: `fix(B1): tornar v2StartDate dinâmico`).
- Ordem recomendada de execução: **Fase 0 → 1 → 2 → 3 → 4 → 5** (ver "Sequenciamento" no fim).

## Progresso geral
| Categoria | Concluído | Total |
|---|---|---|
| Fase 0 — Segurança crítica | 5 | 5 ✅ |
| Bugs (B) | 12 | 12 ✅ |
| Melhorias/Refatorações (M) | 14 | 14 ✅ |
| Implementações (I) | 14 | 14 ✅ |
| Segurança (S) | 12 | 12 ✅ |
| Infra/DevOps (D) | 7 | 13 |
| Testes (T) | 11 | 12 |
| Acessibilidade/UX (A) | 0 | 12 |

---

## Context

O Vértice é uma plataforma de análise quantitativa financeira (Ações, FIIs, Cripto): monorepo React 18 + Vite (`/client`) e Node.js/Express + MongoDB (`/server`), com engines proprietárias de scoring/portfólio, integrações de mercado (Yahoo, Brapi, Fundamentus, BCB), IA (Gemini) e pagamentos (Mercado Pago).

Uma auditoria completa (backend, frontend, infra/segurança) revelou um MVP funcional com fundamentos sólidos (auth JWT, rate limiting, helmet, CORS, matemática financeira segura, FIFO/TWRR), mas **frágil para escalar**: segredos de produção expostos no histórico do git, ausência de CI/CD, lint e testes, componentes/engines monolíticos, e um bug de filtro por data.

**Decisões:** (1) Remediação de segredos é **prioridade #1** (rotação de TODAS as chaves + limpeza de histórico). (2) Abrangência completa. (3) Implementação item a item.

---

## FASE 0 — Remediação de Segurança Crítica (BLOQUEANTE)

Confirmado: `.env` foi removido do tracking (commit `e23da24`), **mas permanece em 6 commits do histórico** com segredos vivos.

- [x] **F0.1 — Rotacionar TODAS as chaves comprometidas** — ✅ **concluído pelo usuário** (rotação confirmada nos painéis em 2026-05-31):
  - [x] `JWT_SECRET` e `JWT_REFRESH_SECRET` — gerados novos e aplicados
  - [x] `MONGO_URI` — credenciais rotacionadas no Atlas
  - [x] `API_KEY` (Gemini), `BRAPI_TOKEN`, `SENTRY_DSN` — regenerados nos painéis
  - [x] `MP_ACCESS_TOKEN` + `MP_WEBHOOK_SECRET` — rotacionados no Mercado Pago
  - [x] `SMTP_*` — rotacionados no provedor de email
- [x] **F0.2 — Limpar histórico do git** — ✅ **concluído**: `git filter-branch` removeu `.env` de todo o histórico; force-push para `origin/main` confirmado (topo `2002fd9`; verificado: **0 ocorrências de `.env` no histórico do GitHub**). Backup em `d:/Github/vertice-backup-prefilter-20260531.bundle`.
- [x] **F0.3 — Criar `.env.example`** com todas as chaves vazias/descritas
- [x] **F0.4 — Secret scanning** — `.gitleaks.toml` + workflow CI `.github/workflows/secret-scan.yml` + pre-commit husky (`.husky/pre-commit`) que bloqueia `.env` e roda gitleaks se instalado
- [x] **F0.5 — `.gitignore`** reforçado: `.env`, `.env.*` ignorados, `!.env.example` rastreável

> Nenhum trabalho de feature deve começar antes de F0.1 e F0.2 concluídos.

---

## CATEGORIA 1 — Correções de Bugs

- [x] **B1** — `v2StartDate` (marco intencional do motor de sinais v2) extraído para constante única `V2_SIGNAL_START_DATE` em `financialConstants.js`, consumida por `researchController.js:93` e `generateRadarReport.js` (DRY, sem mudança de comportamento)
- [x] **B2** — `failCount` agora com coerção de tipo (`Number.isFinite`) + teto `Math.min(...,999)` antes de blacklistar · `server/services/marketDataService.js`
- [x] **B3** — `getUsdRateForDate` agora faz busca binária pela taxa histórica mais próxima anterior (em vez de janela fixa de 7 dias → taxa atual); só usa taxa atual se não houver histórico · `server/services/financialService.js`
- [x] **B4** — Limite JSON `10kb` → `1mb` em `server/app.js` (comporta rankings com 100+ ativos + auditLog)
- [x] **B5** — Fallback de `resolvePapel` expandido (`papel`/`recebív`) mantendo prioridade do `fiiSubType` explícito; sem falso-positivo (testes `critical_improvements` verdes) · `server/services/engines/scoringEngine.js`
- [x] **B6** — Verificação de TLS habilitada por padrão (`rejectUnauthorized: true`) nos agents BCB/scraping; escape hatch `ALLOW_INSECURE_TLS` (documentado no `.env.example`); fallbacks HTTP/sintético cobrem falhas · `server/services/macroDataService.js`
- [x] **B7** — 3 `catch {}` silenciosos do macro agora logam em `logger.debug` (mantendo o fallback) · `server/services/macroDataService.js`
- [x] **B8** — Regex de email do model trocado por padrão HTML5 (rejeita `@@`, sem TLD, espaços; validado). Validação primária já via Zod (`authSchemas.js`) · `server/models/User.js`
- [x] **B9** — Toasts de sucesso/erro nas mutações de carteira (remove/reset) no `WalletContext`; `add` mantém feedback próprio no `AddAssetModal` (sem duplicar) · `client/src/contexts/WalletContext.tsx`
- [x] **B10** — `refreshProfile()` deixa de engolir erro: loga falhas (Sentry capta) e trata resposta não-ok; 401 segue no interceptor · `client/src/contexts/AuthContext.tsx`
- [x] **B11** — `server/server.js` removido (código morto: importava de `./src/` inexistente). Entrypoint único `index.js`, usado por `npm start` e `nodemon.json`
- [x] **B12** — Threshold Fundamentus avaliado **sempre**; em produção lança erro, em teste emite `logger.warn` (regressão visível, sem quebrar testes) — ações e FIIs · `server/services/fundamentusService.js`

---

## CATEGORIA 2 — Melhorias / Refatorações

- [x] **M1** — `calculateProfileScores()` (383 linhas) quebrado em 3 helpers por perfil (`scoreStockProfiles`/`scoreFiiProfiles`/`scoreCryptoProfiles`) + orquestrador enxuto (confiança→dispatch→clamp). **Paridade garantida por snapshot**: `tests/scoring_parity.spec.js` congela a saída de 17 cenários (stock/fii/crypto em vários tiers, setor financeiro, payout, sobrevalorização, dados ausentes, aristocrata) — 17/17 batem após o refactor. Suíte backend: 106/106 verdes · `server/services/engines/scoringEngine.js`
- [x] **M2** — `ExplainableAIRenderer` extraído para componente próprio (`components/research/ExplainableAIRenderer.tsx`), parsing memoizado (`useMemo` sobre o texto) + `React.memo`. `Research.tsx` enxuto (−90 linhas) e default import `React` órfão removido · `client/src/components/research/ExplainableAIRenderer.tsx`
- [x] **M3** — `AddAssetModal` decomposto (791→~520 linhas): 3 concerns extraídas em unidades testáveis — `hooks/usePriceFetch.ts` (auto-busca de preço: cache+debounce+meta), `hooks/useAssetSearch.ts` (autocomplete de ticker+dropdown) e `utils/assetTransaction.ts` (`validateTransaction` puro + `getLocalDateString`/`parseCurrencyToFloat`). Adotou `Alert` da base nos blocos de aviso/erro. Comportamento preservado (build verde). Extração de subcomponentes de render fica para passe A11y (A4/A5)
- [x] **M4** — Hook `useFeatureAccess` (`hasPlan`/`hasFeature`/`limitFor`) consolidando `PLAN_HIERARCHY`/`PLAN_ACCESS`/`FEATURE_LIMITS`. Refatorados os checks ad-hoc em `AiRadar`, `AssetTable` e `useDashboardData` (remove `user.plan === 'PRO' || ...`) · `client/src/hooks/useFeatureAccess.ts`
- [x] **M5** — Cálculo de KPIs extraído para `utils/kpiCalculations.ts` (`computeWalletKpis(assets, serverKpis)`, função pura testável). `WalletContext` agora só chama o util (−40 linhas no `useMemo`); branch demo permanece no contexto · `client/src/utils/kpiCalculations.ts`
- [x] **M6** — `React.memo` aplicado a `EvolutionChart`, `PerformanceChart` e `AllocationChart` (evita re-render dos gráficos em re-renders do pai sem mudança de dados) · `client/src/components/wallet/*Chart.tsx`
- [x] **M7** — `Promise.allSettled` no fetch de research do dashboard: falha de 1 relatório não derruba os outros 2 (scoreMap resiliente) · `client/src/hooks/useDashboardData.ts`
- [x] **M8** — `staleTime` centralizado em `config/queryConfig.ts` (`STALE_TIME.REALTIME/SHORT/MEDIUM/LONG/HOURLY`), aplicado em `useDashboardData` e `WalletContext` · `client/src/config/queryConfig.ts`
- [x] **M9** — Constantes operacionais centralizadas em `financialConstants.js` (env-overridable): `BUY_THRESHOLD` (era duplicado em portfolioEngine + 2x aiResearchService), `MAX_CRYPTO_PER_PROFILE`, `MARKET_CACHE_DURATION_MINUTES`, `DEFAULT_SELIC_FALLBACK` (substituiu 8 literais `11.25` espalhados por marketData/macroData/financial/scheduler/walletController/aiResearch). Novos overrides documentados no `.env.example`. Listas de setores/tickers já estavam externalizadas (`sectorTaxonomy.js` + flags DB). 106 testes verdes · `server/config/financialConstants.js`
- [x] **M10** — `console.*` de produção migrados para o `logger` Winston: academyController (14: erros→`logger.error`, seed→`info`, debug de certificado→`debug`), emailService (3), authMiddleware (1, agora loga `userId` em vez de email — toca S9). Os ~280 originais eram majoritariamente em **scripts CLI/tests** (uso legítimo, fora do escopo). `index.js` mantém `console.error` **deliberadamente**: é o crash-handler de bootstrap (último recurso, não pode depender do logger que pode estar falhando). 0 `console.*` restante em services/controllers/middleware · `server/**`
- [x] **M11** — Biblioteca base de UI criada em `components/ui/`: `Modal` (createPortal + backdrop-blur, focus trap + Escape + aria — pré-resolve A3/A4), `Skeleton`/`SkeletonText`, `Alert` (semáforo + `role=alert`), `Tooltip` (hover+foco, `aria-describedby`) + barrel `index.ts`. Primeiro consumidor: `AddAssetModal` (Alert, via M3); adoção do `Modal` nos demais modais é incremental (passe A11y)
- [x] **M12** — Tokens semânticos de fundo no `tailwind.config.js` (`base` #080C14, `card` #0B101A, `panel` #0F131E, `deep` #02040a, `elevated` #0F1729) + cor de marca `gold` (#D4AF37). Consolida os hex soltos (antes 5+ tons divergentes). Adotado nos primitivos novos (`Modal`→`bg-panel`, `Tooltip`→`bg-card`); migração dos componentes legados é incremental (sem mass-rewrite de 89 ocorrências) · `client/tailwind.config.js`
- [x] **M13** — Verificado: `package.json` raiz já declara **zero** deps de runtime (só devDependencies de tooling). As libs físicas no `node_modules` (lodash/rxjs/date-fns) são **transitivas legítimas do `concurrently`** (`npm ls` confirma), não orfãs — nada a remover. Premissa original já resolvida na reescrita do manifesto (Fase 2)
- [x] **M14** — Índices Mongo adicionados **com base em auditoria de query real**: `MarketAsset {isActive, isBlacklisted, isIgnored, type}` (filtro quente de elegibilidade em signalEngine/radar/scheduler/marketData) e `QuantSignal {status, timestamp:-1}` (sinais ativos lidos a cada dashboard/run — antes full scan). `(user,date)` em `WalletSnapshot` **já existia**. `fiiSubType`/`lastFundamentalsDate`/`(sector,type)` avaliados e **descartados**: lidos por-doc, sem predicado de query que os justifique · `server/models/MarketAsset.js`, `QuantSignal.js`

---

## CATEGORIA 3 — Implementações / Novas Features

- [x] **I1** — `ErrorBoundary` global criado (reporta ao Sentry + fallback amigável com reload) envolvendo todo o app · `client/src/components/ErrorBoundary.tsx`, `client/src/App.tsx`
- [x] **I2** — Health check `/api/health` (status, estado do Mongo, uptime) em `server/app.js`, montado **antes do rate limiter** para não estrangular probes; retorna 503 se Mongo desconectado
- [x] **I3** — **Dispensado por decisão de produto** (sem infra paga/extra): o benefício de cache já é entregue sem Redis — cache em memória do plano (I6), cache de market data no Mongo e cache macro existentes. Redis só compensa em **múltiplas instâncias** do servidor (não é o caso atual); adicioná-lo exigiria um serviço separado no deploy. Reavaliar se/quando escalar horizontalmente · `marketDataService.js`, `macroDataService.js`
- [x] **I4** — `utils/resilience.js`: `withRetry` (backoff exponencial + jitter, `shouldRetry`) e `CircuitBreaker` (CLOSED/OPEN/HALF_OPEN, fast-fail no cooldown, fallback opcional). Integrado no `externalMarketService`: breakers por provedor (`yahoo` thr=4, `google-finance` thr=8, `brapi` thr=5) — quando um terceiro cai, o lote para de bater nele a cada ticker (pula o provedor morto em vez de esperar o timeout); Yahoo primário com 1 retry sob breaker (circuito aberto → cai no Protocolo de Emergência Google já existente). 9 testes do core de resiliência · `server/utils/resilience.js`, `services/externalMarketService.js`, `tests/resilience.spec.js`
- [x] **I5** — Rate limiting **por usuário** (não por IP) em `middleware/rateLimiters.js`: chave `u:<id>` (fallback IP), via factory `createUserLimiter`. `walletWriteLimiter` (50/15min) substitui o `writeLimiter` por-IP da carteira — corrige injustiça atrás de NAT e evasão por troca de IP. `researchHeavyLimiter` (20/15min) nas rotas caras de research (full-pipeline, crunch, enhance, narrative, syncs, cleanup) e `researchReadLimiter` (300/15min) nas leituras agregadas (latest/macro/signals). Montados após `authenticateToken` (req.user garantido). 3 testes (teto/429, isolamento mesmo-IP, fallback IP) · `server/middleware/rateLimiters.js`, `walletRoutes.js`, `researchRoutes.js`, `tests/rate_limiters.spec.js`
- [x] **I6** — Cache em memória do usuário (plano/role/assinatura) no `authMiddleware` (TTL 5min, env `PLAN_CACHE_TTL_MS`) — corta o `User.findById` que rodava em **todo** request autenticado. `utils/userCache.js` (Map + TTL + teto anti-leak). Correção: cache hit de **plano pago vencido** (`isExpiredPaid`) força o caminho de DB para rebaixar+persistir — nunca vaza acesso. Invalidação explícita nos pontos de mutação: checkout (`subscriptionController`), webhook MP (`webhookController`), edição de perfil (`authController`) e `clearUserCache()` pós-downgrade em massa do scheduler. 8 testes (cache + middleware) · `server/utils/userCache.js`, `authMiddleware.js`, `tests/user_cache.spec.js`, `tests/auth_middleware_cache.spec.js`
- [x] **I7** — OpenAPI 3 / Swagger (libs locais grátis `swagger-jsdoc` + `swagger-ui-express`, sem serviço externo). UI interativa em **`/api/docs`** + spec cru em `/api/docs.json`. `config/swagger.js` documenta a superfície principal (auth, wallet, research, market, subscription) com security scheme Bearer JWT, schemas de request e tags; `apis: ['./routes/*.js']` permite anotar novas rotas com `@openapi`. Montado **antes do helmet** (a Swagger UI usa inline scripts que a CSP estrita bloquearia). 5 testes de geração do spec · `server/config/swagger.js`, `app.js`, `tests/swagger.spec.js`
- [x] **I8** — Lazy-load das abas da Wallet via `React.lazy` + `Suspense`. OVERVIEW (aba default) segue eager para não piscar fallback no load; PERFORMANCE/DIVIDENDS/STATEMENT viraram chunks separados (`PerformanceChart` 7.85kB, `DividendDashboard` 8.34kB, `MonthlyReturnsTable` 5.57kB, `CashFlowHistory` 5.20kB — ~27kB raw/~10kB gzip adiados do bundle inicial), carregados sob demanda com fallback de esqueleto. `tsc` limpo, build OK · `client/src/pages/Wallet.tsx`
- [x] **I9** — Validação Zod centralizada nas rotas de escrita da carteira via `validate(schema)` (já usado em auth): novo `schemas/walletSchemas.js` cobre `POST /add` (ticker/quantity≠0/price≥0/type∈enum, coerção de strings), `PUT /:id` (tags ≤20), `DELETE /:id` e `DELETE /transactions/:id` (ObjectId 24-hex) e `POST /fix-splits`. Gate puro — não muta `req.body`, então a lógica dos handlers é preservada. Sanitização anti-injeção é o S8 (global). Writes de research são admin-gated e majoritariamente sem body (triggers). 13 testes · `server/schemas/walletSchemas.js`, `walletRoutes.js`, `tests/wallet_schemas.spec.js`
- [x] **I10** — Validação de assinatura do webhook MP endurecida: **fail-closed** em produção sem secret + comparação **constant-time** (`crypto.timingSafeEqual`) · `server/controllers/webhookController.js` (HMAC já existia)
- [x] **I11** — Transações atômicas nas mutações de carteira: `addAssetTransaction`/`removeAsset`/`resetWallet` já usavam `mongoose.startSession()` + commit/abort. **Fechada a brecha do `deleteTransaction`** — agora o delete da transação e o `recalculatePosition` rodam na MESMA sessão (recálculo que falha reverte o delete, sem posição inconsistente); `rebuildUserHistory` segue como pós-commit best-effort. 3 testes (commit/abort/404) · `server/controllers/walletController.js`, `tests/wallet_delete_transaction.spec.js`
- [x] **I12** — Vocabulário de skeletons compostos no `components/ui/Skeleton` (sobre o base do M11): `SkeletonCard`, `SkeletonChart`, `SkeletonKpiGrid`, `SkeletonTableRows`, todos com `role="status"` + `aria-label` (A11y). Adotados nos pontos de maior tráfego — `WalletSummary` (grid de KPIs), página `Wallet` (loading geral) e o `TabFallback` do lazy-load (I8) — substituindo `div animate-pulse` ad-hoc. Migração dos demais loaders é incremental. 6 testes · `client/src/components/ui/Skeleton.tsx`, `WalletSummary.tsx`, `pages/Wallet.tsx`, `tests Skeleton.test.tsx`
- [x] **I13** — Painel admin para editar tunables operacionais em runtime, sem deploy. `services/configService.js` mantém um snapshot em memória (TTL 60s) lido de SystemConfig (`key APP_TUNABLES`), com **guarda de `mongoose.readyState`**: desconectado → devolve os defaults do M9 (engines em teste inalteradas). Tunables: `maxCryptoPerProfile`, `marketCacheMinutes`, `defaultSelicFallback` (com validação de faixa). Consumidores ligados ao valor dinâmico: `portfolioEngine` (cap de cripto, via `getTunablesSync`) e `marketDataService` (janela de cache). Endpoints admin `GET/PUT /research/config/tunables` + UI `TunablesCard` na aba Ferramentas do AdminPanel (editar/restaurar padrão/salvar). 5 testes · `server/services/configService.js`, `controllers/configController.js`, `client/.../admin/TunablesCard.tsx`
- [x] **I14** — MFA/2FA opcional por TOTP (compatível com Google Authenticator/Authy), **opt-in** — login de quem não ativou é inalterado. Backend: `utils/mfa.js` (otplib v13 `generateSecret`/`verifySync` window±1 + backup codes hash SHA-256 de consumo único), `mfaController.js` (setup→QR, enable→confirma+devolve backup codes 1x, disable→por código ou senha), gate no `login` (`mfaRequired` sem emitir tokens; aceita TOTP ou backup code), campos `mfaEnabled/mfaSecret/mfaPendingSecret/mfaBackupCodes` (sensíveis `select:false`) no `User`, rotas `/mfa/*` autenticadas. Frontend: passo de código no `Login`, fluxo real (QR + ativar + backup codes + desativar) na `SecuritySection` (antes mock), métodos no `authService`. 11 testes backend (TOTP round-trip + gate de login) · `server/utils/mfa.js`, `controllers/mfaController.js`, `models/User.js`, `client/.../SecuritySection.tsx`, `pages/Login.tsx`

---

## CATEGORIA 4 — Segurança

- [x] **S1** — 🔴 Rotação de segredos + limpeza de histórico — concluído na **Fase 0** (F0.1 rotação pelo usuário + F0.2 `git filter-branch` + force-push)
- [x] **S2** — 🔴 `.env.example` + secret scanning (gitleaks) no pre-commit e CI — concluído na **Fase 0** (F0.3/F0.4)
- [x] **S3** — 🟠 Validação de assinatura webhook MP endurecida (= I10) · `webhookController.js`
- [x] **S4** — 🟠 Auditoria concluída: **todas** as rotas admin (research, wallet, academy, subscription) já têm `requireAdmin`; market `/status/:ticker` é read-only sob `authenticateToken`. **Sem brechas.**
- [x] **S5** — 🟠 Verificado: `logout` já deleta o `RefreshToken` do DB (`findOneAndDelete` + `clearCookie` `sameSite:strict`) · `authController.js:199-210`. **Já implementado.**
- [x] **S6** — 🟡 Política de senha centralizada em `utils/passwordPolicy.js` (`getPasswordError`): mínimo 8 + minúscula/maiúscula/dígito **+ bloqueio de senhas comuns** (blocklist case-insensitive). Eliminou a regra duplicada em register/reset/change do `authController` e alinhou o `registerSchema` (Zod, antes só `min(6)`) ao mesmo padrão. 8 testes · `server/utils/passwordPolicy.js`
- [x] **S7** — 🟡 Verificado/satisfeito: cookie de refresh já é `httpOnly + secure + sameSite:'strict'` (`authController`); rotas de estado usam **Bearer token** (header, imune a CSRF); CORS com allowlist + `credentials`; helmet com HSTS/CSP restritiva. CSRF mitigado por arquitetura — token CSRF dedicado seria redundante para SPA com Bearer + SameSite=Strict
- [x] **S8** — 🟡 Middleware `sanitizeInput` (`middleware/sanitize.js`) montado após o parse do JSON: remove de body/query/params chaves com `$` (operadores Mongo), `.` (dotted-path) e `__proto__`/`constructor`/`prototype` (prototype pollution), em objetos aninhados, com limite de profundidade (anti-DoS). Valores preservados. XSS: defesa primária é o escape de saída do React. 6 testes · `server/middleware/sanitize.js`
- [x] **S9** — 🟡 PII (email) removido de **todos** os logs: downgrade no `authMiddleware` (já no M10) + 4 spots restantes (`researchController` admin x2, `subscriptionController`, `webhookController`) agora logam `user._id` em vez de email. Verificado: 0 emails em logs (exceto o envio legítimo no `emailService`)
- [x] **S10** — 🟡 `@google/genai` saiu de `*` (perigoso — permitia major quebrado) para `^1.38.0`; `axios` floor elevado de `^1.6.0` para `^1.7.0`. Versões instaladas já satisfazem (sem reinstalação) · `server/package.json`
- [x] **S11** — 🟠 Criptografia em repouso confirmada no Atlas (encryption at rest padrão do cluster) + revisão LGPD: dados enviados ao Gemini são apenas tickers/métricas de mercado, **sem PII**. Tratado pelo usuário no painel.
- [x] **S12** — 🟡 `.github/dependabot.yml` (PRs semanais de update/segurança nos 3 manifestos + GitHub Actions) + step `npm audit --audit-level=high` no CI (informativo, `continue-on-error` — não bloqueia o build) · `.github/dependabot.yml`, `ci.yml`

---

## CATEGORIA 5 — Infraestrutura / DevOps

- [x] **D1** — CI GitHub Actions (`ci.yml`): install → lint (ESLint) → typecheck → test backend (com cobertura) → test frontend → build. Roda suite **determinística** (exclui `quant_regression` flaky até T3). Todos os passos validados localmente · `.github/workflows/ci.yml`
- [x] **D2** — ESLint flat config (v9) na raiz cobrindo client (TS/React) e server (Node ESM); regras pragmáticas (erros só p/ bugs reais). Corrigiu 4 erros reais: hook condicional no `AssetDetailModal`, `no-case-declarations`, `COLORS` indefinido · `eslint.config.js`
- [x] **D3** — Prettier configurado (`.prettierrc` + `.prettierignore`) + scripts `format`/`format:check`. Enforcement via lint-staged deixado como `eslint --fix` para evitar reformatação em massa (4→2 espaços); passada completa de Prettier fica como tarefa deliberada futura
- [x] **D4** — `strict: true` habilitado no `client/tsconfig.json`. Removidos os 9 `@ts-ignore` (react-router-dom já tem types) e corrigidos os 8 erros reais do strict (AllocationChart any[], Dashboard `name` undefined, Register index, Landing map cast, ResearchViewer Date undefined). `noUnusedLocals` deixado p/ ESLint (warn) para não quebrar o build com vars legadas · `client/tsconfig.json`
- [x] **D5** — `lint-staged` (`eslint --fix` nos arquivos staged) adicionado ao pre-commit do husky, somado à barreira de segredos (.env block + gitleaks) · `.husky/pre-commit`, `package.json`
- [ ] **D6** — Dockerfile (server) + docker-compose (server+mongo)
- [x] **D7** — Cobertura Vitest (`@vitest/coverage-v8`) em `server/vitest.config.js` com **gate-ratchet** por arquivo: `mathUtils.js` (linhas/stmts ≥70%, branches ≥85%) e `scoringEngine.js` (linhas ≥70%, funcs ≥90%). Script `test:ci`. Subir conforme T1/T2/T8 · `server/vitest.config.js`
- [x] **D8** — Conventional Commits validados por commitlint no hook `commit-msg` do husky · `commitlint.config.js`, `.husky/commit-msg`
- [ ] **D9** — Branch protection no `main` (PR + CI verde)
- [ ] **D10** — Script de build do server + `build:all` no raiz · `/package.json`
- [ ] **D11** — Sourcemaps de produção (upload p/ Sentry, não público) · `client/vite.config.ts`
- [ ] **D12** — Logging estruturado JSON + correlation IDs (`x-request-id`) · `server/config/logger.js`
- [ ] **D13** — Investigar bundle/`dist` de 16MB do client

---

## CATEGORIA 6 — Testes

Hoje: ~4 specs no backend e **1 teste no frontend** para 67 componentes.

- [x] **T1** — `scoring_engine.spec.js`: gates de descarte (stablecoin, penny, liquidez STOCK/FII, blacklist) + saída de ativo saudável (scores por perfil, auditLog, structural). 6 testes · `server/tests/scoring_engine.spec.js`
- [x] **T2** — `portfolio_engine.spec.js`: penalidade de concentração setorial (3º -5, 4º -15, isolamento por perfil, rebaixa p/ WAIT) + cap de cripto no draft + entrada vazia. 7 testes · `server/tests/portfolio_engine.spec.js`
- [x] **T3** — `quant_regression.spec.js` reescrito e **determinístico** (mock de `externalMarketService`/`SystemConfig`, dados que disparam RSI com reversão, asserção no `bulkWrite`). Roda em ~9ms; re-incluído no CI · `server/tests/quant_regression.spec.js`
- [x] **T4** — `market_data_service.spec.js`: `refreshQuotesBatch` com Mongoose/externos mockados — cache fresco (não busca) vs stale (busca+atualiza), skip de ativo inativo mesmo com force, `failCount` incrementa e desativa ao atingir teto (10), coerção de `failCount` corrompido [B2] + `normalizeSymbol`. 6 testes · `server/tests/market_data_service.spec.js`
- [x] **T5** — `fundamentus_parse.spec.js`: `parseBrFloat` (exportado p/ teste) normaliza formato BR — milhar/decimal, percentual, traço/vazio/null → 0, negativos, texto não-numérico → 0 (nunca NaN). 5 testes · `server/tests/fundamentus_parse.spec.js`
- [x] **T6** — `research_delta.spec.js`: `generateComparisonReport` (exportado p/ teste) — sem base anterior → null, entradas novas/saídas, upgrade (WAIT→BUY)/downgrade (BUY→WAIT), biggestMovers por Δscore≥5 e Δposição≥3, topBuys (só BUY), summary. Deps pesadas (Gemini/models) mockadas só p/ o import. 7 testes · `server/tests/research_delta.spec.js`
- [x] **T7** — `pipeline_integration.spec.js`: integração real das engines (scoring→portfolio→ranking), replicando o encadeamento do `aiResearchService` (processAsset → performCompetitiveDraft → applyConcentrationPenalty → sort) **sem DB/HTTP**. Verifica descarte de inelegíveis (stablecoin/penny), perfil/score/ação válidos em todo item, **ordenação soberana** decrescente e **Regra #1** (BUY⇔score≥70) ponta-a-ponta. 5 testes · `server/tests/pipeline_integration.spec.js`. *(Versão HTTP+mongo-memory deixada como melhoria futura — alto custo de infra/CI vs. valor)*
- [x] **T8** — Edge cases da matemática financeira segura: `safeDiv`/0, `calculatePercent` base 0, guardas de dados insuficientes (`calculateSharpeRatio`/`calculateBeta`/`calculateStdDev` → neutro), ramos de aporte/resgate total do Modified Dietz. 17 testes · `server/tests/math_edge_cases.spec.js`. **Venda > posição** coberta no client via `validateTransaction` (ver abaixo). Adicionado ao `test:ci`
- [x] **(extra) Testes de unidade dos utils extraídos (client)** — `assetTransaction.test.ts` (14: `validateTransaction` BUY/SELL/CASH/FIXED_INCOME, data futura, saldo insuficiente, payloads) + `kpiCalculations.test.ts` (6: `computeWalletKpis` vazio/soma/override do servidor/fallbacks). Base para T9/T10. 20 testes · `client/src/utils/*.test.ts`
- [x] **T9** — `useFeatureAccess.test.ts` (hook): `hasPlan` (hierarquia), `hasFeature` (PLAN_ACCESS — PRO tem radar mas não global; BLACK tem exclusivas), `limitFor` (FEATURE_LIMITS, chave inexistente→0), GUEST default. `useAuth` mockado, `renderHook`. 6 testes · `client/src/hooks/useFeatureAccess.test.ts`. **Infra:** instalado `@testing-library/react` + `jest-dom` + `user-event` + `src/test/setup.ts`
- [x] **T10** — Component tests (base de UI M11): `Alert.test.tsx` (4 — children, `role=alert` p/ erro/aviso vs `role=status`, título) + `Modal.test.tsx` (4 — fechado→null, aria de diálogo, **fecha com Escape [A3]** via user-event, botão fechar). 8 testes · `client/src/components/ui/*.test.tsx`
- [x] **T11** — `WalletContext.test.tsx` (context): modo demo injeta `DEMO_ASSETS`, expõe KPIs fixos (sharpe 1.8 / beta 0.85), desliga privacidade e **bloqueia mutações** (`addAsset` não chama a API). Contextos e `walletService` mockados, `QueryClientProvider` no wrapper. 3 testes · `client/src/contexts/WalletContext.test.tsx`
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
