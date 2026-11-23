# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-23) Maior complexidade agora é 29 (era 73 em 22/11).** Já quebrados: perfil
  FII do scoring e `auditDividendPaymentSources.js` (73), `dataSourceStatus.js`
  (60), Indicators e AuditDetailModal (53), o gate `isEligibleForDefensive`
  (52), PerformanceOverview e WalletView (51), AssetDetailModal da Pesquisa
  (49), EquitySummary, CreateGoalModal e WalletContext (48), DataSourcesPanel e
  `rebuildUserHistory` (46), WalletSummary (45), TopPicksCard e Research (44),
  ProfileIdentity e `_applyDayTransactions` (43). Onda 1 (23/11, subagentes):
  `scoringEngine` (42/41/32/25/25), `persistUserSnapshotForDay` (41),
  `computeWalletKpis` (40), `buildDayMovers` (35), `buildTaxPdf` (34),
  `_loadPriceCacheMap` e `resolveRows` (31), `accrueDividendsByTicker` (26).
  Onda 2 (23/11): `updateProfile` e `collectFacts` (39), `performMacroSync`
  (38), `auditTreasuryCatalog` (37), `_runFullSync` (30), `updateOfficialRates`
  (29), `buildFundamentusAssetUpdate` (28), `_parseNtnbFromCsv` (25),
  `_persistUsdHistory` (22) e mais sete entre 16 e 18. O teto segue
  `utils/weeklyRetention.js` (43); depois PerformanceChart (41). Onda 3
  (23/11): `extractFundamentals` e `parseTreasuryPriceCsv` (35),
  `getMarketDataMap` e `syncBrEtfFundamentals` (32), `getMarketDataByTicker`
  e `healWalletCandleGaps` (31), `describeTesouroDownloadProblem` (30),
  `buildFundamentalsOp` e `ingestTreasuryPrices` (26),
  `parseTesouroDiretoQuotes` (25), `ensureWalletDayCandles` (22),
  `detectExDateDividends` (20), `retireStaleInactiveAssets` (16). Onda 4
  (23/11): `applyWeeklyRetention` (43), `runScanner` (37),
  `calculateStockCalibrationConfidence` (32), `passesBuyAndHoldGate` e
  `formatMetrics` (31), `applyBrasil10Retention` (29),
  `detectBullishDivergence` (25), `scoreBuyAndHold` e `formatRankingItem`
  (18), `runBacktest` (17). Onda 5 (telas, 23/11): PerformanceChart (41),
  CoursePlayer (35), SecuritySection e AssetSection (33), DayMoversModal (30).
  Nenhuma função passa mais de 29: o topo agora é TaxReport, AdminSuporteTab e
  `timeSeriesWorker` (29), depois ResearchAporteModal, CheckoutSuccess,
  `validateTransaction` e `goalCoach` (28). Sobram 118 funções acima de 15 em
  77 arquivos (61 entre 20 e 29, 57 entre 16 e 19). `dataHealthRules.js` ainda tem
  7 funções acima de 15 (24, 23, 19, 19, 18, 18, 17).
- **(dono, 2026-11-23) Estranhezas congeladas na onda 5 (telas)** (mesma regra):
  - SecuritySection: resposta do `setupMfa` sem `secret`/`qr` abre o QR com
    `img` sem `src`; status de MFA que falha (500/corpo vazio) mostra 2FA
    desligado sem avisar. (Corrigido em 23/11: o `Button` carregando sempre
    desabilita — vale também para AddAsset, RenameWallet e RenameReserve.)
  - CoursePlayer: curso sem aulas mostra "Marcar esta aula como concluída" (o
    clique só gera `console.error`); progresso recusado pelo servidor é
    ignorado; escolher aula recarrega curso e progresso e some com conclusão
    que o servidor não devolveu. (Corrigidos em 23/11: falha de rede mostra
    "Tentar de novo" em vez de "Acesso Restrito" — resposta 200 com corpo
    malformado também cai aí —; aula sem duração não mostra "NaN min".)
  - PerformanceChart: a ordenação muta o array da API; o timer da demo não é
    cancelado ao desmontar; o eixo X agrupa mês com `getUTCMonth` sobre data
    local à meia-noite (erraria a leste de UTC).
  - DayMoversModal/AssetSection: total do dia NaN sai em vermelho; classe fora
    da lista mostraria "TICKER · undefined"; resultado de busca sem `type` gera
    etiqueta vazia.
- **(dono, 2026-11-23) Estranhezas congeladas na onda 4** (mesma regra):
  - `signalEngine.runScanner`: se um check lança depois de outro já ter
    gravado, o upsert do primeiro fica mas o ticker sai de `scannedTickers`
    (a auto-invalidação o trata como não varrido). `runBacktest` não devolve
    `success: true` nem `expired` no caminho normal. (Corrigidos em 23/11: a
    divergência passa pelo veto de dia de crash; `roe` em texto não derruba o
    ativo.)
  - `calculateStockCalibrationConfidence`: `legacyConfidence = ''` derruba a
    confiança a 0 (`Number('')`); `requiredCoverage` em texto vira teto 0;
    ativo nulo lança.
- **(dono, 2026-11-23) Estranhezas congeladas na onda 3** (mesma regra):
  - Fundamentos US/ETF, regra 13 (o leitor único de número do Yahoo e o ETF
    que não derruba o lote foram corrigidos em 23/11; achados na correção):
    no caminho US, `quoteSummary` resolvendo `undefined` ainda lança fora de
    try e derruba o `syncUSStocksFundamentals` inteiro (o mesmo defeito que o
    ETF tinha); `resolveBrEtfDy` grava `dy: 0` com `dyKnown: true` quando não
    há preço > 0 (zero sem fonte); `lastPrice` negativo ainda é aceito e, no
    ETF, impede a busca na Brapi. Beta/P/VP/VPA/volume/preço iguais a 0 seguem
    tratados como ausentes (marcador do Yahoo), de propósito.
  - Candles da carteira: `healWalletCandleGaps` faz `AssetHistory.find` e a B3
    sem try/catch (o erro sobe), ao contrário do aggregate, que é fail-open.
    (Corrigido em 23/11: candle de fim de semana de classe só de dias úteis não
    vira mais fechamento do dia.)
  - Tesouro: título repetido no JSON do Tesouro Direto: vale o primeiro;
    Data Base repetida no CSV: vale o último. (Corrigido em 23/11: data
    inexistente descarta a linha.)
  - `marketDataService`: `getMarketDataByTicker` ordena `history.history` no
    lugar (o lote ordena cópia) e aceita fallback com `length > 0` que não é
    lista; o lote conta dois acertos para ticker repetido e consulta a chave
    `''` para entrada nula; `detectExDateDividends` devolve 0 se um
    `updateOne` falha no meio, mesmo tendo gravado eventos antes.
- **(dono, 2026-11-23) Estranhezas congeladas na onda 2** (mesma regra: cada
  uma é decisão própria; a caracterização trava o comportamento atual):
  - `updateProfile`: `$set` leva `name`/`phone`/`occupation` como
    `undefined` quando vêm vazios (o Mongoose ignora, mas não é intencional).
    (Corrigido em 23/11: `cpf` que não é texto responde 400.)
  - `refreshToken` (corrigido em 23/11: o reuso é registrado antes de revogar
    e a falha ao revogar vira erro logado): a mensagem de auditoria segue
    dizendo "todas as sessões revogadas" mesmo quando a revogação falhou.
  - `syncDailyEconomicIndexes` com resposta que não é lista (HTML) não tenta
    o endpoint `ultimos/50`. (Corrigidos em 23/11: câmbio não numérico conta
    como ausente e marca defasado; o início da consulta ao BCB sai em UTC.)
  - `_runFullSync`: o ramo "Nenhum ativo válido encontrado." é inalcançável (a
    validação de ingestão exige ≥ 50 aceitos por classe antes).
  - `auditTreasuryCatalog`: `rate: null` é auditado como taxa 0 (`Number(null)`),
    não como ausente.
- **(dono, 2026-11-23) Estranhezas congeladas na onda 1** (cada uma é decisão
  própria; a caracterização trava o comportamento atual):
  - `persistUserSnapshotForDay`: `calculatedAt` inválido ou lançamento que não
    é BUY/SELL lança `TypeError` sem código de retorno; o comentário cita o
    retorno `'exists'`, que não existe; quantidade negativa vira 0 no provento
    do dia mas entra no patrimônio; provento sem `type` deduplica com
    `'DIVIDEND'`.
  - `_loadPriceCacheMap`: se gravar a série aprofundada falha, a série externa
    mais longa é descartada. `accrueDividendsByTicker` não reordena lançamentos
    fora de ordem.
  - `scoringEngine`: FII com `beta: null` passa em `null < 0.7` e quebraria em
    `null.toFixed` na tese (hoje ninguém grava null); o "Teto Especulativo
    Cripto" é inalcançável (base 50 + bônus não passam de 80).
  - PDF de IR: DARF com mês inválido imprime "Competência undefined/2025";
    mês/categoria desconhecidos saem crus.
  - `computeWalletKpis`/`buildDayMovers`: NaN de um ativo se propaga ao total;
    variação NaN não é tratada na ordenação.
- **(dono, 2026-11-23) Rebuild com `safeMath` transforma NaN em 0.** Desde a
  correção de 23/11 (taxa 100 como o caminho ao vivo, venda sem estado de RF,
  aritmética em 4 casas), um `totalValue` não numérico, que antes propagava
  NaN até a validação do schema, entra como 0 sem aviso (regra 13). A escrita
  de lançamento valida o valor por Zod, então hoje não acontece; a matriz da
  caracterização não gera o caso.
- **(dono, 2026-11-22) Estranhezas mantidas de propósito nas refatorações de
  tela** (o comportamento foi congelado como estava; cada uma é decisão
  própria):
  - Pesquisa (AssetDetailModal): D/E acima de 10 é dividido por 100.
    (Corrigidos em 23/11: fundo `bg-black/95`; cripto em `$`.)
  - Carteira (WalletView): sem usuário, o Aporte não mostra cadeado (o clique
    segue bloqueado); a carteira vazia tem `<h3>` logo abaixo do `<h1>` (axe
    `heading-order`, desligado só nesse teste). (Corrigido em 23/11: a classe
    literal `false`.)
  - Admin (AuditDetailModal): nota "C" com veredito "descartado" entre 60 e
    64; botão de fechar o painel de detalhe sem nome acessível.

## Decididas

- **Lançamento em dólar sem câmbio entra sem carimbo (23/11/2026).** Sem
  série USD/BRL e sem cotação na macro, o resolvedor devolve nulo (antes, 5,75
  fixo). O recálculo não carimba `fxRate` e deixa `totalCostBrl` e
  `realizedProfitBrl` nulos ("não migrado"); o próximo recálculo com câmbio
  real carimba. A cota live, sem câmbio para o fluxo do período, cai para
  "Estimado" em vez de derrubar a carteira. Travado em
  `tests/fx_missing_rate.spec.js`.
- **Demo mode não lê da API (22/11/2026).** O `dataSource` do WalletContext
  não bloqueia o demo sozinho, mas os quatro consumidores bloqueiam antes de
  chamar (`enabled: !isDemoMode` em CashFlowHistory e MonthlyReturnsTable;
  `if (isDemoMode)` em DividendDashboard e PerformanceChart). Nenhuma leitura
  sai no demo; consumidor novo de `dataSource` precisa da mesma guarda.
- **Prazo da meta lido em UTC é o certo (22/11/2026).** O servidor grava o
  prazo como data de calendário (`calendarDate`, meia-noite UTC); ler no fuso
  local é que daria a véspera em Brasília. Comentado em `createGoalForm.ts` e
  travado em `createGoalForm.test.ts`.
- **Direção do resultado aparece no modo privacidade (22/11/2026).** O sinal
  ("+•••%") e a cor verde/vermelha seguem visíveis com os valores mascarados;
  o múltiplo bruto, que reconstituía o patrimônio, passou a ser mascarado —
  no Terminal e, desde 23/11, também no resumo da aba Carteira.
- **`getMarketData`: `metrics.price` fica cru (22/11/2026).** Sem cotação ele
  sai `undefined`, que é o estado honesto (regra 13: nunca número inventado
  como real). O `asset.lastPrice || 0` do topo do item é o desvio, mas a tela
  lê esse campo; trocá-lo por nulo é mudança de contrato e pede revisão
  própria. Travado por `tests/market_data_batch_characterization.spec.js`.
- **Suíte do client fica como está (22/11/2026).** Os 53 s eram máquina
  carregada; com ela livre, 34 s para 1709 testes (teto 60).

- **"12.000 investidores" na landing:** fica. É tática de venda, decidida pelo
  dono em 22/11/2026.
- **Ramos "inalcançáveis" do scoring ficam (22/11/2026).** "Liquidez Crítica
  (<100k)", "Beta ≥ 1.5" no Defensivo, o `price > 0 ? … : 0` do upside e o
  texto de ROE recorrente sem régua não são código morto: são guardas. O
  scoring é chamado por 3 serviços e 7 scripts de auditoria, não só pelo
  `processAsset` que filtra antes; o Beta ≥ 1.5 dispara para STOCK_US; o
  `price > 0` impede divisão por zero. Tirá-los não muda nada hoje e deixa o
  motor dependente de um filtro em outro módulo.
