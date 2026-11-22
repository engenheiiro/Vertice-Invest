# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) Maior complexidade agora é 60.** O perfil FII do
  scoring e o `auditDividendPaymentSources.js` (73) foram quebrados. Seguem
  `dataSourceStatus.js` (60), Indicators e AuditDetailModal (53) e o gate
  `isEligibleForDefensive` do scoring (52).

## Decididas

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
