# Resultado da Auditoria Técnica — Vértice Invest

> Executada conforme [AUDITORIA-PROMPT.md](AUDITORIA-PROMPT.md). Data: 2026-07-02.
> Papel: arquiteto sênior + auditor de segurança + revisor quantitativo.
> Toda evidência cita `arquivo:linha` verificada no código atual. Suposições marcadas `[SUPOSIÇÃO]`.

---

## Status de implementação (2026-07-02)

Os achados priorizados foram **corrigidos e testados** (suíte server: 69 arquivos / 647 testes verdes, incluindo 2 novos specs). Nada foi commitado ainda.

| # | Correção aplicada | Arquivos |
|---|---|---|
| F1 | Gate de plano por classe em `getLatestReport` (STOCK/FII/CRYPTO/ETF → PRO; STOCK_US/REIT → ELITE; BRASIL_10 mantido aberto para não contradizer CLAUDE.md) | `researchController.js` + `tests/research_gating.spec.js` (novo) |
| F2 | `unique+sparse` em `Transaction.gatewayId`; `Transaction.create` como barreira atômica antes de estender plano, com captura de `E11000`, no webhook **e** no `syncPayment` | `models/Transaction.js`, `webhookController.js`, `subscriptionController.js` + `tests/webhook_idempotency_barrier.spec.js` (novo) |
| F3 | Snapshot diário de renda fixa passa a usar `accrueFixedIncomeValue` (respeita `fixedIncomeIndex`/`spread`) — paridade com o KPI live | `schedulerService.js` |
| F4 | Cotações do snapshot em lote (`getMarketDataMap` uma vez por run) — elimina o N+1 | `schedulerService.js` |
| F5 | Rotação de refresh token (uso único) + detecção de reuso (revoga a família) + janela de graça de 15s para não deslogar abas concorrentes | `authController.js` |
| F6 | `changePasswordLimiter` (10/15min por usuário) em `/change-password` | `rateLimiters.js`, `authRoutes.js` |
| F7 | Swagger/`/api/docs` só fora de produção (ou com `ENABLE_API_DOCS=true`) | `app.js` |
| F8 | Comentário de índice de `DividendEvent` corrigido | `financialService.js` |
| F9 | Expurgo do `dividendHealAt` (teto + limpeza de expirados) | `walletController.js` |
| F10 | `.env.example` documenta `EXTERNAL_SCHEDULER`, `PLAN_CACHE_TTL_MS`, `RENDER_EXTERNAL_URL`, `ENABLE_API_DOCS` | `.env.example` |

**Pendente (nits, não implementados):** F11 (RSI Wilder), F12 (remover `confirmPayment` morto), F13 (política de merge de `taxLots`). **Ação operacional recomendada:** ao aplicar F2 em produção, checar/limpar duplicatas pré-existentes de `Transaction.gatewayId` antes de o índice único ser construído (senão a criação do índice falha).

---

## Confirmação de escopo (3 linhas)

1. Auditei fio a fio as 3 jornadas críticas (pipeline de research, carteira/FIFO/snapshot, checkout→webhook→plano→gating), a camada de segurança transversal (auth/JWT/MFA/encryption/CSRF/rate-limit/sanitização) e fiz varredura dirigida por camadas + greps sistemáticos (ES Modules, floats brutos, `Math.random`/`Date.now`, secrets).
2. O código está, no geral, **acima da média em maturidade**: matemática monetária centralizada em `mathUtils`, dedup de proventos por identidade canônica, CSRF double-submit, cifragem AES-256-GCM versionada, rate limiting por usuário e CI com lint+typecheck+test+audit+secret-scan.
3. Os achados de maior impacto são **broken access control** (research pago STOCK/FII/CRYPTO não é barrado no backend) e **integridade de cobrança** (idempotência de webhook não-atômica, sem índice único), além de uma **divergência de correção financeira** no snapshot diário de renda fixa indexada.

---

## Plano e método da auditoria (o que foi feito)

| Etapa | Alvo | Status |
|---|---|---|
| 1 | Jornada (a) research: `scoringEngine` → `portfolioEngine` → `aiResearchService` → `Research.tsx`/`AssetDetailModal` | ✅ |
| 2 | Jornada (b) carteira: `walletController` → `financialService` (FIFO/rebuild) → `schedulerService.runDailySnapshot` → `WalletContext` | ✅ |
| 3 | Jornada (c) pagamento: `subscriptionController`/`paymentService` → `webhookController` → `authMiddleware`/`subscription.js` | ✅ |
| 4 | Segurança: `authController`, `authMiddleware`, `mfa`, `encryption`, `csrf`, `sanitize`, `rateLimiters`, `app.js` (helmet/cors) | ✅ |
| 5 | Varredura + greps: `require(`, floats brutos, `Math.random`, `Date.now`, secrets, `.env.example`, CI, testes | ✅ |

**Cobertura de regras invioláveis (checklist):** 1 (threshold 70) ✅ centralizado em `financialConstants.BUY_THRESHOLD`; 2 (sort soberano + tiebreaker composite) ✅ em `portfolioEngine`/`aiResearchService`; 3 (perfil único filtra auditLog) ✅ `AssetDetailModal.tsx:34`; 4 (delta de posição) ✅ `calculateRankingDelta`; 5 (ES Modules) ✅ nenhum `require(` no código-fonte; 6 (secrets no `.env`) ✅ nenhum segredo hardcoded; 7 (matemática via `mathUtils`) ✅ na carteira live — **exceção no snapshot diário** (ver F3); 8 (rate limit + Zod na escrita) ✅ nas rotas de wallet/research.

---

## 1. Sumário executivo

**Saúde geral: BOA, com dois pontos de atenção que tocam dinheiro/acesso pago.** A lógica quantitativa é determinística (sem `Math.random`/timezone no ranking), a matemática monetária da carteira é sólida e a superfície de segurança está bem coberta (CSRF, cifragem em repouso, MFA/TOTP, sanitização NoSQL, rate limiting por usuário, downgrade automático de plano). Não encontrei alucinações de vulnerabilidade nem falhas triviais de auth. Os riscos concentram-se em **enforcement de plano no backend** e **integridade transacional de cobrança**.

**Top 5 riscos:**
1. 🟠 **Research pago (STOCK/FII/CRYPTO) não é gated no backend** — só STOCK_US/REIT são barrados; qualquer usuário autenticado (inclusive ESSENTIAL) pode ler o ranking PRO via API.
2. 🟠 **Idempotência do webhook MP é check-then-act sem índice único** em `Transaction.gatewayId` — entregas duplicadas concorrentes do MP podem creditar +30 dias em dobro e duplicar registros de cobrança.
3. 🟡 **Snapshot diário de renda fixa ignora `fixedIncomeIndex`/`fixedIncomeSpread`** — o patrimônio histórico de Tesouro Selic/IPCA diverge do KPI live (que usa `accrueFixedIncomeValue`).
4. 🟡 **`runDailySnapshot` é O(usuários × ativos) com N+1 de cotação** e carrega todos os usuários em memória sob `--max-old-space-size=400` — risco de lentidão/OOM ao escalar.
5. 🟡 **Refresh token não é rotacionado** no `/refresh` — um token vazado vale os 7 dias inteiros, sem detecção de reuso.

**Veredito:** Aprovado para produção **após** corrigir F1 e F2 (baixo esforço, alto impacto). F3–F5 são de correção incremental. A base de testes é ampla (69 specs server) mas tem **lacunas cegas** exatamente nos pontos F1/F2/F3.

---

## 2. Tabela de achados (ordenada por severidade)

| # | Sev | Categoria | Arquivo:linha | Descrição | Impacto | Correção | Esf | Conf |
|---|---|---|---|---|---|---|---|---|
| F1 | 🟠 Alto | Segurança | `controllers/researchController.js:414-426` | `getLatestReport` só gateia `STOCK_US`/`REIT` (research_global). STOCK/FII/CRYPTO ficam só com `authenticateToken`+read-limiter | Feature PRO acessível a ESSENTIAL/qualquer autenticado via `GET /research/latest?assetClass=STOCK` | Barrar por `research_general` (PRO+) para STOCK/FII/CRYPTO; barrar BRASIL_10 por `research_br10` | S | Alta |
| F2 | 🟠 Alto | Segurança/Financeiro | `controllers/webhookController.js:95-99,120-150` + `models/Transaction.js:9` | Idempotência = `findOne(gatewayId)` não-atômico; `gatewayId` sem índice único. `syncPayment` tem o mesmo padrão | Entregas duplicadas do MP (comportamento normal) em corrida → +30 dias em dobro + Transaction duplicada | Índice `unique` em `gatewayId`; capturar `E11000` como "já processado"; concessão de plano dentro de transação | S | Alta |
| F3 | 🟡 Médio | Financeiro/Correção | `services/schedulerService.js:85-117` vs `utils/fixedIncome.js:77-113` | Snapshot recomputa RF só por `fixedIncomeRate` (>50 = %CDI), ignorando `fixedIncomeIndex`/`fixedIncomeSpread` | Patrimônio histórico de Tesouro Selic/IPCA/indexado ≠ KPI live; gráfico de evolução distorce RF indexada | Reusar `accrueFixedIncomeValue(asset, {cdiRate, selic, ipca, calcDate})` no snapshot | M | Alta |
| F4 | 🟡 Médio | Performance | `services/schedulerService.js:61,74,122,192` | `User.find({})` sem batch + laço aninhado com `getMarketDataByTicker` por ativo/usuário (N+1) + `calculateUserDividends` por usuário | Snapshot lento e com pico de memória; risco de OOM sob `--max-old-space-size=400` ao escalar | Pré-carregar cotações em lote (`getMarketDataMap`); paginar usuários; reusar KPIs | M | Média |
| F5 | 🟡 Médio | Segurança | `controllers/authController.js:260-292` | `/refresh` emite novo access token mas **não rotaciona** o refresh token nem detecta reuso | Refresh token vazado é válido 7 dias; sem trilha de reuso | Rotação: apagar o hash usado e emitir novo cookie a cada refresh; detectar reuso do hash já consumido | M | Alta |
| F6 | 🟡 Médio | Segurança | `routes/authRoutes.js:25` | `POST /change-password` sem rate limiter dedicado (só `apiLimiter` 3000/15min); faz `bcrypt.compare` da senha atual | Brute-force da senha atual em sessão sequestrada com orçamento amplo | Adicionar limiter apertado (ex.: 10/15min por usuário) como em delete/deactivate | S | Média |
| F7 | 🔵 Baixo | DevOps | `app.js:67-68` | Swagger UI (`/api/docs`) e `/api/docs.json` expostos incondicionalmente, inclusive em produção | Divulga toda a superfície da API a não-autenticados | Guardar atrás de `NODE_ENV !== 'production'` ou `requireAdmin` | S | Alta |
| F8 | 🔵 Baixo | Arquitetura | `services/financialService.js:536-537` | Comentário afirma índice único `ticker+date+amount`, mas o índice real é `{ticker,date,type}` (`models/DividendEvent.js:30`) | Documentação enganosa induz erro em manutenção futura | Corrigir o comentário | S | Alta |
| F9 | 🔵 Baixo | Performance | `controllers/walletController.js:936-937` | `dividendHealAt` é `Map` global sem expurgo (cresce 1 entrada por usuário para sempre) | Vazamento lento de memória no processo | TTL/limpeza periódica ou `lru`; `userCache` já tem cap — replicar | S | Média |
| F10 | 🔵 Baixo | DevOps | `.env.example` vs código | Faltam `EXTERNAL_SCHEDULER`, `PLAN_CACHE_TTL_MS`, `RENDER_EXTERNAL_URL`, `CSP_ENABLED` no `.env.example` (todos têm default) | Onboarding/ops perde flags operacionais relevantes | Documentar as flags no `.env.example` | S | Alta |
| F11 | ⚪ Nit | Correção | `services/engines/signalEngine.js:16-34` | `calculateRSI` usa média simples dos primeiros 15 preços (não suavização de Wilder sobre a série) | RSI levemente diferente do padrão de mercado; consistente internamente | Opcional: Wilder smoothing; documentar a escolha | M | Alta |
| F12 | ⚪ Nit | Arquitetura | `controllers/subscriptionController.js:242-257` | `confirmPayment` (`POST /subscription/confirm`) retorna `success:true` sem conceder plano — endpoint morto/enganoso | Confusão; falsa sensação de sucesso a clientes | Remover ou marcar claramente como no-op de teste | S | Alta |
| F13 | ⚪ Nit | Correção | `services/financialService.js:765-784` | Merge de `taxLots` quando `> 500` colapsa os 100 mais antigos em 1 lote médio | Distorce ordem FIFO exata para IR em tickers muito ativos | Elevar limite ou preservar lotes p/ apuração fiscal | M | [SUPOSIÇÃO] |

---

## 3. Deep-dives dos achados 🟠

### F1 — Research pago (STOCK/FII/CRYPTO) sem gating autoritativo no backend

**Código atual** (`controllers/researchController.js:414-426`):
```js
export const getLatestReport = async (req, res, next) => {
    const { assetClass, strategy } = req.query;
    // REIT é gerado do universo do Exterior (STOCK_US) → mesmo gate de plano (Elite/Black).
    if (assetClass === 'STOCK_US' || assetClass === 'REIT') {
        const userPlan = req.user?.plan || 'GUEST';
        const isAdmin = req.user?.role === 'ADMIN';
        const hasAccess = isAdmin || (LIMITS_CONFIG['research_global']?.[userPlan] > 0);
        if (!hasAccess) return res.status(403).json({ message: 'Ativos Globais...' });
    }
    const report = await MarketAnalysis.findOne({ assetClass, strategy, $or: [...] })...
```
A rota (`routes/researchRoutes.js:41`) é `router.get('/latest', researchReadLimiter, getLatestReport)` — **apenas** `authenticateToken` (router.use) + read-limiter. Não há `requirePlan`/gate para STOCK/FII/CRYPTO.

**Regra de negócio violada** (CLAUDE.md e `subscription.js:56`): `research_general` (STOCK/FII/Crypto) exige PRO+; ESSENTIAL/GUEST = 0. O backend **tem** essa configuração mas nunca a consulta para essas classes.

**Cenário de exploração concreto:** usuário no plano ESSENTIAL (ou qualquer conta autenticada, incluindo GUEST autenticado) faz:
```
GET /api/research/latest?assetClass=STOCK&strategy=BUY_HOLD
Authorization: Bearer <token ESSENTIAL>
```
→ recebe o ranking completo STOCK publicado (score, ação BUY/WAIT, teses, targetPrice). O mesmo vale para `FII` e `CRYPTO`. O frontend esconde o botão via `useFeatureAccess`, mas a autorização não é feita onde importa (servidor).

**Patch sugerido:**
```js
// Mapa classe → feature de plano
const RESEARCH_FEATURE = {
  STOCK: 'research_general', FII: 'research_general', CRYPTO: 'research_general',
  STOCK_US: 'research_global', REIT: 'research_global',
  ETF: 'research_general', BRASIL_10: 'research_br10',
};
const feature = RESEARCH_FEATURE[assetClass];
if (feature) {
  const userPlan = req.user?.plan || 'GUEST';
  const isAdmin = req.user?.role === 'ADMIN';
  if (!isAdmin && !(LIMITS_CONFIG[feature]?.[userPlan] > 0)) {
    return res.status(403).json({ message: `Recurso indisponível no plano ${userPlan}.` });
  }
}
```

---

### F2 — Idempotência do webhook Mercado Pago é check-then-act, sem índice único

**Código atual** (`controllers/webhookController.js:95-150`, resumido):
```js
const existingTransaction = await Transaction.findOne({ gatewayId: resourceId.toString() });
if (existingTransaction) return res.status(200).send('OK');            // (A) checagem
const payment = await paymentService.getPaymentStatus(resourceId);
...
if (status === 'approved' && userId) {
    const user = await User.findById(userId);
    let newValidUntil = new Date();
    if (user.validUntil && new Date(user.validUntil) > now) newValidUntil = new Date(user.validUntil);
    newValidUntil.setDate(newValidUntil.getDate() + 30);              // (B) +30 dias
    user.plan = plan; user.validUntil = newValidUntil; await user.save();
    await Transaction.create({ ..., gatewayId: resourceId.toString() }); // (C) sem unique
}
```
`models/Transaction.js:9`: `gatewayId: { type: String }` — **sem `unique: true`, sem índice**.

**Cenário de quebra concreto:** o Mercado Pago **envia notificações duplicadas** para o mesmo `payment.id` (retries por timeout e múltiplos tópicos). Duas entregas concorrentes:
- ambas passam por (A) porque nenhuma `Transaction` foi commitada ainda;
- se a entrega 2 lê `user.validUntil` **depois** da entrega 1 salvar (base = `now+30`), ela grava `now+60` → **60 dias pelo preço de um**;
- ambas executam (C) → **duas linhas** de cobrança para o mesmo pagamento (relatório financeiro inflado).

A rota redundante `syncPayment` (`subscriptionController.js:196-228`) tem o mesmo padrão e pode correr contra o webhook.

**Patch sugerido:**
```js
// models/Transaction.js
gatewayId: { type: String, index: true, unique: true, sparse: true },

// webhookController — troca o create por upsert atômico e usa o resultado como trava
try {
  await Transaction.create({ user: user._id, plan, amount, status: 'PAID', method, gatewayId: resourceId.toString() });
} catch (e) {
  if (e.code === 11000) { logger.info(`♻️ ${resourceId} já processado (índice único).`); return res.status(200).send('OK'); }
  throw e;
}
// Idealmente: criar a Transaction ANTES de estender o plano, para que o índice único seja a barreira de idempotência.
```

---

## 4. Deep-dives dos achados 🟡 (resumidos com patch)

### F3 — Snapshot diário diverge do KPI live em renda fixa indexada
`schedulerService.js:85-96` calcula o fator diário só a partir de `asset.fixedIncomeRate` (regra legada `>50 = %CDI`, senão prefixado), **ignorando** `fixedIncomeIndex`/`fixedIncomeSpread`. Já existe a fonte única canônica `accrueFixedIncomeValue`/`assetDailyFactor` (`utils/fixedIncome.js:77-113`), usada pelo `walletController` (KPI live) — que compõe SELIC/CDI/IPCA + spread. Um Tesouro IPCA+ é tratado no snapshot como ~100% CDI. Como todos os snapshots usam o mesmo método (errado), o TWRR interno é consistente, mas o **valor de patrimônio histórico** exibido no gráfico não bate com o KPI. **Fix:** substituir o bloco 85-117 por chamada a `accrueFixedIncomeValue(asset, { cdiRate: currentCdi, selic: sysConfig?.selic, ipca: sysConfig?.ipca, calcDate })`.

### F4 — `runDailySnapshot`: N+1 e memória
`User.find({}).select('_id email')` (linha 61) carrega todos os usuários; para cada um, laço sobre `UserAsset` com `marketDataService.getMarketDataByTicker(asset.ticker)` (linha 122) — 1 query por ativo por usuário — e `calculateUserDividends` (linha 192). Com o processo limitado a `--max-old-space-size=400`, isso escala mal. **Fix:** coletar todos os tickers uma vez, `getMarketDataMap` em lote, paginar usuários (cursor), e reaproveitar `calculateLiveKPIS`/`accrueFixedIncomeValue`.

### F5 — Refresh token sem rotação
`authController.js:260-292`: valida o hash no banco, emite novo access token e **mantém** o mesmo refresh token/cookie. Sem rotação, um refresh token exfiltrado é utilizável por 7 dias e o reuso não é detectável. **Fix:** a cada refresh, `findByIdAndDelete` do hash usado + `RefreshToken.create` novo + reemitir cookie; se um hash já apagado reaparecer, tratar como reuso e invalidar toda a família (revogar sessões do usuário).

### F6 — `/change-password` sem limiter apertado
`authRoutes.js:25` só herda `apiLimiter` (3000/15min). As rotas irmãs sensíveis (`/me` delete, `/me/deactivate`) têm limiters dedicados. **Fix:** aplicar um `createUserLimiter({ windowMs: 15*60*1000, max: 10 })`.

---

## 5. Lacunas de teste (com casos propostos)

A suíte (69 specs server) cobre bem engines, FIFO, dedup de proventos, Dietz/TWRR e MFA — mas tem **cobertura cega** exatamente nos achados acima:

| Lacuna | Teste proposto (arrange / act / assert) |
|---|---|
| **F1 gating** (`webhook_cache_invalidation.spec.js` só cobre idempotência de cache; nada testa gating de research) | `research_gating.spec.js` — **arrange:** usuário ESSENTIAL + `MarketAnalysis` STOCK publicado. **act:** `GET /research/latest?assetClass=STOCK`. **assert:** HTTP 403. Repetir para FII/CRYPTO e para PRO→200. |
| **F2 idempotência concorrente** (o teste atual só valida "já processado" sequencial) | `webhook_idempotency_race.spec.js` — **arrange:** stub `getPaymentStatus` → approved; sem Transaction prévia. **act:** disparar `handleMercadoPagoWebhook` 2× em `Promise.all` para o mesmo `data.id`. **assert:** `Transaction.countDocuments({gatewayId})===1` e `validUntil` estendido só +30 dias. |
| **F2 assinatura** (nenhum teste exercita `isValidSignature`) | `webhook_signature.spec.js` — **arrange:** `MP_WEBHOOK_SECRET` setado. **act:** POST com `x-signature` inválido. **assert:** 200 "Signature Mismatch" e usuário intocado; com HMAC correto → processa. |
| **F3 RF indexada no snapshot** (`wallet_snapshot.spec.js` cobre só Dietz/circuit-breaker) | `snapshot_fixed_income.spec.js` — **arrange:** UserAsset FIXED_INCOME `index='IPCA', spread=6`. **act:** `runDailySnapshot(true)`. **assert:** `totalEquity` == `accrueFixedIncomeValue(...)` (paridade com o KPI live). |
| **FIFO edge** | `recalc_fifo_edge.spec.js` — vendas parciais cruzando fronteira de lote + venda a descoberto (`quantity < -EPSILON` deve lançar "Saldo insuficiente"). |

---

## 6. Quick wins (alto impacto, baixo esforço)

1. **F1** — adicionar o mapa `RESEARCH_FEATURE` e o gate no `getLatestReport` (≈8 linhas fecham o bypass de feature paga).
2. **F2** — `unique: true` em `Transaction.gatewayId` + `try/catch(E11000)` no webhook (fecha double-billing).
3. **F7** — envolver o mount do Swagger com `if (process.env.NODE_ENV !== 'production')`.
4. **F8** — corrigir o comentário enganoso de índice em `financialService.js`.
5. **F10** — adicionar as 4 flags faltantes ao `.env.example`.
6. **F6** — plugar `createUserLimiter` em `/change-password`.

---

## 7. Roadmap priorizado

**Agora (antes do próximo deploy):** F1, F2 — tocam acesso pago e integridade de cobrança; correção é S. Adicionar os testes `research_gating` e `webhook_idempotency_race`.

**Próximo (sprint):** F3 (paridade snapshot × KPI de RF indexada), F5 (rotação de refresh token + detecção de reuso), F4 (batch/paginação do snapshot), F6 (limiter do change-password).

**Depois (dívida técnica):** F7–F13 — Swagger em prod, comentários stale, expurgo do `dividendHealAt`, `.env.example`, RSI Wilder, endpoint morto `confirmPayment`, política de merge de `taxLots`.

---

## 8. Pontos fortes confirmados (para não regredir)

- **Determinismo do ranking:** sem `Math.random`/`Date.now`/timezone na ordenação; sort soberano + tiebreaker composite em todos os pontos (`portfolioEngine.js:17-21`, `aiResearchService.js:308-314`). `Date.now()` só aparece como `runId` de discard log (não afeta ranking).
- **ES Modules 100%:** nenhum `require(` no código-fonte do servidor.
- **Precisão monetária de renda fixa:** valor vem do TOTAL acumulado, nunca de `qty × preço unitário` (`walletController.js:181-261`) — regra respeitada no caminho live.
- **Dedup de proventos** por identidade canônica `(ticker, ex-date, type)` com índice único (`DividendEvent.js:30`, `financialService.js:52-53`).
- **Segurança:** CSRF double-submit com `timingSafeEqual`, AES-256-GCM versionado com blind index estável para unicidade de CPF, sanitização anti-NoSQL/prototype-pollution, MFA/TOTP com backup codes hasheados, downgrade automático de plano com cache invalidável, helmet+CSP+CORS allowlist.

---

## 9. Perguntas em aberto (o que precisei supor)

1. **F1 — intenção de produto:** o ranking STOCK/FII/CRYPTO **deveria** exigir PRO no backend, conforme CLAUDE.md/`subscription.js`. Confirmo que o comportamento atual (aberto a ESSENTIAL) é bug e não uma decisão deliberada de "publicado = público"?
2. **F2 — deploy:** há mais de uma instância do web service em produção? Se sim, a idempotência in-process não basta e o índice único no banco é ainda mais crítico (a corrida também é entre instâncias).
3. **F13 — `taxLots` merge:** o limite de 500 lotes com colapso dos 100 mais antigos foi calibrado por caso real? Para apuração de IR fiel, a ordem FIFO exata importa — `[SUPOSIÇÃO]` de que é aceitável em troca de performance.
4. **Escopo não coberto em profundidade** (por tempo): revisão exaustiva dos 33 scripts de `server/scripts` (salvaguardas de `clean:dividends` e afins), acessibilidade fina do frontend (`a11y.test.tsx`) e auditoria de re-renders/bundle do client. Recomendo uma segunda passada dirigida a esses três se forem prioridade.
