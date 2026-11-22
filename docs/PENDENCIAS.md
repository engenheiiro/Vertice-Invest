# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) Maior complexidade agora é 73.** O
  `recalculatePosition` (82) foi quebrado. O teto `complexidadeMax` passa a
  ser o perfil FII do `scoringEngine.js:330` (73) — código do score, pede
  revisão própria — e o script `auditDividendPaymentSources.js` (73). Seguem
  `dataSourceStatus.js` (60), Indicators e AuditDetailModal (53).
- **(dono, 2026-11-22) Suíte do client perto do teto de 60 s.** Com 1709
  testes ela mediu 53 s no check de 22/11 (com a máquina carregada; antes dos
  ~400 testes novos eram ~33 s). Se encostar no
  teto, olhar primeiro os testes de página mais pesados (Calculadora, Admin).
- **(dono, 2026-11-22) `getMarketData`: `metrics.price` sem fallback.** O
  topo do item usa `asset.lastPrice || 0`, mas `metrics.price` é
  `asset.lastPrice` cru e pode sair `undefined`. Travado como está por
  `tests/market_data_batch_characterization.spec.js`; decidir qual dos dois
  vale antes de mudar.

## Decididas

- **"12.000 investidores" na landing:** fica. É tática de venda, decidida pelo
  dono em 22/11/2026.
- **Ramos "inalcançáveis" do scoring ficam (22/11/2026).** "Liquidez Crítica
  (<100k)", "Beta ≥ 1.5" no Defensivo, o `price > 0 ? … : 0` do upside e o
  texto de ROE recorrente sem régua não são código morto: são guardas. O
  scoring é chamado por 3 serviços e 7 scripts de auditoria, não só pelo
  `processAsset` que filtra antes; o Beta ≥ 1.5 dispara para STOCK_US; o
  `price > 0` impede divisão por zero. Tirá-los não muda nada hoje e deixa o
  motor dependente de um filtro em outro módulo.
