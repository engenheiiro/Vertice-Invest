# Cheat Sheet de Comandos — Vértice Invest

Referência oficial dos scripts npm (raiz). Verificado contra `package.json`.

---

## 1. Setup & Inicialização

```bash
npm run setup      # instala dependências (raiz + client + server)
npm run dev        # dev: frontend + backend + watchers (conecta ao MONGO_URI do .env)
npm start          # produção (sem nodemon/HMR): node server/index.js
```

- Frontend (Vite): http://localhost:5173 · Backend (Express): http://localhost:5000
- Swagger: http://localhost:5000/api/docs (fora de produção, ou `ENABLE_API_DOCS=true`)

## 2. Banco de dados & Manutenção

```bash
npm run migrate:fix                 # corrige tickers/typos + metadados (setores) sem apagar histórico
npm run seed:market                 # ⚠️ APAGA todos os ativos e recria a lista base limpa
npm run seed:wallet                 # popula uma carteira de exemplo completa (dev)
npm run seed:admin seu@email.com    # promove um usuário a ADMIN
npm run list:users                  # lista usuários (nome, email, plano, status, role, validade)
npm run set:plan seu@email.com PRO [dias]   # altera o plano (dias opc; padrão 365; status ACTIVE)
npm run set:password seu@email.com NovaSenha123   # redefine senha (mín. 6 chars)
```

### Migrações de dados (idempotentes — sempre `--dry` antes)

```bash
npm run migrate:wallets            # cria Wallet padrão por user + backfill de `wallet` nos docs
npm run repair:orphan-wallets      # repara docs com wallet=null (rodar DEPOIS de migrate:wallets)
npm run migrate:reserve-flag       # marca CASH → isReserve=true (--reclassify=TICKER p/ dirigido)
npm run backfill:sectors           # preenche setores faltantes
npm run backfill:logos             # preenche logos de ativos
```

> ⚠️ **Dev e prod compartilham o mesmo cluster/banco Atlas.** Faça `mongodump`
> e rode com `--dry` antes de qualquer migração. Ver [BACKLOG.md](BACKLOG.md) §0.

### Destrutivos (cuidado)

```bash
npm run drop:sample      # remove dados de amostra
npm run trim:history     # enxuga histórico
npm run cleanup:now      # limpeza imediata

# Ambos são DRY-RUN por padrão — só gravam com --apply.
npm run prune:crypto-series          # apaga séries de cripto órfãs (ticker nu, sem -USD)
npm run blacklist:dead-b3 -- --tickers=XPTO3   # marca ticker B3 morto (tira do sync e da reativação)
```

## 3. Inteligência & Dados (rotinas de produção)

```bash
npm run sync:prod              # protocolo V3 completo: cotações+macro → Fundamentus → IA/ranking → Radar
npm run snapshot:prod         # força o snapshot patrimonial diário (equivalente ao botão admin)
npm run scan:radar            # só Radar Alpha + backtest de sinais + auditoria (cron a cada 15min)
npm run radar:report          # gera reports/radar_latest.txt (sinais, win rate, diagnóstico)
npm run sync:TimeSeriesWorker # histórico de preços, SMA200/EMA50, volatilidade, beta (vs IBOV)
npm run sync:dividends        # popula DividendEvent dos tickers em carteiras (cron diário 04:00)
npm run rebuild:history       # reconstrói snapshots/histórico de rentabilidade
```

## 4. Backtest de Portfólio

```bash
npm run backtest:portfolio    # "e se eu tivesse comprado esse portfólio X atrás?" (interativo)
```

## 5. Testes & Qualidade

```bash
npm test                  # roda os testes do server + client (raiz)
npm run test:server       # unitários do backend (serviços, models, utils)
npm run test:all          # todos os testes do servidor (QA completo)
npm run test:client       # unitários do frontend (componentes, hooks)
npm run test:wallet       # carteira (snapshot, TWRR, circuit breaker, Sharpe, FIXED_INCOME)
npm run test:regression   # regressão financeira (TWRR, cotas, juros compostos vs gabarito)
npm run test:ingestion    # robustez do scraper (dados sujos do Fundamentus)
npm run test:backtest     # pega 5 ativos da época e compra o preço
npm run test:fundamentus  # testa o scraper do Fundamentus (detecta mudança de estrutura)
npm run lint              # ESLint (client + server)
npm run lint:fix          # ESLint com --fix
npm run typecheck         # lint do client + validação do server (roda no CI)
npm run format            # Prettier --write em todo o repo
npm run format:check      # Prettier --check (verificação sem escrever)
```

## 6. Build (Deploy)

```bash
npm run build             # build estático do React (produção) — alias de build:client
npm run build:client      # instala deps do client (--include=dev) + build do React
npm run build:server      # node --check em todo o backend (gate de sintaxe/import)
npm run build:all         # valida server + build do client
```

## 7. Changelog

```bash
npm run changelog         # gera/atualiza o CHANGELOG.md a partir dos commits
npm run changelog:first   # primeira geração (histórico completo)
```

## 8. Performance e baseline

As métricas leves ficam ativas por padrão. Use `PERF_METRICS_ENABLED=false`
somente se precisar desligá-las. Apenas durante uma janela de diagnóstico do
banco, habilite `PERF_MONGO_COMMANDS_ENABLED=true`. O snapshot agregado fica em
`GET /api/admin/performance-metrics` e exige usuário ADMIN.

```bash
# Benchmark HTTP somente leitura. Requer o backend rodando e um access token.
BENCHMARK_AUTH_TOKEN=... BENCHMARK_WALLET_ID=... npm run benchmark:http

# Explain somente leitura das queries críticas. Wallet/ticker são opcionais;
# sem wallet usa uma carteira existente, sem imprimir documentos ou ids.
BENCHMARK_WALLET_ID=... BENCHMARK_TICKER=PETR4 npm run benchmark:mongo

# Bundle detalhado (gera client/dist/stats.html).
npm run analyze --prefix client

# Baseline local de FCP/LCP/INP do build já gerado (Playwright/Chromium).
npm run benchmark:web

# A mesma coleta contra uma URL publicada (somente navegação GET).
BENCHMARK_WEB_URL=https://verticeinvest.com.br npm run benchmark:web
```

Controles opcionais: `BENCHMARK_ITERATIONS`, `BENCHMARK_WARMUP`,
`BENCHMARK_CONCURRENCY`, `BENCHMARK_SCENARIOS` e `BENCHMARK_QUERY_LIMIT`.
