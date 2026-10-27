# PROMPT — Auditoria técnica completa do projeto "Vértice Invest"

> **Como usar:** peça para a IA ler este arquivo por inteiro e executar a auditoria descrita abaixo, com acesso ao código-fonte do repositório.

## Papel e objetivo

Você é um **arquiteto de software sênior + auditor de segurança + revisor quantitativo financeiro**. Sua tarefa é analisar **fio a fio** o código-fonte do projeto **Vértice Invest** e produzir um **relatório de auditoria técnica exaustivo**: defeitos, inconsistências, riscos, dívidas técnicas, oportunidades de melhoria (backend e frontend), cobertura de testes e correção matemático-financeira. Não seja superficial: eu quero profundidade, evidência e ações concretas — não elogios genéricos.

**Regras de conduta da análise:**
- Cite sempre `arquivo:linha` como evidência. Sem evidência = não conta.
- Distinga claramente **fato observado no código** de **suposição**. Marque suposições com `[SUPOSIÇÃO]`.
- Se não tiver acesso a um arquivo/trecho, **peça** em vez de inventar. Nunca alucine APIs, funções ou comportamento.
- Priorize **impacto real** (dinheiro do usuário, segurança, correção de rankings) sobre estilo.
- Quando apontar um problema, proponha a **correção concreta** (diff, pseudocódigo ou passos), não apenas o diagnóstico.

---

## Contexto do produto

**Vértice** é uma plataforma institucional de análise quantitativa financeira (Ações, FIIs, ETFs, Cripto) que gera rankings de investimento por perfil de risco, gestão de carteira com KPIs, sinais técnicos, metas, academy e cobrança por assinatura. É um **monorepo** com frontend e backend rodando juntos via `concurrently`.

### Stack real
- **Frontend** (`/client`): React 18 + TypeScript 5 + Vite 5 + Tailwind 3. `lucide-react` (ícones), `recharts` (gráficos), `@tanstack/react-query` v5 (data fetching), React Router v6 com **HashRouter**, `react-player`. Animações apenas via CSS/Tailwind keyframes (sem libs de animação). Alias `@` → `src/`.
- **Backend** (`/server`): Node.js **ES Modules** (nunca `require`), Express 4, MongoDB/Mongoose 8, Winston (logs), node-cron. AI: `@google/genai` (Gemini). Pagamentos: Mercado Pago SDK. Auth: JWT + refresh tokens persistidos + MFA/TOTP (`otplib`). Segurança: `helmet`, `cors`, `express-rate-limit`, `bcryptjs`, `zod`, encryption própria. Observabilidade: Sentry (`@sentry/node` + `@sentry/react`). Docs: `swagger-jsdoc` + `swagger-ui-express`. Scraping: `cheerio` + `iconv-lite`. Cotações: `yahoo-finance2` (+ fallback Brapi/Google Finance/Fundamentus). Emails: `nodemailer`. PDFs: `pdf-lib`.
- **Dev/Qualidade**: Nodemon, Vite HMR, **Vitest** (client e server), ESLint 9 (flat config), Prettier, Husky + lint-staged, commitlint (conventional commits), gitleaks/secret-scan, Lighthouse CI. CI em `.github/workflows/` (`ci.yml`, `lighthouse.yml`, `secret-scan.yml`).

### Dimensão do código (para calibrar esforço)
- **Server**: ~259 arquivos `.js` (fora node_modules). Subpastas: `config` (13), `controllers` (14), `middleware` (9), `models` (30), `routes` (12), `services` (22 + `engines/` (3) + `workers/` (1)), `utils` (20), `scripts` (40), `tests` (~80 arquivos).
- **Client**: ~185 arquivos `.ts/.tsx`. Pastas: `components/` (Academy, admin, auth, common, dashboard, goals, layout, profile, pwa, research, seo, tutorial, ui, wallet), `pages/` (+ `pages/admin`), `contexts`, `hooks`, `services`, `utils`, `types`, `data`, `stories`.

### Arquitetura de domínio (onde mora a lógica crítica)

**Core Engines (backend):**
- `server/services/engines/scoringEngine.js` — avalia cada ativo em 3 scores estruturais (QUALITY/VALUATION/RISK, 0–100) e 3 perfis (DEFENSIVE/MODERATE/BOLD). Gate de elegibilidade `isEligibleForDefensive`. Valuation: Graham (√22.5×LPA×VPA), Bazin (dividendo/6%), PEG, VP-adjusted (FIIs). Confidence score que desconta dados ausentes/stale e limita `maxScoreAllowed`.
- `server/services/engines/portfolioEngine.js` — **draft competitivo** por perfil (GOLD/SILVER/BRONZE), limites de concentração por setor/gestor, penalidades pós-draft.
- `server/services/engines/signalEngine.js` — sinais RSI/Volume/Suporte.
- `server/services/aiResearchService.js` — orquestração: scoring → draft → penalidade de concentração → sort global → delta vs. relatório anterior → salva `MarketAnalysis`. Também "Brasil 10".
- `server/services/marketDataService.js` — cotações, cache, cadeia de fallback.
- `server/services/macroDataService.js` — SELIC/IPCA/CDI/Ibov com cadeia multi-fonte (BCB → BrasilAPI → IBGE).
- `server/services/fundamentusService.js` — scraping fundamentalista BR.
- Workers: `server/services/workers/timeSeriesWorker.js` (séries temporais).

**Utilitários críticos (backend):** `utils/mathUtils.js` (matemática financeira segura: `safeFloat/safeCurrency/safeAdd/Sub/Mult/Div`), `utils/dateUtils.js` (timezone único: `toDateKey` UTC vs `startOfDay` local), `utils/resilience.js` (retry + circuit breaker), `utils/encryption.js`, `utils/mfa.js`, `utils/goldClassification.js`, `utils/fixedIncome.js`/`fixedIncomeView.js`, `utils/goalMath.js`, `utils/trackRecord.js`, `utils/userCache.js`.

**Middleware (backend):** `authMiddleware.js` (JWT + downgrade automático de plano por `validUntil` + cache de plano), `rateLimiters.js` (limiters por usuário), `correlationId.js`, `csrf.js`, `errorHandler.js`, `mongoCircuitBreaker.js`, `sanitize.js`, `validateResource.js` (Zod).

**Modelos MongoDB (30):** `MarketAsset`, `MarketAnalysis`, `SystemConfig`, `DiscardLog`, `User`, `UserAsset` (taxLots FIFO), `WalletSnapshot`, `QuantSignal`, `RefreshToken`, `UsageLog`, `AssetHistory`, `AssetTransaction`, `DividendEvent`, `FundamentalSnapshot`, `InvestmentGoal`/`GoalContribution`, `Course`/`Lesson`/`Quiz`/`QuizAttempt`/`UserProgress`, `AlgorithmPerformance`, `RecommendedPortfolioCurve`, `TreasuryBond`, `EconomicIndex`, `Notification`, `AuditLog`, `AssetLogo`, `Transaction`.

**Frontend chave:** páginas `Dashboard`, `Wallet`, `Research`, `Radar`, `Goals`, `Comparator`, `Calculator`, `Indicators`, `Checkout`/`CheckoutSuccess`/`Pricing`, `Courses`/`CoursePlayer`, `Landing`, auth pages, `pages/admin/*`. Contextos: `AuthContext`, `WalletContext` (com demo mode / `DEMO_ASSETS`), `ToastContext`, `DemoContext`, `ThemeContext` (light mode). Hooks: `useDashboardData`, `useFeatureAccess`, `usePriceFetch`, `useAssetSearch`, `useFormValidation`, `useConfirm`, `useCountUp`, `useIsMobile`.

### Regras de negócio INVIOLÁVEIS (verifique se são respeitadas em todo o código)
1. **Threshold Global = 70:** `score ≥ 70` → `BUY`; `< 70` → `WAIT`. Em todo o sistema.
2. **Ordenação soberana:** sempre `b.score - a.score`. Tiebreaker: composite estrutural `(quality+valuation+risk)/3`.
3. **Perfis:** cada ativo tem exatamente um perfil; frontend filtra `auditLog[]` pelo perfil do ativo.
4. **Delta de posição:** comparado ao último `MarketAnalysis` salvo.
5. **ES Modules** no backend — nunca `require()`.
6. **Secrets** nunca hardcoded — sempre `.env`.
7. **Matemática financeira** sempre via `mathUtils.js` — nunca operar floats brutos em dinheiro.
8. **Rate limiting** obrigatório em novas rotas (limiters por usuário) + validação Zod na escrita.

### Planos e feature gating
Hierarquia GUEST(0) < ESSENTIAL(1) < PRO(2) < ELITE(3) < BLACK(4), em `server/config/subscription.js`. Ex.: Brasil 10 exige ESSENTIAL+; Research STOCK/FII/Crypto/ETF e Radar Alpha exigem PRO+; Ativos Globais (STOCK_US/REIT) / Rebalanceamento IA exigem ELITE+. **Verifique se o gating é aplicado no backend (autoritativo) e não só escondido no frontend.**

---

## O que auditar (cobertura obrigatória)

Percorra **todas** as dimensões abaixo. Para cada uma, liste achados com severidade e evidência.

### 1. Correção e lógica de negócio
- As 8 regras invioláveis são respeitadas em todo lugar? Aponte cada violação.
- Corretude dos engines: fórmulas de Graham/Bazin/PEG/VP-adjusted; gates de elegibilidade; confidence score e `maxScoreAllowed`; draft competitivo (GOLD/SILVER/BRONZE), limites por setor/gestor, penalidades de concentração; tiebreakers; delta de posição.
- Sinais RSI/Volume/Suporte: janelas, edge cases (dados insuficientes, divisão por zero, gaps).
- Determinismo: o mesmo input produz o mesmo ranking? Há dependência de ordem de iteração de objeto, `Date.now()`, `Math.random()` ou timezone que quebre reprodutibilidade?

### 2. Matemática financeira e integridade de dados monetários
- Uso consistente de `mathUtils.js`. Encontre qualquer soma/subtração/multiplicação/divisão de valores monetários com floats brutos.
- FIFO/taxLots em `UserAsset`: cálculo de custo médio, lucro realizado (`realizedProfit`/`fifoRealizedProfit`), proventos.
- Renda fixa/CASH: regra de que o valor vem do TOTAL acumulado, nunca de quantidade×preço unitário (perda de centavos por arredondamento).
- Dedup de proventos por `(ticker, ex-date, type)`.
- TWRR / Modified Dietz em `WalletSnapshot` / `schedulerService.runDailySnapshot()`.
- Timezone: mistura indevida entre `toDateKey` (UTC) e `startOfDay` (local)? Off-by-one em bordas de dia.
- Arredondamento, precisão, unidades ($ cripto vs R$ B3), `Intl.NumberFormat`.

### 3. Segurança (trate como pentest de aplicação)
- **AuthZ/AuthN:** JWT (assinatura, expiração, algoritmo, `none` alg), refresh token rotation/reuse, logout/invalidação, downgrade de plano por `validUntil`, cache de plano (stale privilege). Feature gating **autoritativo no backend**? IDOR em rotas de wallet/goals/transactions (`/wallet/:id`, `/wallet/transactions/:ticker`) — o handler valida ownership pelo `user` do token?
- **MFA/TOTP:** janela de tempo, brute-force, secret storage, backup codes.
- **Input validation:** todas as rotas de escrita têm schema Zod? Injeção NoSQL (operadores `$` em query), mass assignment, XSS refletido/armazenado, sanitização.
- **Rate limiting:** cobertura das rotas caras (`researchHeavyLimiter`) e de escrita (`walletWriteLimiter`), auth (`authLimiter`). Bypass possível?
- **Segredos:** varredura por chaves/tokens hardcoded; `.env.example` vs uso real; logs vazando PII/segredos.
- **Webhooks Mercado Pago:** verificação de assinatura/autenticidade, idempotência, replay, race na concessão de plano.
- **Headers/CORS/CSRF:** config do `helmet`, origem do CORS, uso real do middleware `csrf.js`, cookies (`httpOnly`, `secure`, `sameSite`).
- **Encryption/`encryption.js`:** algoritmo, IV, gestão de chave.
- **Scraping/SSRF:** URLs controláveis? Timeout, tamanho de resposta, parsing seguro (cheerio).
- **LGPD:** tratamento de CPF (`cpfUtils.js`), pasta `docs/lgpd`, retenção/anonimização.

### 4. Backend — arquitetura, resiliência e performance
- Camadas (routes→controllers→services→models) coerentes? Lógica de negócio vazando para controllers/rotas?
- Resiliência: retry + circuit breaker (`resilience.js`, `mongoCircuitBreaker.js`) aplicados nas integrações externas (Yahoo/Brapi/Fundamentus/Gemini/BCB)? Comportamento sob falha/timeout/dados stale.
- Cadeia de fallback de cotações e de macro: ordem correta, marcação de `stale`, cache TTL.
- Queries MongoDB: índices (ex.: único `{user,ticker}`), N+1, `.populate` pesado, full scans, uso de `.lean()`, projeções, paginação. Escrita concorrente/races (upserts, snapshots diários).
- Jobs/cron (`schedulerService`, `cleanupService`, workers): idempotência, overlap, travas, memória (o `start` usa `--max-old-space-size=400` — há risco de OOM?).
- Tratamento de erros central (`errorHandler.js`, `AppError.js`): vazamento de stack em prod, status codes corretos, `correlationId` propagado.
- Config editável em runtime (`configService.js`): validação, autorização (admin), cache invalidation.

### 5. Frontend — arquitetura, correção e UX
- React Query: chaves de cache, `staleTime`/`gcTime`, invalidação após mutação, estados de loading/erro/empty, refetch e race conditions.
- Hooks primeiro (regras de hooks): guards `if (!data) return null` só após todos os hooks. Aponte violações e dependências faltando em `useMemo/useEffect/useCallback`.
- `WalletContext` demo mode: mutações checam `isDemoMode` antes de chamar API? Vazamento entre demo e dados reais.
- Interceptor de 401/refresh: fila de requests, loop infinito, redirect para `/login`.
- Privacy mode: todos os valores sensíveis são mascarados de forma consistente (o commit recente ajustou o card de Distribuição — verifique regressões similares em outros cards/KPIs).
- Consistência do Design System (fundos `#090C11`/`#0F141A`/`#141922`/`#191F29`/`#202631`, semáforo emerald/yellow, modais `createPortal`+`z-[100]`+`backdrop-blur`), light mode (`ThemeContext` + CSS vars) sem regressões de contraste.
- Acessibilidade (há `a11y.test.tsx`): roles, foco, teclado, aria, contraste. Amplie.
- Performance: re-renders, memoização, listas grandes, code splitting/lazy, tamanho de bundle, imagens/logos.
- Tipagem TS: uso de `any`, `as`, tipos frouxos em fronteiras de API; alinhamento entre tipos do client e payloads reais do backend.
- PWA, SEO (`components/seo`, sitemap), tratamento de erros com Sentry no client.

### 6. Testes e qualidade
- Avalie a suíte existente (~69 spec no server; ~26 no client). Onde há **cobertura enganosa** (testa o caminho feliz, não os edge cases)?
- Lacunas críticas sem teste: engines (invariantes de ranking, concentração, tiebreak), fallback de cotações/macro sob falha, FIFO/proventos, webhooks de pagamento, autorização/IDOR, MFA, refresh token.
- Testes frágeis/flaky (dependência de rede, tempo, ordem). Mocks que escondem bugs reais.
- Sugira **casos de teste específicos** (nome + arrange/act/assert) para as maiores lacunas.
- CI (`.github/workflows`): o pipeline roda lint + typecheck + test + build + secret-scan + lighthouse? Gaps? Gates de qualidade ausentes.

### 7. Consistência, dívida técnica e manutenibilidade
- Duplicação de lógica (ex.: cálculo de setor/segmento, classificação de ativos espalhados em `sectorResolver`/`sectorTaxonomy`/`sectorOverrides`/`stockSectorsByBase`).
- Código morto, scripts obsoletos (33 em `server/scripts`), features "dormentes" (ex.: track record Fase 3).
- Divergência entre `CLAUDE.md`/`ARCHITECTURE.md`/`README`/`CHANGELOG` e o código real.
- Nomenclatura, ES Modules vs `require`, padrões de log estruturado (`logger.info(msg,{meta})`), tratamento de datas.
- `planejamento/BACKLOG.md`: itens pendentes vs implementados.

### 8. Operação e confiabilidade
- Variáveis de ambiente: `.env.example` cobre tudo que o código lê? Falha graciosa quando faltam.
- Migrations/scripts de dados destrutivos (`drop:*`, `trim:*`, `cleanup:now`, `migrate:fix`): salvaguardas, idempotência, confirmação.
- Logs: nível, ruído, PII, rotação (`combined.json.log`).
- Health/readiness (`/api/health`), Swagger (`/api/docs`) exposto em prod?

---

## Método de trabalho (siga nesta ordem)

1. **Mapa mental primeiro:** reconstrua o fluxo end-to-end de 3 jornadas críticas e aponte riscos em cada etapa:
   - (a) pipeline de research (sync market → scoring → draft → save → render no `Research.tsx`);
   - (b) adicionar ativo na carteira → cálculo FIFO/KPIs → snapshot diário → exibição no `Wallet.tsx`;
   - (c) checkout Mercado Pago → webhook → concessão de plano → gating de feature.
2. **Varredura sistemática** por camada (config → models → services/engines → controllers → routes → middleware; depois contexts → hooks → pages → components → utils no client).
3. **Caça a invariantes quebradas** usando as 8 regras invioláveis como checklist.
4. **Priorize** por severidade e impacto.

---

## Formato do relatório (obrigatório)

1. **Sumário executivo** (≤15 linhas): saúde geral, top 5 riscos, veredito.
2. **Tabela de achados**, ordenada por severidade, com colunas:
   `#` | `Severidade` (🔴 Crítico / 🟠 Alto / 🟡 Médio / 🔵 Baixo / ⚪ Nit) | `Categoria` (Segurança / Correção / Financeiro / Performance / Testes / Arquitetura / UX / DevOps) | `Arquivo:linha` | `Descrição` | `Impacto` | `Correção proposta` | `Esforço` (S/M/L) | `Confiança` (Alta/Média/[SUPOSIÇÃO]).
3. **Deep-dives** dos achados 🔴/🟠: trecho de código atual + explicação da falha + cenário de exploração/quebra concreto (inputs → saída errada) + patch sugerido (diff/pseudocódigo).
4. **Lacunas de teste** com casos propostos.
5. **Quick wins** (alto impacto, baixo esforço) em lista separada.
6. **Roadmap priorizado** (Agora / Próximo / Depois).
7. **Perguntas em aberto** — o que você precisou supor e o que deveria me perguntar antes de agir.

**Não** invente vulnerabilidades para parecer completo; **não** relate estilo como se fosse bug; **não** pare cedo por tamanho — se necessário, divida em partes e continue. Comece confirmando seu entendimento do escopo em 3 linhas e então produza o relatório.
