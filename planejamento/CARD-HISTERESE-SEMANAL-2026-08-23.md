# CARD — Histerese no ranking semanal (`BUY_HOLD`)

`[MEDIA]` `[OPUS]` · Achado **V-01** do estudo de maturidade · Criado em 23/08/2026

> **Regra inviolável mantida:** `score >= 70 ⇔ COMPRAR`. Este card **não** a
> flexibiliza. A histerese age sobre o **assento** (quem fica na lista), nunca
> sobre a **ação**. Ver "A decisão central" abaixo.

---

## Problema

Em 40 publicações e 90 dias, o Brasil 10 passou por **34 tickers distintos** numa
lista de dez, sem nenhum presente em todas. Para um produto de comprar e segurar,
isso é um screener com outro nome: quem seguisse a lista à risca teria girado a
carteira mais de três vezes num trimestre, pagando corretagem, spread e imposto.

A causa é mecânica: o draft é recomputado do zero a cada apuração e decide os
assentos puramente por score do instante. Um ativo que cai de 71 para 69 perde o
assento para um que subiu de 68 para 70 — sem que nada tenha acontecido com
nenhuma das duas empresas.

---

## A decisão central: assento, não ação

A tentação é copiar a âncora, onde um COMPRAR pode existir com score 65 desde que
declare `HELD`. **Não é o caminho aqui** — no semanal isso quebraria
`score >= 70 ⇔ COMPRAR`, que é contrato de todo o sistema.

A saída é separar duas coisas que hoje andam juntas:

| | Quem decide | A histerese age? |
|---|---|---|
| **Assento** — o ativo aparece na lista? | draft competitivo | **Sim** |
| **Ação** — COMPRAR ou AGUARDAR? | `deriveRankingAction(score)` | **Não, nunca** |

Um incumbente retido com score 65 continua aparecendo na lista, rotulado
**AGUARDAR**. Ele não some e não vira COMPRAR indevido. O assinante que montou
posição nele continua vendo o ativo e o motivo.

### Por que isso resolve o problema medido

Decomposição do giro nas 90 dias de publicações (medida em 23/08, leitura pura):

| Classe | Jaccard da lista | Jaccard do COMPRAR | Trocas de **assento** | Trocas de **ação** | …dessas, perto de 70 |
|---|---|---|---|---|---|
| **Brasil 10** | 0,818 | 0,818 | **112** | **1** | 0 |
| **Ações** | 0,935 | 0,900 | **179** | 68 | 17 |
| **FIIs** | 0,875 | 0,871 | **272** | 28 | 3 |
| Ações US | 0,875 | 0,875 | 230 | 58 | 30 |
| Cripto | 0,882 | 1,000 | 66 | 21 | 1 |
| ETF | 1,000 | 0,938 | 21 | 47 | 36 |
| REIT | 1,000 | 0,938 | 0 | 29 | 15 |

**No Brasil 10 a proporção é de 112 para 1.** Praticamente todo o giro da lista
mais visível do produto é troca de assento — exatamente o que a retenção
conserta, sem encostar na regra do 70. Em FII a razão é ~10:1; em ações ~2,6:1.

E as trocas de ação que sobram, na maioria, **devem** acontecer: são movimentos
grandes e reais, não ruído de medição — `VTRU3 100→67`, `BPML11 92→60`,
`SOL 92→64`. Só 17 de 68 (ações) e 3 de 28 (FIIs) ficam na vizinhança do limiar.

> **Conclusão honesta:** manter a regra inviolável custa pouco. A retenção de
> assento captura a maior parte do giro medido. O resíduo de flips perto do
> limiar é problema do **item 8 do roteiro** (trocar degraus por rampas no
> scorer), não deste card.

---

## Escopo: quais classes ligar

A mesma tabela diz onde a retenção tem efeito e onde não tem.

**Ligar na v1:** `BRASIL_10`, `STOCK`, `FII` — giro dominado por assento.

**Deixar fora na v1:** `REIT` e `ETF` (0 e 21 trocas de assento; universo
praticamente fixo — retenção não teria o que fazer), `CRYPTO` (os flips são
reprecificações reais de 30+ pontos, que devem passar) e `STOCK_US` (giro alto,
mas é a classe com mais flips perto do limiar — entra depois do item 8, quando o
score parar de saltar).

A lista de classes é configuração, não `if` espalhado — ligar `STOCK_US` depois
deve ser trocar uma constante.

---

## Como o Brasil 10 entra

O Brasil 10 **não passa pelo draft**. Ele é, e continua sendo, os 5 melhores FIIs
Defensivos + as 5 melhores ações Defensivas, montado em `buildBrasil10`
(`aiResearchService.js:238-251`) a partir de `getTop5Defensive`
(`:219-233`), com `action` re-derivada pelo threshold na linha 240.

Como ele é **derivado da ordenação Defensiva**, a retenção precisa de um passo
próprio dentro de `getTop5Defensive`: um incumbente mantém sua vaga entre os 5
enquanto o score Defensivo dele estiver `>= holdScore` **e** ele continuar
passando em `isDefensiveEligible`. Só isso já ataca as 112 trocas de assento.

O baseline do Brasil 10 é o próprio documento publicado de `assetClass:
'BRASIL_10'` — ele já tem o seu, separado das outras classes.

---

## A dúvida do ABCB4: chavear por ticker, nunca por (ticker, perfil)

**Contexto.** O ABCB4 estava no Defensivo com 77 em 22/08 e apareceu no Moderado
com 64 em 23/08 — não porque piorou, mas porque o teto de 4 ativos financeiros
por macro-setor no Defensivo encheu (ITUB4, ITSA4, PSSA3, WIZC3) e ele foi
empurrado para o perfil seguinte.

**Decisão: a chave do baseline é o ticker normalizado dentro da `assetClass`.**
A troca de perfil é registrada como evento de retenção, **não** como saída +
entrada.

Três razões:

1. **O dado.** Foram **55 trocas de perfil em ações e 73 em FIIs** nas 40
   publicações. Chavear por (ticker, perfil) fabricaria 128 saídas e 128 entradas
   fantasmas em 90 dias — inflando artificialmente exatamente a métrica que este
   card existe para reduzir.
2. **O assinante segura um ticker, não um perfil.** Ninguém vende ABCB4 porque o
   motor o reclassificou. Emitir "saiu da lista" nesse caso seria mentir sobre um
   evento de carteira que não houve.
3. **Consistência.** `calculateRankingDelta` (`:259-279`) já chaveia por ticker
   normalizado, com a função `normalize()` que remove `.SA` e não-alfanuméricos.
   Reusar a mesma chave mantém um modelo mental só — e a âncora, com perfil
   único, já é trivialmente ticker.

**A regra "um perfil por ticker" continua valendo**, intocada: ela é sobre a
saída de cada apuração, não sobre identidade entre apurações.

---

## Desenho

### Ponto de inserção

As três seleções (calibração de ações, draft duplo de ETF, draft padrão)
convergem em `aiResearchService.calculateRanking`: o bloco de draft termina em
`:404` e o sort global começa em `:406`. **A retenção é um passo único nessa
fresta** — não se mexe em nenhuma das três implementações de draft.

```
draft por classe  →  [RETENÇÃO]  →  sort global  →  posição  →  delta  →  finalizeRanking
                                                                            ↑ action continua derivada
```

`buildBrasil10` recebe o seu próprio passo, por não passar por aqui.

### Módulo novo: `server/utils/weeklyRetention.js`

Função **pura**, espelhando `anchorHysteresis.js`:

```
applyWeeklyRetention({ current, previous, processedAssets, options })
  → { ranking, exits, retained, bootstrap, counts }
```

Um incumbente ausente do novo ranking é readmitido quando, **cumulativamente**:

- o melhor score dele entre os perfis é `>= holdScore` (62);
- ele ainda passa no gate do perfil em que entraria;
- o balde de concentração daquele perfil comporta mais um;
- o teto de retenções da apuração não estourou.

Readmitir desloca o **menor score não-incumbente** do perfil. Ninguém é
readmitido por cima de outro incumbente.

Todo incumbente **não** retido sai com motivo escrito — igual à âncora:
`"Saiu da lista: score caiu para 58, abaixo do piso de permanência (62)"`,
`"Saiu da lista: deixou de ser elegível ao perfil Defensivo"`,
`"Saiu da lista: teto de retenções da apuração"`.

### Guard-rail obrigatório

Teto de retenções por classe por apuração — sugestão **30% dos assentos** (9 de
30, 3 de 10). Sem isso, uma base degradada (sync parcial, fonte fora do ar)
congela a lista inteira em incumbentes e o ranking para de responder ao mercado.
Estourar o teto é `logger.warn` + Sentry.

### Config: `server/config/weeklyHysteresis.js`

```js
export const WEEKLY_HYSTERESIS = Object.freeze({
  holdScore: 62,                 // mesmo piso da âncora — uma régua só
  maxRetentionShare: 0.30,
  enabledClasses: Object.freeze(['BRASIL_10', 'STOCK', 'FII']),
  shadow: true,                  // v1 entra medindo, não agindo
});
```

`holdScore: 62` de propósito igual ao da âncora: duas bandas diferentes no mesmo
produto seriam duas explicações diferentes para o assinante.

### Baseline compartilhado

`calculateRankingDelta` já carrega o último `MarketAnalysis` publicado da classe
(`isRankingPublished: true`). Extrair essa query para
`loadPublishedRankingBaseline(assetClass, strategy)`, devolvendo
`Map<tickerNormalizado, { position, score, action, riskProfile }>`, e passar a ser
consumida pelos dois — uma leitura de banco a menos por apuração.

---

## Passos

1. **Medir antes de agir.** Script `server/scripts/auditWeeklyRetentionShadow.js`
   (read-only, padrão dos demais audits): reprocessa as últimas N publicações
   aplicando a retenção e imprime o Jaccard com e sem, por classe. É o número que
   autoriza — ou desautoriza — o resto do card.
2. `config/weeklyHysteresis.js`.
3. `utils/weeklyRetention.js` + testes unitários.
4. `loadPublishedRankingBaseline` extraído e reusado por `calculateRankingDelta`.
5. Plugar em `calculateRanking` (ponto de convergência) sob `shadow: true` —
   calcula, loga, **não altera** o ranking.
6. Plugar em `getTop5Defensive` / `buildBrasil10`, também em shadow.
7. Persistir `retentionAudit` no `inputManifest` do documento.
8. Expor as saídas na tela, reusando o componente de "Saíram da lista" que a
   página `/buy-and-hold` já tem.
9. Virar `shadow: false` — decisão do dono, com o número do passo 1 na mão.

---

## Testes

- Incumbente com 65 **fica na lista** e sai rotulado **AGUARDAR**. *(o teste que
  protege a regra inviolável)*
- Incumbente com 61 **sai**, com motivo escrito.
- Incumbente que perdeu elegibilidade **sai**, mesmo com score 90.
- Ticker que trocou de Defensivo para Moderado é **retenção**, não saída+entrada.
- Retenção **nunca** desloca outro incumbente.
- Retenção respeita o teto de concentração do balde.
- Teto de retenções corta no limite e avisa.
- Primeira apuração sem baseline (`bootstrap`) não retém ninguém.
- `validateRankingContract` continua verde: nenhum COMPRAR com score < 70.
- Classe fora de `enabledClasses` passa sem alteração.
- Brasil 10 continua sendo 5 Defensivos de cada classe, com `action` derivada.

---

## Aceite

- [ ] Nenhum item publicado com `action: 'BUY'` e `score < 70`, em nenhuma classe.
- [ ] Jaccard mediano do Brasil 10 entre publicações consecutivas **≥ 0,90** em
      shadow sobre as 40 publicações históricas (hoje: 0,818).
- [ ] Toda saída de incumbente tem motivo legível persistido.
- [ ] Trocas de perfil não geram evento de saída.
- [ ] Contrato de ranking verde nas 7 classes.
- [ ] `npm test` verde.

---

## Fora de escopo

- **Flips de ação perto do limiar** — é o item 8 (rampas no lugar de degraus).
  Este card não os reduz e não deve fingir que reduz.
- **Reescalar o scorer de FII** — item 9, precisa de shadow próprio.
- Qualquer mudança em `BUY_THRESHOLD`, na ordenação soberana ou na regra de um
  perfil por ticker.
- A estratégia âncora, que já tem a sua histerese e não é tocada aqui.

---

## Risco

O maior é a retenção mascarar deterioração real: um ativo que piora devagar fica
seis meses na lista descendo de 70 para 63. Mitigação: o piso de 62 é apertado
(8 pontos), a saída por perda de elegibilidade é imediata e independe do score, e
o teto de retenções impede que a lista inteira vire incumbência. Ainda assim,
vale acompanhar no painel quantas apurações seguidas cada nome foi retido — um
incumbente retido cinco vezes seguidas é um sinal, não uma vitória.
