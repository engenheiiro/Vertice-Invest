# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) Cabeçalho do Tesouro em Indicadores.** Aberto, os
  botões de filtro ficam dentro do cabeçalho `role="button"` (interativo
  dentro de interativo, regra `nested-interactive` do axe). Separar o botão
  de abrir/fechar dos filtros. O teste da página checa só com a seção fechada.
- **(dono, 2026-11-22) Cobertura de `client/src/components`** em 51%. As abas
  AdminFerramentasTab, AdminPainelTab e AdminOperacoesTab não têm teste.
- **(dono, 2026-11-22) Maior função do sistema com complexidade 82.** A
  carteira saiu da lista (as 8 funções acima de 15 foram quebradas). O teto
  `complexidadeMax` é o `recalculatePosition` de `financialService.js` (FIFO,
  câmbio e RF), que pede revisão própria. Seguem GoalDetailModal (74),
  AdminPainelTab (75) e o perfil FII do scoringEngine (73).

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
