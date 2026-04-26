# Vértice — Diretrizes para AI

Plataforma institucional de análise quantitativa financeira (Ações, FIIs, Cripto). Monorepo com `dev` rodando client + server via `concurrently`.

---

## Stack

- **Frontend** (`/client`): React 18 + TypeScript + Vite + Tailwind. Ícones: `lucide-react`. Gráficos: `recharts`. Data fetching: `@tanstack/react-query` v5. Roteamento: React Router v6 com **HashRouter**. Animações: `framer-motion`.
- **Backend** (`/server`): Node.js ES Modules (`import/export`, nunca `require`). Express 4, MongoDB/Mongoose 8, Winston (logs), node-cron. AI: `@google/genai` (Gemini). Pagamentos: Mercado Pago SDK.
- **Dev**: Nodemon (server), Vite HMR (client), Vitest (testes).

---

## Mapa de onde mexer

| Intenção | Arquivo |
|---|---|
| Cálculo Graham/Bazin/PEG, scores de perfil | `server/services/engines/scoringEngine.js` |
| Draft competitivo, penalidades de concentração | `server/services/engines/portfolioEngine.js` |
| Sinais RSI/Volume/Suporte | `server/services/engines/signalEngine.js` |
| Orquestração ranking → MongoDB | `server/services/aiResearchService.js` |
| Cotações, cache, fallback | `server/services/marketDataService.js` |
| Scraping Fundamentus | `server/services/fundamentusService.js` |
| Macro (SELIC, IPCA, CDI, Ibov) | `server/services/macroDataService.js` |
| Página de Pesquisa / Ranking | `client/src/pages/Research.tsx` |
| Modal deep-dive de ativo | `client/src/components/research/AssetDetailModal.tsx` |
| Lista de ranking com numeração | `client/src/components/research/TopPicksCard.tsx` |
| Carteira, KPIs, snapshots | `client/src/pages/Wallet.tsx` |
| Dashboard, sinais, equity | `client/src/pages/Dashboard.tsx` |
| Planos e feature gating | `server/config/subscription.js` |
| Setores macro | `server/config/sectorTaxonomy.js` |
| Constantes financeiras | `server/config/financialConstants.js` |
| Matemática financeira segura | `server/utils/mathUtils.js` |
| Middleware JWT + downgrade de plano | `server/middleware/authMiddleware.js` |
| Guards de rota (auth/admin) | `client/src/components/auth/ProtectedRoute.tsx`, `AdminRoute.tsx` |
| Séries temporais (worker) | `server/services/workers/timeSeriesWorker.js` |

---

## Core Engines

### `scoringEngine.js`

Avalia cada ativo em **3 scores estruturais** (QUALITY / VALUATION / RISK, 0–100) e **3 perfis de risco** (DEFENSIVE / MODERATE / BOLD).

**Gate de elegibilidade:** `isEligibleForDefensive(asset)` — STOCK exige marketCap ≥ 1B, beta < 1.5, ROE ≥ 5%, setor seguro ou DY ≥ 6% + P/L ≤ 10. FII exige marketCap ≥ 500M, DY ≤ 18%, vacância ≤ 12%, liquidez ≥ 1M/dia.

**Valuation:** Graham (√22.5 × LPA × VPA), Bazin (dividendo/6%), PEG (P/L ÷ crescimento), VP-adjusted (FIIs).

**Confidence score:** desconta dados ausentes ou stale; `confidence < 60` → `maxScoreAllowed = 70`; `60–79` → `85`; `≥ 80` → `100`. Cripto sempre 100.

**Saída:** `scores{DEFENSIVE, MODERATE, BOLD}`, `auditLog[]`, `bullThesis[]`, `bearThesis[]`, `metrics.structural{quality, valuation, risk}`.

### `portfolioEngine.js`

**Draft competitivo** por perfil (DEFENSIVE → MODERATE → BOLD), cada um com até 10 ativos:
- **GOLD** (score ≥ 55): limite 4 ativos/setor (DEFENSIVE) ou 2 (outros)
- **SILVER** (score ≥ 40): limite 5/setor
- **BRONZE** (score > 30): backfill sem limite — usa `scoreKey` do perfil corrente

**Concentração pós-draft:** 3º ativo mesmo setor → -5; 4º+ → -15. 3º FII mesmo gestor → -20.

Tiebreaker em todos os sorts: score → `(quality + valuation + risk) / 3`.

### `aiResearchService.js`

Fluxo: `scoringEngine` → `portfolioEngine` draft → penalidade concentração → sort global → delta vs relatório anterior → salva `MarketAnalysis` no MongoDB.

**Brasil 10:** top 5 STOCKs + top 5 FIIs por score DEFENSIVE, sem draft competitivo.

---

## Regras de Negócio Invioláveis

1. **Threshold Global = 70:** `score ≥ 70` → `BUY`; `score < 70` → `WAIT`. Vale em todo o sistema.
2. **Ordenação soberana:** sempre `b.score - a.score`. Tiebreaker: composite estrutural.
3. **Perfis:** cada ativo no ranking tem exatamente um perfil (DEFENSIVE/MODERATE/BOLD). O frontend filtra `auditLog[]` pelo perfil do ativo.
4. **Delta de posição:** comparado com o último `MarketAnalysis` salvo (seta direcional no frontend).
5. **ES Modules:** backend usa `import/export`. Nunca `require()`.
6. **Secrets:** nunca hardcode. Usar variáveis do `.env`.
7. **Matemática financeira:** sempre usar `safeFloat()`, `safeCurrency()`, `safeAdd/Sub/Mult/Div()` de `mathUtils.js`. Nunca operar com floats brutos em valores monetários.
8. **Rate limiting em novas rotas:** usar `writeLimiter` (50 ops/15min) em todo POST/PUT/DELETE de wallet. Rotas de auth já têm `authLimiter` (20/15min). Geral: `apiLimiter` (3000/15min).

---

## Modelos MongoDB (principais)

- **`MarketAsset`**: cache de dados de mercado. Campos chave: `ticker`, `type` (STOCK|FII|STOCK_US|CRYPTO), `sector`, métricas (`pl`, `roe`, `netMargin`, `dy`, `beta`, `volatility`, `marketCap`, `avgLiquidity`), flags (`isBlacklisted`, `isTier1`).
- **`MarketAnalysis`**: ranking salvo. `content.ranking[]` (RankingItem com `position`, `score`, `riskProfile`, `action`, `auditLog[]`, `metrics`) e `content.fullAuditLog[]`.
- **`SystemConfig`** (key `MACRO_INDICATORS`): cache macro — `selic`, `ipca`, `ntnbLong`, `riskFree`, `ibov`, `dollar`, `btc`.
- **`DiscardLog`**: ativos descartados por run — `runId`, `ticker`, `reason`, `details`.
- **`User`**: `plan` (GUEST|ESSENTIAL|PRO|BLACK), `role` (USER|ADMIN), `subscriptionStatus`.
- **`UserAsset`**: holdings — `taxLots[]` para FIFO, `totalCost`, `realizedProfit`, `fifoRealizedProfit`. Índice único `{ user, ticker }`.
- **`WalletSnapshot`**: snapshot patrimonial diário — `equity`, `invested`, `result`, `twrr`, `dividends`. Gerado por `schedulerService.runDailySnapshot()`.
- **`QuantSignal`**: sinal técnico salvo — `ticker`, `type`, `strength`, `rsiValue`, `volumeRatio`.
- **`RefreshToken`**: tokens de refresh persistidos no banco — `token`, `user`, `expiresAt`.
- **`UsageLog`**: auditoria de uso por feature e plano.

---

## Planos e Acesso

Hierarquia: GUEST (0) < ESSENTIAL (1) < PRO (2) < BLACK (3). Definido em `server/config/subscription.js`.

| Feature | GUEST | ESSENTIAL | PRO | BLACK |
|---|---|---|---|---|
| Carteira / Brasil 10 | ✅ | ✅ | ✅ | ✅ |
| Sinais (delay) | ❌ | ✅ | ✅ | ✅ |
| Research STOCK/FII/Crypto | ❌ | ❌ | ✅ | ✅ |
| Radar Alpha / Aporte Inteligente | ❌ | ❌ | ✅ | ✅ |
| Ativos Globais / Rebalanceamento IA | ❌ | ❌ | ❌ | ✅ |

---

## Design System

- **Fundos:** `#080C14` (main), `#0B101A` (cards), `#0F131E` (modais).
- **Semáforo:** COMPRAR → `emerald-400/500`; AGUARDAR → `yellow-400/500`; perfis/risco → `blue-400/500` e `purple-400/500`; erros → `red-400/500`.
- **Modais:** `createPortal` + `z-[100]` + `backdrop-blur-md bg-black/95`.
- **Hooks primeiro:** `useState`/`useMemo` no topo; guards (`if (!data) return null`) só após todos os hooks.
- **Moeda:** Cripto → `$`; B3 → `R$`. Formatar com `Intl.NumberFormat`.
- Não criar CSS customizado quando Tailwind resolve.

---

## Convenções Backend

- **Ordem de middleware por rota:** `rateLimiter` → `authenticateToken` → `requireAdmin` (se admin) → handler.
- **Downgrade automático de plano:** `authMiddleware` verifica `validUntil` a cada request e rebaixa para GUEST se expirado — não duplicar essa lógica em handlers.
- **Snapshot diário TWRR:** `schedulerService.runDailySnapshot()` usa Modified Dietz (weight 0.5). Não recalcular performance histórica em query — usar `WalletSnapshot`.
- **Alias frontend:** `@` → `src/`. Proxy de dev: `/api` → `http://localhost:5000` (configurado no `vite.config.ts`).

---

## Contextos e Hooks (Frontend)

- **`AuthContext`** — `user{id, name, email, plan, role, subscriptionStatus}`, `isAuthenticated`, `login()`, `logout()`, `refreshProfile()`
- **`WalletContext`** — `assets[]`, `kpis{totalEquity, totalInvested, totalResult, totalDividends, sharpeRatio, beta}`, `isPrivacyMode`, `addAsset()`, `removeAsset()`. Demo mode retorna DEMO_ASSETS quando `isDemoMode=true`.
- **`ToastContext`** — `addToast(message, type: 'success'|'error'|'info')`, auto-dismiss 4s.
- **`DemoContext`** — inicia automaticamente se `user.hasSeenTutorial === false` (delay 1.2s). IDs: `tour-equity`, `tour-wallet-*`, etc.
- **Demo mode:** `WalletContext` injeta `DEMO_ASSETS` quando `isDemoMode=true`. Mutações de carteira devem checar `if (isDemoMode) return` antes de chamar a API.
- **`useDashboardData`** — React Query agregando macro (cache 15min), sinais (5min), dividendos (5min), research (1h).
- **Token refresh:** interceptor automático em 401; fila de requests aguarda novo token; redireciona para `/login` se refresh falhar.

---

## Integrações Externas

| Serviço | Package | Uso |
|---|---|---|
| Yahoo Finance | `yahoo-finance2` | Cotações primárias — ações, ETFs, índices, cripto |
| Google Finance | scraping `cheerio` | Fallback para dados faltantes |
| Brapi | HTTP | Fallback BR (token: `BRAPI_TOKEN`) |
| Fundamentus | scraping | Dados fundamentalistas BR (`fundamentusService.js`) |
| Gemini AI | `@google/genai` | Morning Call, narrativas (`API_KEY`) |
| Mercado Pago | `mercadopago` | Checkout/webhook (`MP_ACCESS_TOKEN`) |
| Sentry | `@sentry/node` + `@sentry/react` | Erros e performance (`SENTRY_DSN`) |
| Email | `nodemailer` | Reset senha, recibos (`SMTP_*`) |

---

## API (Base URL `/api`)

- **Auth:** `POST /register`, `/login`, `/logout`, `/refresh`, `/forgot-password`, `/reset-password`, `PUT /me`, `POST /tutorial-seen`
- **Research:** `GET /research/latest?assetClass`, `/research/macro`, `/research/signals`, `/research/discard-logs`, `/research/accuracy` · `POST /research/full-pipeline`, `/research/sync-market`, `/research/sync-macro`, `/research/publish`, `/research/crunch`
- **Wallet:** `GET /wallet`, `/wallet/history`, `/wallet/dividends`, `/wallet/cashflow`, `/wallet/transactions/:ticker`, `/wallet/performance` · `POST /wallet/add` · `PUT /wallet/:id` · `DELETE /wallet/:id`
- **Market:** `GET /market/quote?ticker`, `/market/price?ticker`, `/market/landing`
- **Subscription:** `GET /subscription/status`, `/subscription/check-access` · `POST /subscription/checkout`, `/subscription/register-usage`
- **Webhooks:** `POST /webhooks/mercadopago`
- **Academy:** `GET /academy/courses`, `/academy/lessons/:id`, `/academy/progress/:courseId` · `POST /academy/progress`, `/academy/quiz/submit`
