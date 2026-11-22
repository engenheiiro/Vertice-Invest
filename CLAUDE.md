# Vértice — Diretrizes para AI

Plataforma institucional de análise quantitativa financeira (Ações, FIIs, Cripto). Monorepo com `dev` rodando client + server via `concurrently`.

---

## Stack

- **Frontend** (`/client`): React 18 + TypeScript + Vite + Tailwind. Ícones: `lucide-react`. Gráficos: `recharts`. Data fetching: `@tanstack/react-query` v5. Roteamento: React Router v6 com **BrowserRouter** (o Express atende deep links da SPA). Animações: CSS/Tailwind (keyframes em `tailwind.config.js`; sem libs de animação).
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
| Importar carteira (parsers B3/Investidor10) | `client/src/components/wallet/import/parsers/` |
| Importar carteira (gravação em lote) | `server/services/portfolioImportService.js` |
| Dashboard, sinais, equity | `client/src/pages/Dashboard.tsx` |
| Planos e feature gating | `server/config/subscription.js` |
| Funil comercial (regras puras) | `server/utils/funnelMath.js` |
| Funil comercial (consulta + painel) | `server/services/funnelService.js`, `client/src/pages/admin/AdminFunilTab.tsx` |
| Consentimento de analytics / eventos | `client/src/utils/analyticsConsent.ts`, `client/src/utils/analytics.ts` |
| Suporte — regras do ticket (puras) | `server/utils/supportRules.js` |
| Suporte — serviço, rotas e anexos | `server/services/supportService.js`, `routes/supportRoutes.js` |
| Suporte — tela do usuário (widget + `/suporte`) | `client/src/components/support/SupportCenter.tsx` |
| Suporte — fila do Admin | `client/src/pages/admin/AdminSuporteTab.tsx` |
| Namespace do ticker canônico (colisão entre classes) | `server/config/tickerNamespace.js` |
| Setores macro | `server/config/sectorTaxonomy.js` |
| Constantes financeiras | `server/config/financialConstants.js` |
| Matemática financeira segura | `server/utils/mathUtils.js` |
| Câmbio de compra e custo em BRL | `server/utils/fxRate.js` |
| Data de pagamento de provento (fontes) | `server/services/dividendPaymentDateService.js` |
| Casamento provento nosso × calendário da fonte | `server/utils/dividendPaymentMatch.js` |
| Provento provisório derivado do gap do dia-ex | `server/utils/dividendGap.js` |
| Valorização de RF (curva × mercado) | `server/utils/fixedIncome.js` |
| Curva histórica do CDI (e quem precisa dela) | `server/utils/cdiCurve.js` |
| Série de PU do Tesouro (ingestão) | `server/services/treasuryPriceService.js` |
| Identidade de título do Tesouro | `server/utils/treasuryTitle.js` |
| Middleware JWT + downgrade + cache de plano | `server/middleware/authMiddleware.js`, `utils/userCache.js` |
| Guards de rota (auth/admin) | `client/src/components/auth/ProtectedRoute.tsx`, `AdminRoute.tsx` |
| Séries temporais (worker) | `server/services/workers/timeSeriesWorker.js` |
| MFA/2FA (TOTP) | `server/controllers/mfaController.js`, `utils/mfa.js` |
| Rate limiting por usuário | `server/middleware/rateLimiters.js` |
| Tunables editáveis (admin, sem deploy) | `server/services/configService.js` |
| Resiliência (retry + circuit breaker) | `server/utils/resilience.js` |
| Teto de duração de job (watchdog) | `server/utils/jobWatchdog.js`, `config/jobCatalog.js` |
| Correlation id (logs/tracing) | `server/middleware/correlationId.js`, `utils/requestContext.js` |

---

## Core Engines

### `scoringEngine.js`

Avalia cada ativo em **3 scores estruturais** (QUALITY / VALUATION / RISK, 0–100) e **3 perfis de risco** (DEFENSIVE / MODERATE / BOLD).

**Gate de elegibilidade:** `isEligibleForDefensive(asset)` — STOCK exige marketCap ≥ 1B, beta < 1.5, ROE ≥ 5%, setor seguro ou DY ≥ 6% + 0 < P/L ≤ 10. FII exige marketCap ≥ 500M, DY ≤ 18%, vacância ≤ 12%, liquidez ≥ 1M/dia. **Fail-closed:** beta ausente (`_missing.beta`, gravado como 0) ou ROE ausente **reprova** — antes um papel sem beta passava como se tivesse beta 0 (DEF 79 BUY num caso de teste). Beta negativo real passa. P/L ≤ 0 (prejuízo ou ausente) não entra pela rota "DY + P/L barato".

**Valuation:** Graham (√22.5 × LPA × VPA), Bazin (dividendo/6%), PEG (P/L ÷ crescimento), VP-adjusted (FIIs).

**Confidence score:** desconta dados ausentes ou stale; `confidence < 60` → `maxScoreAllowed = 70`; `60–79` → `85`; `≥ 80` → `100`. Cripto sempre 100.

**Desconto de confiança em AÇÕES é cumulativo (decisão de produto, documentada em 22/11/2026):** para STOCK e STOCK_US comum, o scorer legado primeiro **subtrai `100 - confidence`** de cada perfil e depois aplica o teto 70/85/100 pela mesma confiança. No ranking STOCK esse score já descontado entra na mescla com os eixos de calibração (80/20; petroleiras 20/80) e é tetado de novo pela confiança da calibração — que é o **mínimo** entre a confiança legada (`dataConfidence`, saída de `processAsset`) e a da calibração. O mínimo existe porque a calibração só penalizava dado velho/ausente no arquétipo OPERATIONAL: banco, seguradora, holding e petroleira saíam com 100 e um papel com fundamentos de 400 dias chegava a 74 BUY. Resultado: a mesma lacuna de dado pode pesar até três vezes — intencional (dado ruim não compra), mas não "simplifique" um dos descontos sem decidir isso de novo.

**Saída:** `scores{DEFENSIVE, MODERATE, BOLD}`, `auditLog[]`, `bullThesis[]`, `bearThesis[]`, `metrics.structural{quality, valuation, risk}`.

### `portfolioEngine.js`

**Draft competitivo** por perfil (DEFENSIVE → MODERATE → BOLD), cada um com até 10 ativos:
- **GOLD** (score ≥ 55): limite 3 ativos/setor no DEFENSIVE (4 no ranking de ações, via `STOCK_STRICT_SECTOR_CAP_BY_PROFILE`) ou 2 (outros)
- **SILVER** (score ≥ 40): limite 3/setor
- **BRONZE** (score > 30): backfill — usa `scoreKey` do perfil corrente; limite 3/setor

A contagem por setor é **compartilhada entre os tiers** do mesmo perfil: setor que já levou 4 no GOLD não recebe mais nada no SILVER/BRONZE.

**Concentração pós-draft:** 3º ativo mesmo setor → -5; 4º+ → -15. 3º FII mesmo gestor → -20. **Exceção — ranking de AÇÕES:** STOCK chama `performCompetitiveDraft` com `strictSectorCapByProfile { DEFENSIVE: 4 }` e **não** chama `applyConcentrationPenalty`: a concentração é limitada pelo teto de setor, não por penalidade de score. No relatório, `adminAudit.concentrationPenalty` de STOCK é `rawScore - score` (o teto de confiança), não penalidade de concentração.

Tiebreaker em todos os sorts: score → `(quality + valuation + risk) / 3`.

### `aiResearchService.js`

Fluxo: `scoringEngine` → `portfolioEngine` draft → penalidade concentração → sort global → delta vs relatório anterior → salva `MarketAnalysis` no MongoDB.

**Brasil 10:** top 5 STOCKs + top 5 FIIs por score DEFENSIVE, sem draft competitivo.

---

## Regras de Negócio Invioláveis

1. **Threshold Global = 70:** `score ≥ 70` → `BUY`; `score < 70` → `WAIT`. Vale em todo o sistema. É constante no código (servidor e um único `BUY_THRESHOLD` no client) — **não** existe override por `.env`: com a variável, o servidor seguiria um número e a tela outro.
2. **Ordenação soberana:** sempre `b.score - a.score`. Tiebreaker: composite estrutural.
3. **Perfis:** cada ativo no ranking tem exatamente um perfil (DEFENSIVE/MODERATE/BOLD). O frontend filtra `auditLog[]` pelo perfil do ativo.
4. **Delta de posição:** comparado com o último `MarketAnalysis` salvo (seta direcional no frontend).
5. **ES Modules:** backend usa `import/export`. Nunca `require()`.
6. **Secrets:** nunca hardcode. Usar variáveis do `.env`.
7. **Matemática financeira:** sempre usar `safeFloat()`, `safeCurrency()`, `safeAdd/Sub/Mult/Div()` de `mathUtils.js`. Nunca operar com floats brutos em valores monetários. **Preço unitário** passa por `safeUnitPrice()` (8 algarismos significativos abaixo de 1), nunca por `safeFloat()`: as 4 casas do dinheiro zeravam cripto sub-centavo (SHIB a US$ 0,00001 valia R$ 0).
8. **Câmbio congelado no custo:** custo de posição em dólar **nunca** é reconvertido pela cotação de hoje — use `positionCostBRL()`/`positionRealizedProfitBRL()` de `utils/fxRate.js`, que leem `totalCostBrl`/`realizedProfitBrl` (acumulados com o câmbio de cada lançamento em `recalculatePosition`). Multiplicar custo **e** saldo pela mesma taxa cancela o câmbio: o resultado vira retorno em dólar e o ganho cambial some. Só o **saldo** é marcado a mercado.
9. **Renda fixa: curva × mercado.** Todo caminho de patrimônio (KPI ao vivo, snapshot diário, rebuild de histórico, metas) valoriza CASH/FIXED_INCOME por `valueFixedIncomeAsset()` de `utils/fixedIncome.js` — nunca chamando `accrueFixedIncomeValue()` direto. Título público identificado sem ambiguidade e **sem cupom semestral** é marcado pelo PU oficial do Tesouro; o resto fica na curva. A marcação é por **razão de PU** sobre o custo do lote (`custo × PU_hoje / PU_compra`), nunca quantidade × PU: `quantity`/`price` de RF não seguem convenção confiável nas posições reais. Qualquer lote sem PU derruba a marcação do ativo inteiro (fail-closed → accrual). Divergir entre os caminhos reintroduz a divergência KPI × snapshot.
10. **Rate limiting em novas rotas:** usar os limiters **por usuário** de `middleware/rateLimiters.js` (`walletWriteLimiter` 50/15min em POST/PUT/DELETE de wallet; `researchHeavyLimiter` 20/15min em rotas caras). Auth já tem `authLimiter` (20/15min); geral `apiLimiter` (3000/15min). Validar escrita com schema Zod (`validate`).
11. **Data de pagamento de provento só vem de FONTE.** `DividendEvent.paymentDate` é preenchido apenas por `dividendPaymentDateService` (B3 no sync diário; Fundamentus no backfill manual), sempre com `paymentDateSource` junto. Nulo é o estado honesto: `resolvePaymentDate` cai na estimativa ex+15 e a tela marca "Previsto". **Nunca gravar data deduzida** — pagamento ambíguo (uma linha nossa somando pagamentos com datas diferentes), valor que não bate ou fonte fora do ar deixam o campo nulo. Como qualquer valor não-nulo é tratado como oficial, uma data inventada vira "Agendado" na tela: foi o defeito dos 442 eventos ex+16 apagados em 09/09/2026.
12. **Nota interna de ticket nunca cruza a fronteira.** O corte do que o usuário vê acontece no SERVIDOR (`serializeTicketForUser`), não na tela: nota interna, contexto técnico e etiquetas de triagem são removidos antes de o JSON sair. Filtrar no front deixaria o texto trafegando — mesma disciplina do link público de carteira, onde o valor sai normalizado da API em vez de mascarado no CSS.
13. **Nunca persistir número inventado como real.** Fonte que falhou deixa o campo como estava (último valor bom + flag de stale) ou nulo — nunca um default fixo. Foi o caso do retorno 12m do S&P/Ibov gravado como 32,50%/15,50%, da SELIC/IPCA 14,25/4,50, da NTN-B 6,30, das linhas diárias sintéticas da SELIC em `EconomicIndex`, do `dy = 0` por resposta parcial do Yahoo e do `marketCap = enterpriseValue`. Defaults de `SystemConfig` para indicadores são `null`. Na tela vale o mesmo: sem taxa, a Calculadora não simula e o badge USD/BRL some.
14. **Uma classe por sigla.** `MarketAsset.ticker` é `unique: true` — a chave é o ticker, não `{ ticker, type }`. Catálogo novo (ou moeda nova em `config/cryptoList.js`) não pode reivindicar sigla que outra classe já tem: o seed usa `filter: { ticker }` + `$setOnInsert`, então o segundo dono casa com a linha do primeiro, **não insere nada e não levanta erro** — e a cotação de um vaza para a linha do outro. `config/tickerNamespace.js` é o dono da regra, `tests/ticker_namespace.spec.js` trava o catálogo, e o seed de cripto consulta o BANCO antes de semear (fail-closed: sigla ocupada fica de fora, nomeada no log) porque a linha conflitante pode vir de onde nenhum catálogo alcança. Foi o defeito do `STX` — Stacks no catálogo, Seagate no S&P 500 —, que punha a ação a US$ 0,24 em todo run do sync até o refresh seguinte. Repetição dentro da MESMA classe não é colisão: deduplica mesclando (ver `US_UNIVERSE`).

---

## Modelos MongoDB (principais)

- **`MarketAsset`**: cache de dados de mercado. Campos chave: `ticker`, `type` (STOCK|FII|STOCK_US|CRYPTO), `sector`, métricas (`pl`, `roe`, `netMargin`, `dy`, `beta`, `volatility`, `marketCap`, `avgLiquidity`), flags (`isBlacklisted`, `isTier1`).
- **`MarketAnalysis`**: ranking salvo. `content.ranking[]` (RankingItem com `position`, `score`, `riskProfile`, `action`, `auditLog[]`, `metrics`) e `content.fullAuditLog[]`.
- **`SystemConfig`** (key `MACRO_INDICATORS`): cache macro — `selic`, `ipca`, `ntnbLong`, `riskFree`, `ibov`, `dollar`, `btc`.
- **`DiscardLog`**: ativos descartados por run — `runId`, `ticker`, `reason`, `details`.
- **`User`**: `plan` (GUEST|ESSENTIAL|PRO|ELITE|BLACK), `role` (USER|ADMIN), `subscriptionStatus`.
- **`UserAsset`**: holdings — `taxLots[]` para FIFO, `totalCost`, `realizedProfit`, `fifoRealizedProfit`. Índice único `{ user, ticker }`.
- **`WalletSnapshot`**: snapshot patrimonial diário — `equity`, `invested`, `result`, `twrr`, `dividends`. Gerado por `schedulerService.runDailySnapshot()`.
- **`QuantSignal`**: sinal técnico salvo — `ticker`, `type`, `strength`, `rsiValue`, `volumeRatio`.
- **`TreasuryPriceHistory`**: série diária de PU por título do Tesouro (`titleKey` `FAMILIA|YYYY-MM-DD`, `history[{date, pu, puBuy, rate}]`). Base da marcação a mercado da RF. Alimentada por `npm run sync:treasury` / cron de terça a sábado, de hora em hora das 12:30 às 20:30 até o pregão esperado (dia útil anterior) entrar — depois disso cada disparo é SKIPPED sem tocar no site.
- **`RefreshToken`**: tokens de refresh persistidos no banco — `token`, `user`, `expiresAt`.
- **`UsageLog`**: auditoria de uso por feature e plano.
- **`SupportTicket`**: atendimento — `code` (`VT-0042`), `category`, `status`, `priority`/`priorityRank`, `messages[]` (com `isInternal`), `context` (técnico), `planAtOpen`. Anexo NÃO mora aqui.
- **`SupportAttachment`**: imagem do ticket em coleção própria (listagem do Admin não arrasta base64; thread longa não estoura o teto de 16MB do documento).

---

## Planos e Acesso

Hierarquia: GUEST (0) < ESSENTIAL (1) < PRO (2) < ELITE (3) < BLACK (4). Definido em `server/config/subscription.js`.

| Feature | GUEST | ESSENTIAL | PRO | ELITE | BLACK |
|---|---|---|---|---|---|
| Carteira / Brasil 10 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sinais (delay) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Research STOCK/FII/Crypto/ETF | ❌ | ❌ | ✅ | ✅ | ✅ |
| Radar Alpha / Aporte Inteligente | ❌ | ❌ | ✅ | ✅ | ✅ |
| Ativos Globais (US/REIT) / Rebalanceamento IA | ❌ | ❌ | ❌ | ✅ | ✅ |

---

## Design System

- **Fundos (dark GitHub escurecido):** `#090C11` (deep/página, quase-preto), `#0F141A` (base/cards), `#141922` (card/headers), `#191F29` (panel/modais), `#202631` (elevated). Hue azul-grafite do mockup, ~2 passos mais fechado que o GitHub-dark padrão p/ evitar sensação "leitosa". Light mode sobrescreve (`#E4EAF4` página / branco cards). Tokens via CSS vars em `client/src/index.css`.
- **Largura de conteúdo:** trilho global `max-w-[1360px] mx-auto` (Header, MarketStatusBar, páginas largas); formulários/feeds em `1200px`.
- **Tipografia:** `Manrope` (Google Fonts, pesos 400–800).
- **Semáforo:** COMPRAR → `emerald-400/500`; AGUARDAR → `yellow-400/500`; perfis/risco → `blue-400/500` e `purple-400/500`; erros → `red-400/500`.
- **Modais:** `createPortal` + `z-[100]` + `backdrop-blur-md bg-black/95`. **Exceção:** o painel de Suporte (`SupportWidget`) usa `bg-black/40` sem desfoque — ali a tela atrás é o assunto do ticket, não distração, e o fundo opaco apagava o que a pessoa ia descrever. A separação vem da sombra, não da cor. Esse painel também **não é centralizado**: fica ancorado ao botão flutuante (canto inferior direito, deslocamento = posição do botão + `h-12` + respiro) e cresce para cima — centralizado, o painel curto boiava longe da bolinha que o abriu.
- **Hooks primeiro:** `useState`/`useMemo` no topo; guards (`if (!data) return null`) só após todos os hooks.
- **Moeda:** Cripto → `$`; B3 → `R$`. Formatar com `Intl.NumberFormat`.
- Não criar CSS customizado quando Tailwind resolve.

---

## Convenções Backend

- **Ordem de middleware por rota:** `rateLimiter` → `authenticateToken` → `requireAdmin` (se admin) → handler.
- **Downgrade automático de plano:** `authMiddleware` verifica `validUntil` a cada request e rebaixa para GUEST se expirado — não duplicar essa lógica em handlers.
- **Verbosidade de log:** `LOG_LEVEL` (terminal + arquivos) e `CONSOLE_LOG_LEVEL` (só terminal) no `.env` sobrepõem o padrão (`debug` em dev, `info` em prod). `CONSOLE_LOG_LEVEL=info` limpa o access log do terminal mantendo o `combined.log` completo. Nível inválido cai no padrão.
- **Corpo da requisição — 1mb, exceto suporte:** `express.json` global usa `limit: '1mb'`. `/api/support` tem parser PRÓPRIO de 3mb, montado antes do global (o body-parser marca `req._body` e o seguinte se abstém), porque é a única rota que recebe imagem no corpo. Esse teto e `MAX_ATTACHMENT_BYTES` (900KB × 3 anexos) são um par: mexer num sem o outro devolve **413 antes de a rota rodar**, e o usuário só vê "não foi possível". O contrato está travado em `tests/app_shell_contract.spec.js`.
- **Access log (`middleware/accessLog.js`):** nunca logar `req.originalUrl` nem query string crua — só `req.path` + metadados estruturados (`ms`, `walletId` **resolvido** de `req.walletId`). Entrada de cliente em linha de log vaza segredo futuro (`?token=`) e permite forjar linhas com quebra de linha.
- **Toda chamada externa tem relógio, e todo job tem teto.** Chamada a terceiro sem `timeout`/`AbortSignal` não falha — ela *fica*, e leva o job junto: nada conta erro, nada abre circuito, nada vira log, e a execução presa segura a memória do processo até o reinício (foi assim que `daily-morning` travou em 13–15/09/2026). No `externalMarketService` isso é contrato travado por teste (`tests/yahoo_call_timeout.spec.js`): chamada nova ao Yahoo passa por `comTeto()`. Por cima, todo cron roda dentro de `withJobWatchdog` com o `maxRuntimeMinutes` do `jobCatalog` (pior caso medido com folga larga) — **por dentro do lease, nunca por fora**, senão a execução derrubada continua renovando o lease e o job não roda mais. A sentinela acusa execução `RUNNING` além do teto: cron travado abre execução nova todo dia e por isso nunca aparece como silêncio. Quem abre um `JobRun` é quem o fecha, então deploy no meio do job deixa a linha aberta para sempre — `closeOrphanRuns()` varre isso no boot (só execução de OUTRA instância e mais velha que o teto do job; nunca a minha, nunca a de um processo que ainda cabe no próprio teto).
- **Desligamento gracioso (SIGTERM/SIGINT):** `utils/gracefulShutdown.js` fecha o HTTP, marca como FAILED só os `JobRun` RUNNING **desta** instância (motivo verdadeiro), solta os `JobLease` dela, desconecta o Mongo e esvazia o Sentry, com teto duro de 20s. Sem isso todo deploy deixava órfã e lease preso por 30 min. `closeOrphanRuns` roda no boot **e** a cada `data-health` (a órfã de um deploy ainda é mais nova que o teto no boot seguinte). `uncaughtException` esvazia o Sentry antes do `exit`. Lease que a renovação diz ter perdido é logado em ERROR.
- **Resultado do job volta ao `trackJob`:** `{ success:false, error }` → FAILED, `{ skipped:true }` → SKIPPED. Descartar o retorno grava SUCCESS: era o caso de `daily-snapshot` (core devolve `{status}`), `wallet-candle-recovery` PARTIAL, `holidays-sync` e `data-health` nulo. Rotina diária que encontra o lease de `full-sync` ocupado (sync manual rodando) é SKIP, não falha.
- **"Sem negócio" fora do pregão é inconclusivo:** o endpoint de cotação do Yahoo **zera `regularMarketVolume`** da última sessão fora do pregão (medido em 22/11/2026: PETR4/MGLU3 datados de 19/11 com volume 0, candle com 60M). Enquanto nenhum pregão começou depois da sessão datada (`isExpectedNoTrade`), a cotação não é gravada **nem conta falha** — antes todo fim de semana somava +1 `failCount` a ~450 papéis vivos.
- **Staleness de série em pregões, não em horas:** `isCandleDateStale(latest, now, type)` conta pregões desde o último candle (STOCK/FII: calendário B3; CRYPTO: dias corridos; resto: dias de semana — NY abre em feriado só brasileiro). Stale com mais de 1 pregão faltando. A régua em horas re-baixava ~1.200 séries iguais todo fim de semana/feriado/segunda (séries temporais 4m49s → 39s).
- **NTN-B lê a série já gravada:** `_ntnbFromStoredSeries` usa a "Taxa Venda Manha" de `TreasuryPriceHistory` quando ela chegou ao pregão esperado; o CSV de ~14 MB só é baixado se a série estiver atrasada (macro 34s → 4s).
- **Disparo de cron não é garantido por padrão:** o node-cron 3 perde o tick quando o laço de 1s pula o segundo :00 (0,2% dos disparos medidos em 04/11/2026, sem log e sem JobRun). `schedule()` passa `recoverMissedExecutions: true` por isso, sempre com `oncePerMinute` (`utils/cronTick.js`), porque a opção sozinha roda todo job duas vezes; travado em `tests/scheduler_missed_tick.spec.js`.
- **Scheduler em dev:** `DISABLE_SCHEDULER=true` no `.env` local impede que `initScheduler()` registre qualquer cron **e** dispare as rotinas de boot. Obrigatório na máquina do desenvolvedor: o `.env` local aponta para o Mongo de produção, então sem a flag o `npm run dev` executa as mesmas 18 rotinas do host, ao mesmo tempo e no mesmo banco. Não confundir com `EXTERNAL_SCHEDULER`, que só move os 3 jobs pesados para Render Cron Jobs — ambos default off, e nenhum dos dois deve calar o host.
- **O teto do heap tem de caber na instância.** `--max-old-space-size` do `npm start` governa a geração velha; o `heap_size_limit` que o V8 reporta é ele **mais ~192 MB** das outras áreas. Com o valor em 400 numa instância de 512 MB, o teto virava ~592 MB — maior que o container inteiro, e ainda sem contar o que roda **fora** do heap (código, pilhas, Buffer de download, o que o allocator nativo reteve). Um teto assim não protege nada: o container mata o processo antes de o V8 sentir pressão, e a morte vem como SIGKILL mudo em vez de OOM do V8 com stack e evento no Sentry. Hoje em **300** (teto de ~492 MB), contra 117 MB de heap em uso medidos em produção. Job que precise de mais de 300 MB de heap vivo não cabe nesta instância de jeito nenhum — o sinalizador só decide se ele morre diagnosticável ou em silêncio. `MEMORY_LIMIT_MB` (default 512) é o outro lado do par: é o denominador do card "Memória do servidor", e o painel **acusa** quando os dois se contradizem (`heapCeilingOverflow` em `PerformanceOverview.tsx`). Mexer num sem o outro reabre exatamente o vão que o alarme existe para fechar.
- **Memória se lê pela janela, não pela amostra.** `396 MB de 512` serve a dois diagnósticos opostos — repouso alto de um processo que nunca passa disso, ou vazamento a caminho do SIGKILL — e uptime não desempata. `performanceMetrics.js` amostra RSS/heap/external a cada 5 min (288 pontos, ~14 KB, ring buffer) e publica inclinação por mínimos quadrados em `runtime.memoryTrend`; o card julga por **nível E inclinação** (`worstVerdict`), então subida rumo ao teto em ≤24h condena o medidor mesmo com o nível folgado. Fail-closed em toda ponta: janela curta devolve `direction: null` (nunca "estável" por omissão), amostra dos primeiros 10 min é descartada (o boot é um piso que o processo não revisita, e a regressão pesa os extremos), e `hoursToLimit` só existe quando há subida. Quem escreve na série é o amostrador e **só ele** — gravar também a cada `getPerformanceSnapshot()` amarraria a densidade da série a quantos admins estão com a aba aberta. O terceiro número, `external`, separa Buffer vivo de retenção do allocator: muito fora do heap com pouco `external` é arena do glibc, e a resposta é `MALLOC_ARENA_MAX=2` **no ambiente do processo** — no `.env` não adianta, o dotenv lê depois de o allocator já ter decidido. O snapshot publica `runtime.mallocArenaMax` lido do ambiente justamente para a tela **não repetir conselho já aplicado**: conselho vencido que nunca apaga ensina a ignorar o bloco inteiro.
- **Rampa de aquecimento não é vazamento.** A subida das primeiras horas (cache enchendo, conexão abrindo, cada job rodando pela primeira vez) é **côncava**, e mínimos quadrados só sabem traçar reta: com esse começo dentro da janela, a regressão acusa subida num processo parado — em 19/09/2026 o card anunciou "+1,1 MB/h, encosta nos 512 MB em ~184h" com o RSS caindo de 330 para 324 havia 19h. A quarentena de 10 min não alcança isso. A saída não é calar nem alargá-la, é **medir se a inclinação está caindo**: `recentSlopeMbPerHour` (últimas 4h) ao lado da janela inteira. A janela longa continua decidindo `direction`, porque é ela que enxerga vazamento lento demais para aparecer em poucas horas; `decelerating` só liga quando o ritmo de AGORA é indistinguível de parado — critério **absoluto**, não razão entre as duas, porque "caiu pela metade" ainda pode ser 5 MB/h a caminho do teto. Desacelerando, `hoursToLimit` some (extrapolar reta de curva achatada põe na tela uma data que a medição não sustenta) e o medidor volta a ser julgado só pelo nível. Vazamento constante mantém as duas retas iguais e **não** é absolvido. A comparação só existe com janela ≥ 2× a recente: abaixo disso é a mesma reta medida duas vezes, e uma subida real seria perdoada por isso.
- **Séries temporais: o gargalo é o volume que desce do Atlas.** Medido em 30/10/2026 da máquina do desenvolvedor: leitura 24m33s de 25m36s da etapa (Yahoo 5s, gravação 2s). Por isso o `timeSeriesWorker` lê primeiro só o **cabeçalho** de cada série (`HISTORY_HEADER_PROJECTION`: último candle + tamanho, calculados no banco), pula o recálculo quando a série é a mesma do último cálculo (`MarketAsset.metricsSignature`), baixa candles só de quem mudou e só os campos usados (`METRICS_HISTORY_PROJECTION`), e a B3 estende a ponta com `$push` (`buildTipAppend`), nunca regravando a série. **Mudou a fórmula de beta/SMA/EMA/volatilidade/liquidez de ETF? Suba `METRICS_VERSION`** — sem isso a série igual mantém o número velho até entrar candle novo. A mescla do Yahoo é o único caminho que ainda baixa a série inteira, porque mesclar com menos encurtaria série profunda.
- **Provento no dia-ex:** o direito é de quem tinha o papel ao FIM do dia anterior. Em todos os caminhos (accrual, rebuild, snapshot, `calculateUserDividends`) o provento do dia D usa a quantidade **depois das transações com data < D**: compra no dia-ex não recebe, venda no dia-ex recebe. A cota ao vivo (`computeLiveQuota`) recebe o provento desde a âncora como `income`, igual ao snapshot.
- **Snapshot diário TWRR:** `schedulerService.runDailySnapshot()` usa Modified Dietz (weight 0.5). Não recalcular performance histórica em query — usar `WalletSnapshot`.
- **Zod 4 (schemas do servidor):** `required_error`, `invalid_type_error` e `errorMap` são **ignorados em silêncio** — o schema valida, mas a mensagem vira o padrão da Zod. Mensagem de tipo vai por `typeMessages({ required, invalid })` de `schemas/zodMessages.js`; enum/refino por `{ error: '...' }`. O `validate()` lê `issues` (não `errors`), devolve ao handler o resultado do parse mesclado ao corpo, e configura o padrão da Zod em pt-BR. Data de calendário: `calendarDate()`, que valida sem converter (o `z.coerce.date` desloca `YYYY-MM-DD` para o dia anterior em Brasília). Travado em `tests/zod4_messages.spec.js`.
- **Alias frontend:** `@` → `src/`. Proxy de dev: `/api` → `http://localhost:5000` (configurado no `vite.config.ts`).

---

## Contextos e Hooks (Frontend)

- **`AuthContext`** — `user{id, name, email, plan, role, subscriptionStatus}`, `isAuthenticated`, `login()`, `logout()`, `refreshProfile()`
- **`WalletContext`** — `assets[]`, `kpis{totalEquity, totalInvested, totalResult, totalDividends, sharpeRatio, beta}`, `isPrivacyMode`, `addAsset()`, `removeAsset()`. Demo mode retorna DEMO_ASSETS quando `isDemoMode=true`.
- **`ToastContext`** — `addToast(message, type: 'success'|'error'|'info')`, auto-dismiss 4s.
- **`DemoContext`** — inicia automaticamente se `user.hasSeenTutorial === false` (delay 1.2s). IDs: `tour-equity`, `tour-wallet-*`, etc.
- **Escopo de carteira:** `activeWalletId` é **derivado** da query `wallets` (nunca copiado para estado por efeito) e toda query/efeito escopado por carteira espera `isWalletScopeReady` no `enabled`. Sem isso a busca sai uma vez sem escopo e outra quando o id chega — duas idas ao servidor por carregamento.
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
| Tesouro Transparente | CSV oficial | PU diário dos títulos públicos + taxa NTN-B. Download compartilhado (memo 15min) entre `treasuryPriceService` e `macroDataService` |
| Gemini AI | `@google/genai` | Morning Call, narrativas (`API_KEY`) |
| Mercado Pago | `mercadopago` | Checkout/webhook (`MP_ACCESS_TOKEN`) |
| Sentry | `@sentry/node` + `@sentry/react` | Erros e performance (`SENTRY_DSN`) |
| Email | `nodemailer` | Reset senha, recibos (`SMTP_*`) |

---

## API (Base URL `/api`)

- **Auth:** `POST /register`, `/login` (aceita `mfaToken`; responde `{mfaRequired:true}` se MFA ativo), `/logout`, `/refresh`, `/forgot-password`, `/reset-password`, `PUT /me`, `POST /tutorial-seen`
- **MFA (auth):** `GET /mfa/status` · `POST /mfa/setup`, `/mfa/enable`, `/mfa/disable` (exige o código TOTP ou de recuperação — só a senha não desativa). Cada passo TOTP vale uma vez (`mfaLastUsedStep`); 5 erros de segundo fator → bloqueio de 15 min (429); ligar/desligar MFA rotaciona a sessão (`sessionVersion` + refresh tokens revogados)
- **Research:** `GET /research/latest?assetClass`, `/research/macro`, `/research/signals`, `/research/discard-logs`, `/research/accuracy`, `/research/config/tunables`, `/research/dividend-payment-dates/backfill` (progresso do job; admin) · `POST /research/full-pipeline`, `/research/sync-market`, `/research/sync-macro`, `/research/publish`, `/research/crunch`, `/research/dividend-payment-dates/backfill` (dispara e responde na hora; admin) · `PUT /research/config/tunables` (admin)
- **Docs:** `GET /api/docs` (Swagger UI), `/api/docs.json` (OpenAPI) · `GET /api/health`
- **Wallet:** `GET /wallet`, `/wallet/history`, `/wallet/dividends`, `/wallet/cashflow`, `/wallet/transactions/:ticker`, `/wallet/performance` · `POST /wallet/add` · `PUT /wallet/:id` · `DELETE /wallet/:id`
- **Import de carteira:** `GET /wallet/import` · `POST /wallet/import/preview` (resolve, não escreve), `/wallet/import/commit` · `DELETE /wallet/import/:batchId` (desfaz o lote)
- **Market:** `GET /market/quote?ticker`, `/market/price?ticker`, `/market/landing`
- **Subscription:** `GET /subscription/status`, `/subscription/check-access` · `POST /subscription/checkout`, `/subscription/register-usage`
- **Admin:** `GET /admin/funnel?months` (admin) — coortes, ativação, conversão 30d, receita, retenção e origem, lidos do banco
- **Webhooks:** `POST /webhooks/mercadopago`
- **Suporte:** `GET /support/meta`, `/support/tickets`, `/support/tickets/:id`, `/support/attachments/:id` · `POST /support/tickets`, `/support/tickets/:id/reply` (409 `needsNewTicket` quando a thread já encerrou)
- **Suporte (admin):** `GET /support/admin/summary`, `/support/admin/tickets`, `/support/admin/tickets/:id`, `/support/admin/export.csv` · `POST /support/admin/tickets/:id/reply` · `PUT /support/admin/tickets/:id` · `DELETE /support/admin/tickets/:id` (exclusão definitiva, com registro em AuditLog)
- **Academy:** `GET /academy/courses`, `/academy/lessons/:id`, `/academy/progress/:courseId` · `POST /academy/progress`, `/academy/quiz/submit`
