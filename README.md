# Vértice Invest

Plataforma institucional de **análise quantitativa financeira** (Ações, FIIs e Cripto): rankings proprietários por perfil de risco, sinais técnicos, carteira com performance (TWRR/FIFO) e narrativas com IA.

Monorepo com frontend (React) e backend (Node/Express) rodando juntos via `concurrently`.

---

## Stack

| Camada | Tecnologias |
|---|---|
| **Frontend** (`/client`) | React 18 · TypeScript · Vite · Tailwind · React Router (BrowserRouter) · React Query v5 · Recharts · animações via CSS/Tailwind |
| **Backend** (`/server`) | Node.js (ES Modules) · Express 4 · MongoDB/Mongoose 8 · Winston · node-cron |
| **IA / Integrações** | Google Gemini (`@google/genai`) · Mercado Pago · Yahoo Finance · Brapi · Fundamentus · BCB · Sentry |
| **Qualidade** | Vitest · ESLint · Prettier · Husky + lint-staged · commitlint · GitHub Actions |

---

## Quickstart

Pré-requisitos: **Node 22+** (ver `engines` no `package.json`) e uma instância **MongoDB** (Atlas ou local).

```bash
# 1. Instala dependências (raiz + client + server)
npm run setup

# 2. Configure o ambiente do backend
cp .env.example .env   # preencha os valores (ver abaixo)

# 3. Rode em desenvolvimento (client + server juntos)
npm run dev
```

- Frontend (Vite): http://localhost:5173
- Backend (Express): http://localhost:5000 — proxy `/api` configurado no Vite
- Documentação da API (Swagger): http://localhost:5000/api/docs (dev; em produção só com `ENABLE_API_DOCS=true`)

---

## Scripts principais (raiz)

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe client + server (concurrently) |
| `npm test` | Roda os testes do server e do client |
| `npm run lint` | ESLint em todo o monorepo |
| `npm run typecheck` | Typecheck do client + validação do server |
| `npm run build:all` | Valida o server (`node --check`) + build do client |
| `npm run build:client` | Build de produção do frontend |
| `npm run build:server` | Gate de sintaxe do backend |
| `npm start` | Sobe o server em produção (`node server/index.js`) |

Scripts de operação (admin/seed) ficam em `server/scripts/` e têm atalhos na raiz (ex.: `npm run seed:admin`).

---

## Variáveis de ambiente (backend)

Veja [`.env.example`](.env.example) para a lista completa. As principais:

| Variável | Uso |
|---|---|
| `MONGO_URI` | Conexão MongoDB |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Assinatura dos tokens (access/refresh) |
| `API_KEY` | Google Gemini (Morning Call, narrativas) |
| `BRAPI_TOKEN` | Fallback de cotações BR |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago (checkout + webhook) |
| `SMTP_*` | Envio de email (reset de senha, recibos) |
| `SENTRY_DSN` | Monitoramento de erros |
| `CLIENT_URL` | Origem permitida no CORS |

Tunáveis opcionais (têm default): `PLAN_CACHE_TTL_MS`, `BUY_THRESHOLD`, `MAX_CRYPTO_PER_PROFILE`, `MARKET_CACHE_MINUTES`, `DEFAULT_SELIC_FALLBACK`.
Para upload de sourcemaps ao Sentry no build do client: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

> **Nunca** versione segredos. O `.env` é ignorado pelo git; o pre-commit bloqueia commits de `.env` e roda secret-scan.

---

## Testes

```bash
npm run test:server   # backend (Vitest)
npm run test:client   # frontend (Vitest + Testing Library)
npm test              # ambos
```

O CI (GitHub Actions) roda lint → typecheck → testes (com cobertura) → build em cada push/PR.

---

## Documentação

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — visão de arquitetura, engines e fluxo de dados.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — fluxo de desenvolvimento, convenções e padrões.
- [`CLAUDE.md`](CLAUDE.md) — diretrizes detalhadas (mapa de onde mexer, regras de negócio).
- [`planejamento/`](planejamento/) — backlog de pendências, cheat sheet de comandos e análises.
- [`AUDITORIA-PROMPT.md`](AUDITORIA-PROMPT.md) + [`RESULTADO-AUDITORIA.md`](RESULTADO-AUDITORIA.md) — prompt e baseline de auditoria técnica.
- Swagger em `/api/docs` (runtime).
