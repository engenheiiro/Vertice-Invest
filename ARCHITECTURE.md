# Arquitetura — Vértice Invest

Visão de alto nível. Detalhes operacionais e "onde mexer" estão em [`CLAUDE.md`](CLAUDE.md).

---

## Visão geral

Monorepo com dois apps:

```
/client   SPA React (Vite) — UI, gráficos, carteira, research
/server   API Node/Express (ESM) — engines, ingestão de dados, auth, pagamentos
```

O frontend consome a API em `/api` (proxy em dev; mesma origem em prod, onde o Express também serve o `client/dist`).

---

## Backend

### Camadas

```
routes/        → definição de endpoints + middlewares (auth, rate limit, validação)
controllers/   → orquestram request/response
services/      → regras de negócio e integrações externas
  engines/     → núcleo quantitativo (scoring, portfolio, sinais)
models/        → schemas Mongoose
middleware/    → auth, sanitização, rate limiters, correlation id
config/        → constantes, logger, subscription, swagger
utils/         → matemática financeira, datas, resiliência, MFA, caches
```

### Pipeline quantitativo

O coração do produto é a geração do ranking, orquestrada por `aiResearchService`:

```
scoringEngine        → avalia cada ativo em 3 scores estruturais (quality/valuation/risk)
                       e 3 perfis (DEFENSIVE/MODERATE/BOLD); aplica gates de elegibilidade
                       e um confidence score que limita a nota com dados ausentes/stale
        ↓
portfolioEngine      → draft competitivo por perfil (tiers GOLD/SILVER/BRONZE) com
                       limites de concentração por setor/gestor
        ↓
penalidade de concentração → ajusta scores por excesso no mesmo setor/gestor de FII
        ↓
sort global + delta vs. relatório anterior → salva MarketAnalysis no MongoDB
```

Regras invioláveis (ver `CLAUDE.md`): threshold de compra em **70**, ordenação soberana por score (desempate por composite estrutural), um perfil por ativo.

### Ingestão de dados de mercado

`marketDataService` busca cotações com fallback em cascata e resiliência (D11/I4):

```
Yahoo Finance (primário, com retry)
   → Google Finance (scraping, circuit breaker)
      → Brapi (circuit breaker)
```

Macro (SELIC/IPCA/CDI/Ibov) vem do BCB via `macroDataService`, cacheado em `SystemConfig`. Fundamentos BR via scraping (`fundamentusService`).

### Modelos principais (MongoDB)

- **`MarketAsset`** — cache de dados de mercado por ticker.
- **`MarketAnalysis`** — ranking salvo (`content.ranking[]`).
- **`SystemConfig`** — cache macro (`MACRO_INDICATORS`) e tunables operacionais (`APP_TUNABLES`).
- **`User`** — plano, role, assinatura, MFA.
- **`UserAsset`** — holdings com `taxLots[]` (FIFO), custo e lucro realizado.
- **`WalletSnapshot`** — snapshot patrimonial diário (TWRR via Modified Dietz).
- **`AssetTransaction`** — transações da carteira.

### Segurança (defesa em camadas)

- JWT Bearer (access) + refresh token httpOnly `SameSite=Strict` persistido no banco.
- `helmet` (HSTS/CSP), CORS com allowlist, rate limiting global + por usuário em rotas caras.
- Sanitização anti-injeção NoSQL/prototype-pollution antes das rotas.
- Validação de entrada com Zod nas rotas de escrita.
- MFA/2FA opcional (TOTP) opt-in.
- Cache de plano no `authMiddleware` (TTL curto) com guarda contra plano pago vencido.
- Correlation id (`x-request-id`) em todos os logs e na resposta.

### Jobs agendados

`schedulerService` (node-cron): snapshot patrimonial diário, sincronização de mercado/macro, expiração de assinaturas.

---

## Frontend

```
pages/         → telas (Dashboard, Wallet, Research, Profile, admin/...)
components/    → UI por domínio (wallet/, research/, dashboard/, admin/) + ui/ (primitivos)
contexts/      → AuthContext, WalletContext, ToastContext, DemoContext
hooks/         → useDashboardData (React Query), useFeatureAccess, usePriceFetch, ...
services/      → camada de chamada à API (auth, market, research, subscription)
```

- **Roteamento:** React Router com BrowserRouter; rotas protegidas por `ProtectedRoute`/`AdminRoute`. O Express atende deep links da SPA, inclusive retornos do Mercado Pago.
- **Dados:** React Query agrega macro, sinais, dividendos e research com `staleTime` por domínio.
- **Auth:** interceptor de refresh automático em 401, com fila de requisições aguardando o novo token.
- **Code splitting:** abas pesadas (ex.: Wallet) carregam via `React.lazy`.
- **PWA:** service worker (Workbox) com precache do shell e estratégias de cache por tipo de requisição.

---

## Planos e acesso

Hierarquia `GUEST < ESSENTIAL < PRO < ELITE < BLACK`, definida em `server/config/subscription.js`. O gating é aplicado no backend (middleware + checagens) e refletido no frontend (`useFeatureAccess`).

---

## CI/CD

GitHub Actions em cada push/PR: `lint → typecheck → testes (com cobertura) → build server (gate de sintaxe) → build client`. Dependabot mantém dependências atualizadas; `npm audit` roda como passo informativo.
