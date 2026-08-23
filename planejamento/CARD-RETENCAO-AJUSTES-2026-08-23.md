# Card — Ajustes da retenção de assento, depois da primeira apuração real

**Data:** 23/08/2026 · **Origem:** verificação da retenção ligada (`d52b58e` + `15a52f5`) contra a apuração gerada pelo `sync:prod` das 20:16 UTC de 23/08/2026.

Este card trata **todos os achados de uma vez**. A retenção está correta no que prometeu: nenhum invariante caiu. O que segue são um defeito de produto, dois de coerência de régua e três de acabamento — mais dois menores.

---

## O que já está certo (não mexer)

Medido na apuração de hoje, nas 7 classes:

- **Zero itens com `action: 'BUY'` e `score < 70`.** A regra inviolável está de pé.
- Nenhum ticker em dois perfis; ordenação por score sem quebra; posições contíguas 1..N.
- **Brasil 10: Jaccard 1,000** contra a última publicação (21/08 21:32) — a meta do card anterior era ≥ 0,90, e a linha de base era 0,818. Zero trocas. ABCB4 retido com 77, COMPRAR. Lista segue 5 ações + 5 FIIs.
- **Âncora intacta.** Os dois documentos publicados na Fase 0 (`BUY_AND_HOLD`: STOCK 17 itens / 6 COMPRAR, FII 30 / 3 COMPRAR) não têm nenhum campo `retention`, nenhum `retentionExits`, e nenhum COMPRAR abaixo de 70 sem `HELD`. Sem contaminação cruzada.
- Régua única de penalidade de concentração (`utils/concentrationPenalty.js`) compartilhada com o draft; baseline lido uma vez por apuração.

Nada disso deve regredir. É a linha de base dos critérios de aceite lá embaixo.

---

## 1 · A catraca: a retenção expulsa o estreante, não o pior

**Prioridade: alta.** É o único achado que muda o que o assinante vê hoje.

### O que aconteceu

Na apuração de hoje, no perfil Arrojado de Ações:

- COGN3 caiu de 73 para 67, foi retido, e entrou na lista como **AGUARDAR**;
- para abrir a vaga, deslocou **CSED3, que entrava com 72 e COMPRAR**;
- as duas são de Educação — mesmo balde de concentração (`CONSUMO`).

A regra do 70 ficou intacta (COGN3 está lá rotulado AGUARDAR, exatamente como o desenho manda). Mas a lista publicada ficou **pior pela régua dela mesma**: saiu um 72/COMPRAR, entrou um 67/AGUARDAR.

### Por que não é azar

A vítima é escolhida em [`weeklyRetention.js:324-328`](../server/utils/weeklyRetention.js#L324): o menor score **entre os não-incumbentes**. Incumbente nunca desloca incumbente — regra correta e que deve continuar.

Só que a própria retenção deixa a lista quase toda de incumbentes. Medido nos 10 assentos do Arrojado desta apuração:

| assento | score | ação | incumbente? |
|---|---|---|---|
| MILS3 | 55 | AGUARDAR | sim |
| SHUL4 | 57 | AGUARDAR | sim |
| VLID3 | 58 | AGUARDAR | sim |
| FIQE3 | 61 | AGUARDAR | sim |
| BRSR6 | 65 | AGUARDAR | sim |
| RECV3 | 68 | AGUARDAR | sim |
| AZZA3 | 74 | COMPRAR | sim |
| DIRR3 | 80 | COMPRAR | sim |
| EZTC3 | 80 | COMPRAR | sim |
| **CSED3** | **72** | **COMPRAR** | **não** |

CSED3 era o **único** deslocável. Foi expulso por ser novo, não por ser pior — havia seis assentos com score menor que o dele, todos protegidos por serem incumbentes.

Isso é uma catraca: **quanto mais a retenção funciona, mais o único alvo possível passa a ser justamente quem está chegando.** O teto de `maxRetentionShare: 0.30` não protege — ele limita retenções *por apuração*, não o travamento acumulado.

### O que fazer

Uma guarda no ponto de escolha da vítima, em [`weeklyRetention.js:324`](../server/utils/weeklyRetention.js#L324) e na cópia do Brasil 10 em [`:496`](../server/utils/weeklyRetention.js#L496):

> **Não retomar assento quando a troca reduz o número de COMPRAR da lista** — isto é, quando o deslocado está em `>= BUY_THRESHOLD` e o incumbente abaixo.

Nesse caso o incumbente sai com desfecho próprio (sugestão: `WOULD_DROP_BUY`) e motivo escrito. Custo medido: **zero no Brasil 10** (lá o retido foi ABCB4 com 77, acima do limiar), e no FII de hoje também zero (PCIP11 retido com 85 deslocou IRIM11 com 85).

Alternativa mais conservadora, se preferir a regra mais simples de explicar: **nunca deslocar um assento com score maior que o do incumbente retido.** É mais restritiva — teria barrado a troca de hoje também — mas fecha a catraca inteira em vez de só o caso do limiar. Escolher uma das duas; não empilhar as duas.

Não confundir com relaxar o piso de permanência: `holdScore: 62` continua o mesmo. O que muda é **a quem é lícito tirar o assento**.

---

## 2 · Ações paga uma penalidade que o draft de Ações não cobra

**Prioridade: média.** Não mordeu hoje, mas é uma bomba-relógio de "duas réguas na mesma lista".

O draft de Ações **não** aplica penalidade de concentração — está escrito com todas as letras em [`stockCalibrationShadowEngine.js:299-300`](../server/services/engines/stockCalibrationShadowEngine.js#L299):

> *"Em STOCK, o cap decide quem entra; concentracao nao reescreve a avaliacao fundamental nem converte BUY em WAIT depois da selecao."*

Mas [`weeklyRetention.js:346`](../server/utils/weeklyRetention.js#L346) aplica `concentrationPenaltyFor` em **todo** readmitido, inclusive de Ações. Um readmitido pode levar −5 que nenhum outro item da lista levou — e −5 é o suficiente para virar 72 em 67, ou seja, converter COMPRAR em AGUARDAR pelo caminho que o próprio motor de Ações recusa usar.

É exatamente o defeito que `utils/concentrationPenalty.js` foi criado para evitar, invertido: o módulo compartilhado igualou a *tabela*, mas não o *quando aplicar*.

**Fazer:** a retenção precisa saber se a classe corrente penaliza concentração, e não penalizar quando o draft não penaliza. Uma opção explícita (`applyConcentrationPenalty`) passada de [`aiResearchService.js`](../server/services/aiResearchService.js) junto de `relaxSectorConcentration` — não um `if (assetClass === 'STOCK')` dentro do módulo puro.

**Junto disso, o teto de balde:** o draft de Ações usa cap **4** por balde no Defensivo GOLD (`strictSectorCapByProfile: { DEFENSIVE: 4 }`, [`stockCalibrationShadowEngine.js:296`](../server/services/engines/stockCalibrationShadowEngine.js#L296)); a retenção usa `sectorCap: 3` ([`weeklyHysteresis.js:63`](../server/config/weeklyHysteresis.js#L63)). Divergência conservadora — barra readmissão que o draft aceitaria montar — mas ainda é duas réguas. Alinhar ou documentar a assimetria como deliberada.

---

## 3 · O AGUARDAR no meio da lista continua sem explicação na tela

**Prioridade: média.** É o defeito que o próprio commit `15a52f5` se propôs a fechar e fechou pela metade.

O rastro existe e sobrevive ao banco: `item.retention` está no `RankingItemSchema` e tipado em [`client/src/services/research.ts:43`](../client/src/services/research.ts#L43). Mas **nada renderiza**. Só as *saídas* aparecem (via `ExitList`); a *permanência* não.

Hoje o assinante abre a lista de Ações e vê COGN3 marcado AGUARDAR no meio do ranking, sem nada dizendo que ele está ali por ser incumbente retido.

**Fazer:** um marcador discreto na linha do item, ao lado do selo COMPRAR/AGUARDAR em [`TopPicksCard.tsx:523`](../client/src/components/research/TopPicksCard.tsx#L523), quando `pick.retention?.retained`. O texto do motivo já vem pronto do backend (`retention.reason`), e `previousScore`/`previousPosition` estão disponíveis para o tooltip. Copy voltada ao leitor, não ao algoritmo: *"na lista desde a apuração anterior"* diz mais que *"assento mantido acima do piso de permanência"*.

---

## 4 · Um texto de saída vaza jargão do algoritmo

**Prioridade: baixa,** mas é texto que o assinante lê.

Na apuração de hoje o FII publicou:

> PSEC11 — *"Saiu da lista: todos os assentos do perfil Moderado já são de incumbentes"*

Isso descreve o código, não o ativo. E PSEC11 tem score 85. Quem lê conclui que o sistema quebrou.

Fonte: [`describeRetentionExit`, `weeklyRetention.js:143-144`](../server/utils/weeklyRetention.js#L143). Vale reler os seis desfechos com olho de leitor — `NO_DISPLACEABLE_SEAT` e `BUDGET_EXHAUSTED` são os dois que falam do mecanismo em vez do ativo. Uma saída que o assinante não entende é pior que uma saída sem texto, porque ela ocupa espaço prometendo explicação.

---

## 5 · Dois menores

**5a.** No caminho legado de [`getLatestReport`, `researchController.js:655`](../server/controllers/researchController.js#L655), `content.ranking` é zerado quando o ranking não está publicado — mas `retentionExits` não. Nesse caminho o cliente receberia saídas de uma lista que não está no ar. O caminho novo (`composeActiveResearchReport`) já trata certo.

**5b.** `isWeeklyRetentionEnabled` ([`weeklyHysteresis.js:96`](../server/config/weeklyHysteresis.js#L96)) decide por `assetClass` e **não olha `strategy`**. Hoje é inócuo — `calculateRanking` só é chamado com `BUY_HOLD`, verificado em todos os chamadores. Mas é a única coisa entre a retenção do semanal e a lista âncora se alguém reusar a função. Um guard explícito por estratégia custa uma linha e remove a dependência de uma convenção não escrita.

---

## Fora de escopo (não fazer aqui)

- **Não** recalibrar pesos nem o limiar 70. Continua valendo: `score >= 70 ⇔ COMPRAR`, ordenação soberana `b.score - a.score`, um perfil por ticker.
- **Não** mexer no `holdScore: 62` nem no `maxRetentionShare: 0.30`.
- **Não** ligar `STOCK_US` (segue esperando as rampas do scorer) nem mexer na âncora.
- **Não** publicar. A publicação é decisão do dono.

---

## Critérios de aceite

Com a retenção agindo (`shadow: false`), rodando o motor nas 7 classes:

1. **Nenhum item publicado com `action: 'BUY'` e `score < 70`, em nenhuma classe.** Inegociável.
2. **Nenhuma troca de retenção reduz o número de COMPRAR da lista** — nenhum caso em que o deslocado tem `score >= 70` e o retido `score < 70`. É a regressão do achado 1, e o caso COGN3/CSED3 é o teste de regressão nominal.
3. **Brasil 10 mantém Jaccard ≥ 0,90** contra a publicação anterior. Não pode cair ao consertar o achado 1.
4. Um readmitido de Ações **não** recebe penalidade de concentração; um readmitido de FII **recebe** (o draft de FII penaliza).
5. Item retido carrega marcador visível na lista, com motivo legível ao passar o mouse.
6. Os seis textos de `describeRetentionExit` falam do ativo, não do mecanismo.
7. `retentionExits` vazio no caminho legado quando o ranking não está publicado.
8. `npm test` verde (server + client) antes de commitar. Testes novos para os achados 1, 2 e 5a.

---

## Regras operacionais

- Backend em **ES Modules** (`import/export`, nunca `require`).
- Scripts contra o Mongo: **somente leitura**. Antes de rodar, reler e confirmar que não há `save/update/insert/bulkWrite/delete` e que não sobe scheduler. Usar `server/scripts/lib/scriptDb.js`. Se importar algo que chame `calculateRanking`, **neutralizar `DiscardLog.insertMany` antes do import** (padrão de `auditWeeklyRetentionShadow.js:480`).
- O `.env` local aponta para o Mongo de **PRODUÇÃO**: `DISABLE_SCHEDULER=true` é obrigatório.
- Nenhum `sync:prod`, nenhum `runBatchAnalysis`, nenhum publish. Nada durante o pregão (10h–18h BRT em dia útil).
- No sandbox do Bash, script de banco precisa de `dangerouslyDisableSandbox: true`.
- Commit direto na `main` com push.

---

## Contexto que não é deste card

Apareceram no mesmo sync e ficam registrados aqui só para não se perderem — **não tratar neste card**:

- **brapi estourou a cota mensal** (HTTP 429, 15.000 req do plano gratuito). Fallback BR indisponível até o reset.
- **FII segue publicando 30 de 30 COMPRAR** — achado V-02 do estudo, item #9 do roteiro.
- **80 ativos com fundamento acima de 36h**; os piores são tickers mortos (PORT3 4756h, OIBR4, OSXB3). É o item pendente da blacklist da B3. Não bloqueia publicação: o portão de 36h olha a saúde do último sync, que passou (Ações 331/994 aceitos).

---

## Resolução — 23/08/2026

Todos os seis achados fechados. Medição ao vivo, somente leitura, pelo
`server/scripts/auditWeeklyRetentionGuard.js` (roda o motor nas 7 classes contra
o banco e imprime os critérios de aceite).

**Achado 1 — regra escolhida: a de ESCOPO ESTREITO.** A readmissão é recusada
quando reduziria o número de COMPRAR da lista (`canDisplace` em
`utils/weeklyRetention.js`, desfecho `WOULD_DROP_BUY`). A alternativa
conservadora foi medida e descartada com número na mão: ela barraria a única
retenção do Brasil 10 desta apuração — ABCB4 volta com 77 deslocando PSSA3, que
pontua 79 — e o Jaccard cairia de **1,000 para 0,818**, abaixo da meta de 0,90.
O motivo é estrutural, não deste dia: um incumbente sai do draft justamente
quando fica abaixo do corte, e aí todo assento não-incumbente pontua acima dele.

**Números da apuração de verificação:**

| classe | itens | COMPRAR | Jaccard | BUY < 70 | retidos | barrados pela guarda |
|---|---|---|---|---|---|---|
| STOCK | 30 | 18 | 0,765 | 0 | 0 | 1 (COGN3) |
| FII | 30 | 30 | 0,935 | 0 | 1 | 0 |
| CRYPTO | 16 | 5 | 0,882 | 0 | 0 | 0 |
| STOCK_US | 30 | 16 | 0,935 | 0 | 0 | 0 |
| REIT | 24 | 12 | 1,000 | 0 | 0 | 0 |
| ETF | 42 | 15 | 0,976 | 0 | 0 | 0 |
| **BRASIL_10** | 10 | 10 | **1,000** | 0 | 1 (ABCB4) | 0 |

- Critério 1: nenhum `BUY` com score < 70, em nenhuma classe. Contrato de
  ranking válido nas sete.
- Critério 2: zero trocas que reduzem COMPRAR. O caso nominal é o do card —
  COGN3@67 barrado, CSED3@72/COMPRAR mantém o assento.
- Critério 3: Brasil 10 em 1,000, 5 ações + 5 FIIs.
- **Custo medido:** STOCK volta de 0,818 para 0,765 de Jaccard nesta apuração —
  é a retenção de COGN3 que deixou de acontecer. Foi o preço de não publicar uma
  lista pior pela régua dela mesma.

**Achado 2.** `applyConcentrationPenalty` e `sectorCapByProfile` passam da
classe para a retenção (`aiResearchService.calculateRanking`). Ações não cobram
a dedução (o draft delas não cobra) e usam o mesmo teto de balde do draft —
`STOCK_STRICT_SECTOR_CAP_BY_PROFILE`, agora exportado do
`stockCalibrationShadowEngine` para não haver dois números.

**Achado 3.** Selo "Já estava" na linha do item quando `retention.retained`, ao
lado do semáforo, com o motivo e o par score/posição anteriores no tooltip
(`TopPicksCard.tsx`). O selo não fala de ação.

**Achado 4.** Os seis textos de `describeRetentionExit` reescritos para o
leitor, mais o novo `WOULD_DROP_BUY`. PSEC11 hoje sai como *"não havia vaga no
perfil Moderado sem tirar outro ativo que já estava na lista"*.

**Achado 5a.** O caminho legado do `getLatestReport` zera `retentionExits` junto
com `content.ranking`. **5b.** `isWeeklyRetentionEnabled` exige a estratégia e é
fail-closed sem ela.

**Âncora verificada intacta** depois da mudança: os dois documentos publicados
(`BUY_AND_HOLD` STOCK 17/6 e FII 30/3) seguem sem `item.retention`, sem
`retentionExits`, sem `retentionAudit`, e sem COMPRAR abaixo de 70.

**Não feito (fora de escopo, como o card pede):** nada de recalibração, nada de
`STOCK_US`, `holdScore` e `maxRetentionShare` intocados, e **nenhuma
publicação**.
