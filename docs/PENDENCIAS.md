# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) 8 funções complexas da carteira.** A divisão do
  `walletController` só moveu código. As 8 funções acima de 15 continuam,
  agora em walletTransactionsController (3), walletPerformanceController (2),
  walletKpis, walletPayload e walletAssetProcessor (1 cada). Os 91 testes de
  `wallet_controller_*` são a rede para quebrá-las.
- **(dono, 2026-11-22) Ramos condicionais inalcançáveis no scoring**, achados
  na refatoração e mantidos como estavam para provar a equivalência:
  - "Liquidez Crítica (<100k)" nunca dispara, porque o processAsset descarta
    antes de 200k;
  - "Beta ≥ 1.5" no Defensivo só pode disparar para STOCK_US;
  - o ramo `price > 0 ? … : 0` do upside nunca chega ao 0;
  - o texto de ROE recorrente "sem régua" nunca aparece.

  Remover qualquer um deles muda o código do score, então pede revisão própria.
- **(dono, 2026-11-22) Cobertura das telas.** Hoje `client/src/pages` tem 29%
  e `components` 51%; `server/services` está em 68,5%.
- **(dono, 2026-11-22) 112 avisos de acessibilidade.** A maioria é
  `click-events-have-key-events` e `no-static-element-interactions`: linhas de
  tabela e cards clicáveis que não abrem pelo teclado.

## Decididas

- **"12.000 investidores" na landing:** fica. É tática de venda, decidida pelo
  dono em 22/11/2026.
