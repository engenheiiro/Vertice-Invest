# 🧪 Roteiro de Testes — Gestão de Carteira (manual, fio a fio)

Objetivo: validar **comportamento e cálculo** da carteira ponta a ponta. A matemática
core já tem gabarito automatizado (`npm run test:server`); aqui validamos o fluxo real
na tela.

---

## 0. Preparação (uma vez)

- [ ] Rodar a rede de segurança: `npm run test:server` → tudo verde.
- [ ] Criar/usar um usuário **só de teste**: `npm run set:plan teste@email.com BLACK`
- [ ] Entrar na conta de teste → **Carteira** → se houver dados, clicar **Resetar Carteira**.

> **Regra de ouro:** resetar a carteira no início de cada bloco abaixo, para partir do zero.

> **Exato vs. ao vivo:** alguns números **não dependem** da cotação e são sempre conferíveis na mão
> (quantidade, preço médio, investido, **lucro realizado FIFO**). Outros **dependem do preço ao vivo**
> (valor atual, lucro não-realizado, rentabilidade) — abaixo eles usam **PETR4 = R$ 42,53** como
> referência; se o app exibir outro preço (delay/fonte), refaça a conta com o **preço que está na tela**.

---

## 1. Compra simples (caso base) — PETR4

- [ ] Nova Transação → comprar **100 PETR4** a **R$ 40,00**, data **hoje**.
- **Esperado (exato):**
  - [ ] Toast de sucesso e o ativo na lista.
  - [ ] Quantidade = 100 · Preço médio = R$ 40,00 · Investido = **R$ 4.000,00**.
- **Esperado (com PETR4 = R$ 42,53):**
  - [ ] Valor atual = 100 × 42,53 = **R$ 4.253,00**.
  - [ ] Lucro = 4.253 − 4.000 = **+R$ 253,00** · Rentabilidade = 253 ÷ 4.000 = **+6,33%**.
  - [ ] **Variação do dia ≠ seu lucro:** no dia da compra ela é ajustada (segue o intradiário do PETR4, não os +6,33% da sua entrada abaixo do mercado).

## 2. Preço médio (compra adicional)

- [ ] Comprar **+100 PETR4** a **R$ 44,00** (hoje).
- **Esperado (exato):**
  - [ ] Quantidade = 200 · Investido = 4.000 + 4.400 = **R$ 8.400,00**.
  - [ ] Preço médio = 8.400 ÷ 200 = **R$ 42,00** (média ponderada dos dois lotes).
- **Esperado (com 42,53):** Valor atual = 200 × 42,53 = **R$ 8.506,00** · Lucro = **+R$ 106,00**.

## 3. Venda parcial (FIFO)

- [ ] A partir do item 2 (200 cotas; lotes: 100@40 e 100@44), **vender 100** a **R$ 45,00**.
- **Esperado (exato — não depende da cotação):**
  - [ ] Quantidade restante = 100.
  - [ ] Lucro realizado (FIFO) = (45 − **40**) × 100 = **R$ 500,00** (consome o lote mais antigo, de R$ 40).
  - [ ] O lote restante é o de R$ 44,00 → preço médio da posição vira **R$ 44,00**.

## 4. Venda total (fecha posição)

- [ ] Vender as 100 restantes a **R$ 46,00**.
- **Esperado (exato):**
  - [ ] Posição zera (sai da lista de ativos ativos).
  - [ ] Lucro realizado adicional = (46 − 44) × 100 = **R$ 200,00**.
  - [ ] Resultado realizado total do ativo = 500 + 200 = **R$ 700,00**.

## 5. Venda maior que a posição (deve falhar)

- [ ] Resetar. Comprar **50 PETR4** a R$ 42,00. Tentar **vender 80**.
- **Esperado:**
  - [ ] Operação **rejeitada** com mensagem de saldo insuficiente; posição permanece 50 (nada é alterado — é atômico).

## 6. Compra com data retroativa (reconstrução de histórico)

- [ ] Resetar. Comprar **100 PETR4** com data de **~30 dias atrás** (use um preço próximo do que a ação valia na época, ex.: R$ 38,00).
- **Esperado:**
  - [ ] A transação entra com a data passada.
  - [ ] A aba **Rentabilidade** passa a ter histórico desde aquela data (snapshots reconstruídos) — não só "hoje".
  - [ ] O patrimônio/rentabilidade reflete a valorização do período (não trata como compra de hoje).
- [ ] **Conferência fina:** comprar outro ativo com data retroativa **diferente** e confirmar que a curva TWRR não "quebra" (sem pulo irreal de 0 → valor).

## 7. Dividendos / Proventos

- [ ] Ter pelo menos um ativo pagador (ex.: um FII ou ação com histórico de proventos) na carteira.
- [ ] Abrir a aba **Proventos**.
- **Esperado:**
  - [ ] Aparecem os proventos por mês (histórico) e o **projetado mensal**.
  - [ ] O **total recebido** entra no resultado consolidado da carteira (KPI de resultado).
  - [ ] Conferir um mês: soma dos proventos do mês = valor por cota × cotas na data-base.

## 8. Renda Fixa (CDB % do CDI)

- [ ] Resetar. Adicionar um **CDB a 110% do CDI**, valor R$ 1.000, data ~30 dias atrás.
- **Esperado:**
  - [ ] Valor atual **maior** que R$ 1.000 (rendeu).
  - [ ] O rendimento acompanha ~110% do CDI no período (juros compostos por dia útil) — cresce um pouco a cada dia útil, não nos fins de semana.

## 9. Caixa / Reserva (Selic)

- [ ] Adicionar um lançamento de **Caixa/Reserva** (ex.: R$ 5.000), data ~30 dias atrás.
- **Esperado:**
  - [ ] Rende ~Selic/CDI (juros compostos por dia útil); valor atual > aporte.

## 10. Ativo dolarizado (Cripto / STOCK_US)

- [ ] Comprar **1** de um cripto (ex.: BTC) ou ação US (ex.: AAPL).
- **Esperado:**
  - [ ] Valor exibido em **R$** convertido pela cotação USD/BRL do dia (a barra mostra a cotação usada).
  - [ ] Cripto pode variar fim de semana; ação US respeita dia útil.

## 11. KPIs do topo (conferência cruzada)

Com a carteira montada, conferir os cards:
- [ ] **Patrimônio** = soma dos valores atuais (em R$) de todos os ativos.
- [ ] **Investido** = soma dos custos.
- [ ] **Resultado** = (Patrimônio − Investido) + lucro realizado + dividendos.
- [ ] **Resultado %** = Resultado ÷ Investido × 100.
- [ ] **Variação do dia** coerente com a soma das variações dos ativos.
- [ ] **Sharpe / Beta** aparecem após haver histórico suficiente (≥ ~10 snapshots).

## 12. Aba Rentabilidade (TWRR vs benchmarks)

- [ ] Abrir **Rentabilidade**.
- **Esperado:**
  - [ ] Curva da carteira (TWRR) comparada a **CDI, IPCA+6% e IBOV**, base 100 na data do 1º aporte.
  - [ ] Aportes/resgates **não inflam** a rentabilidade (TWRR neutraliza fluxo de caixa).

## 13. Extrato e transações

- [ ] Abrir **Extrato** → conferir que cada compra/venda aparece com data, qtd, preço e valor.
- [ ] Excluir uma transação → a posição **recalcula** sozinha (e o histórico se reconstrói).

## 14. Modo privacidade e reset

- [ ] Ativar o **modo privacidade** → valores viram `•••`, mas a navegação continua.
- [ ] **Resetar Carteira** → tudo zera (ativos, transações e snapshots).

---

## ✅ Como interpretar divergências

- **Cálculo errado e teste automático passou?** Provavelmente é exibição/conversão na UI (ex.: USD, fuso de data) — anote o ticker, a data e os números da tela.
- **Cálculo errado e `npm run test:server` falhou?** O motor regrediu — o teste aponta qual fórmula quebrou.
- **Preço "manual" / sem cotação?** O ativo pode estar fora do horário ou sem fonte; a entrada manual de preço é o fallback esperado.

> Para automatizar este roteiro no futuro, é o item **T12 (E2E Playwright)** do plano — hoje dispensado por exigir a stack de pé.
