# Medição das fontes de DATA DE PAGAMENTO de provento — 09/09/2026

Item "B" do diagnóstico de 09/09/2026. **Nada foi implementado**: este documento traz a
medição pedida para que a escolha da fonte seja do dono. O script que produz os números é
`server/scripts/auditDividendPaymentSources.js` (read-only, re-executável).

```bash
node server/scripts/auditDividendPaymentSources.js --limit=90 --meses=12
```

---

## 1. Achado que muda o enunciado: os 442 `paymentDate` do banco são chute gravado

O diagnóstico dizia "442 dos 2.475 eventos (18%) têm `paymentDate`". Medido: **os 442 têm
exatamente o mesmo lag de +16 dias sobre a ex-date. Todos. 100%.**

```
Distribuição de (pagamento − ex-date) nos 442: +16d:442
Conferência contra a fonte oficial: 0/70 (0,0%) batem com a data publicada.
```

Data real de pagamento não se comporta assim: FII paga 7–10 dias depois, empresa paga meses
depois, e o calendário desvia de feriado. Um lag constante é a assinatura de uma estimativa.
As datas incluem **25/12/2025 (ITSA4)** e **01/01/2026 (CSMG3)** — dias em que a B3 não
liquida nada. Foram todas criadas em 31/01/2026; nenhum código vivo escreve +16 (a régua
atual é +15), então vieram de uma carga antiga.

Isso é pior do que a lacuna, porque `resolvePaymentDate` trata qualquer `paymentDate`
não-nulo como oficial (`isEstimated: false`). Para esses 442 eventos a tela mostra hoje
**"Agendado"/"Creditado" sobre uma data inventada**, sem o "~" e sem o selo "Previsto" que o
commit `ef27c8f` criou justamente para não afirmar chute.

**Cobertura real de data de pagamento verdadeira no banco: 0%.** A limpeza desses 442 é
independente da escolha de fonte e deveria vir antes dela.

---

## 2. As fontes

| Fonte | Situação |
|---|---|
| **B3** | Mede. API dos próprios sistemas de listados. FII: `fundsProxy/GetListedSupplementFunds`. Ação: `GetInitialCompanies` → `GetListedSupplementCompany`, filtrando a classe do papel pelo ISIN (ON/PN/PNA/PNB/UNIT). |
| **Fundamentus** | Mede. `fii_proventos.php` / `proventos.php`, coluna "Data de Pagamento". Já raspamos o site em `services/fundamentusService.js`. |
| **Status Invest** | Descartada: responde **403** a requisição de servidor. |
| **Investidor10** | Descartada: a API de gráfico não traz as datas; sobraria baixar ~1,7 MB de HTML por ativo. |

O endpoint paginado `GetListedCashDividends` (histórico profundo da B3) **não tem** campo de
pagamento — só `dateApproval` e `lastDatePriorEx`. A data de pagamento da B3 só existe no
endpoint "supplement", e é ele que limita a profundidade (ver §4).

---

## 3. Cobertura — 12 meses, 89 tickers BR, eventos oficiais

Recorte `só PROVIDER`: eventos cujo valor veio da fonte de proventos. Os eventos `DERIVED`
(provisórios deduzidos do gap do dia-ex, `utils/dividendGap.js`) ficam fora porque o valor
deles é aproximado por construção — cobrar que batam com o centavo da fonte mediria uma
limitação nossa, não um buraco da fonte.

| Fonte | Datados | FII | Ação |
|---|---|---|---|
| **B3** | **203/222 — 91,4%** | **146/146 — 100%** | 57/76 — 75,0% |
| Fundamentus | 181/222 — 81,5% | 124/146 — 84,9% | 57/76 — 75,0% |

Nas ações, os 19 eventos que faltam **não são buraco da fonte**: 15 são ambiguidade real
(§5) e 4 são divergência de valor. A B3 não deixou de conhecer nenhum evento no período
(`fonte não tem 0`).

Os 22 que faltam ao Fundamentus em FII são **atraso**: a página de proventos de FII não
publicou os meses mais recentes (GGRC11 parava em 01/07/2026 enquanto a B3 já tinha 01/09).
É exatamente a janela que aparece na tela como "Provisões Futuras".

**Onde as duas fontes datam o mesmo evento, elas concordam em 100% dos casos — zero
divergências.** Uma valida a outra.

---

## 4. Profundidade — 36 meses

| Fonte | Datados (só PROVIDER) | Profundidade |
|---|---|---|
| B3 | 208/765 — 27,2% | mediana 13 eventos/ativo · mais antigo **2025-09-10** |
| **Fundamentus** | **578/765 — 75,6%** | mediana 83 eventos/ativo · mais antigo **1995-12-28** |

A queda da B3 não é falha: o endpoint "supplement" só guarda ~12 meses (537 dos 765 caem em
"fonte não tem"). Para trás disso, a B3 não serve.

O inverso vale para o Fundamentus: 135 eventos ficam em "valor divergente" no recorte de 36
meses, quase todos em ação (97 de 288). A hipótese mais provável é ajuste de desdobramento —
o Yahoo ajusta o provento histórico por split, o Fundamentus publica o valor nominal da
época. Não confirmei. Se o casamento aceitar **data sozinha quando a fonte publica um único
pagamento para aquela data-com**, esses 135 voltam e o Fundamentus vai a ~93% em 36 meses.
Isso é um botão de rigor, e é decisão sua.

---

## 5. O teto honesto: um evento nosso, duas datas de pagamento

O Yahoo agrega numa linha só o que a fonte publica em várias, e essas várias **pagam em datas
diferentes**. Casos medidos:

```
PETR4 ex=2026-08-24  R$ 1,348143  → paga 23/11/2026 E 21/12/2026
CMIG4 ex=2026-06-24  R$ 0,220405  → paga 30/06/2027 E 30/12/2027
SHUL4 ex=2025-12-30  R$ 0,104327  → paga 25/02/2026, 30/09/2027 E 29/09/2028
```

Nosso índice único é `{ticker, date, type}` — uma linha por ex-date. Para esses eventos não
existe "a" data de pagamento, e escolher uma delas seria inventar precisão. São **15 de 76
eventos de ação (20%)** e **0 de 146 de FII**. Em FII o problema não existe.

Sugestão: esses casos ficam `paymentDate: null` e continuam na estimativa, com o selo
"Previsto" — que é o comportamento correto de fail-closed que `ef27c8f` já entregou.

---

## 6. Alinhamento entre as bases (validado, não presumido)

A fonte publica **"última data com"**; o Yahoo publica a **ex-date**, que é o pregão
seguinte. Medido:

```
B3:          +1d 61,1%   +3d 34,4%   +2d/+4d/+5d 4,2%   -3d 0,4%
Fundamentus: +1d 50,8%   +3d 43,1%   +4d/+5d 6,1%
```

+1 e +3 dias corridos são a mesma regra: `+3` é data-com na sexta com ex-date na segunda. A
cauda de +2/+4/+5 são feriados. Confirma **ex-date = data-com + 1 pregão**, que é como o
casamento tem de ser feito na ingestão.

---

## 7. Quanto a estimativa atual erra

Contra 443 datas reais:

```
acerto exato       2 (0,5%)
dentro de ±3 dias  125 (28,2%)
erro absoluto médio 26,0 dias · mediana +4d · p90 +9d · pior -415d
```

Em FII o erro é sistemático e pequeno (paga-se ~7–10 dias após a data-com, estimamos 15 — daí
a mediana de +4d, o caso GGRC11). Em **ação o ex+15 não é impreciso, é estruturalmente
errado**: a empresa aprova hoje e paga meses depois, às vezes no ano seguinte (CMIG4 fica ex
em 06/2026 e paga em 06/2027 — daí o -415d). Nenhuma constante conserta isso; só dado.

---

## 8. Restrição operacional que decide a arquitetura

- **B3 roda no servidor.** Já chamamos `arquivos.b3.com.br` de produção (fechamento oficial
  diário). Mesmo operador, e o endpoint respondeu a 88 dos 89 ativos consultados aqui (uma
  resposta truncada, sem padrão de bloqueio).
- **Fundamentus NÃO roda no servidor.** O IP do Render é bloqueado com 403 — está registrado
  em `services/fundamentusService.js:189` e é por isso que o `sync:prod` é manual, da sua
  máquina.

Ou seja, as duas não são alternativas: **a B3 é a única candidata a fonte VIVA**, e o
Fundamentus só pode ser **backfill manual**, no mesmo molde do `sync:prod`.

---

## 9. Recomendação (a decisão é sua)

**As duas, em papéis diferentes:**

1. **Limpar os 442 `paymentDate` de +16d** antes de tudo. Hoje eles fazem a tela afirmar
   data inventada com selo de oficial. Independe da escolha de fonte.
2. **B3 como fonte viva**, dentro de `syncDividends`: cobre 91,4% dos eventos oficiais dos
   últimos 12 meses e **100% dos FIIs** — que é onde a tela erra toda semana e onde o caso
   GGRC11 nasceu. Roda no servidor.
3. **Fundamentus como backfill manual** (`server/scripts/backfill…`), da sua máquina, para o
   histórico anterior a set/2025 que a B3 não tem: 75,6% em 36 meses, história até 1995.
4. **Fail-closed nos dois:** evento ambíguo (§5), valor que não bate ou fonte muda de layout
   → `paymentDate` fica nulo e a régua atual estima, marcada como "Previsto". Nunca gravar
   data deduzida como `PROVIDER`.

Se a preferência for **uma fonte só**, a B3 é a escolha: é a autoritativa, é a única que roda
em produção, é a que cobre a janela que aparece na tela, e é a que resolve o caso que motivou
o item. O custo é ficar sem data real antes de set/2025 — o que afeta o informe de IR de anos
anteriores, não a carteira do dia.

---

## 10. Pontos em aberto

- Divergência de valor no Fundamentus em ação no histórico longo (§4): hipótese de ajuste de
  split, **não confirmada**.
- ITUB4 em 01/09/2026: nosso 0,0151 contra 0,018182 da fonte (razão 0,83). Cheira a JCP
  líquido × bruto, mas 0,83 não é o 0,85 do IR — **não confirmado**.
- `typeFund: 7` cobre FII no endpoint da B3. FIAGRO e outros tipos não foram medidos.
- Se a B3 responde do IP do Render: inferido pelo precedente de `arquivos.b3.com.br`, **não
  testado em produção**. É o primeiro teste a fazer se a B3 for escolhida.
