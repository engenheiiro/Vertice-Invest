# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) Maior complexidade agora é 45.** Já quebrados: perfil
  FII do scoring e `auditDividendPaymentSources.js` (73), `dataSourceStatus.js`
  (60), Indicators e AuditDetailModal (53), o gate `isEligibleForDefensive`
  (52), PerformanceOverview e WalletView (51), AssetDetailModal da Pesquisa
  (49), EquitySummary, CreateGoalModal e WalletContext (48), DataSourcesPanel e
  `rebuildUserHistory` (46). O teto passa a ser `WalletSummary.tsx` (45),
  seguido de `TopPicksCard.tsx` e `Research.tsx` (44) e de `ProfileIdentity.tsx`
  e `_applyDayTransactions` do `financialService.js` (43).
- **(dono, 2026-11-22) Rebuild de histórico grava câmbio e IPCA inventados
  sem macro.** Sem `MACRO_INDICATORS` no banco, `rebuildUserHistory` usa IPCA
  4,5 e dólar 5,75 fixos (`resolveRebuildRates` em
  `utils/rebuildHistoryRules.js`), e o resultado vai para os snapshots — choca
  com a regra 13. Comportamento antigo, mantido na refatoração e travado por
  `tests/rebuild_history_rules.spec.js`; decidir se o rebuild deve abortar
  sem macro.
- **(dono, 2026-11-22) Estranhezas mantidas de propósito nas refatorações de
  tela** (o comportamento foi congelado como estava; cada uma é decisão
  própria):
  - Pesquisa (AssetDetailModal): fundo do modal `bg-black/90`, não o
    `bg-black/95` do design system; em CRIPTO, "Market Cap" e "Liquidez Est."
    saem em `R$` enquanto o preço sai em `US$`; D/E acima de 10 é dividido por
    100.
  - Carteira (WalletView): fora do demo a marcação recebe uma classe literal
    `false`; sem usuário, o Aporte não mostra cadeado (o clique segue
    bloqueado); a carteira vazia tem `<h3>` logo abaixo do `<h1>` (axe
    `heading-order`, desligado só nesse teste).
  - Admin (AuditDetailModal): nota "C" com veredito "descartado" entre 60 e
    64; botão de fechar o painel de detalhe sem nome acessível.
  - Admin (PerformanceOverview): a linha da janela pode imprimir "null"
    quando `rssMinMb`/`rssMaxMb` faltam.

## Decididas

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
  o múltiplo bruto, que reconstituía o patrimônio, passou a ser mascarado.
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
