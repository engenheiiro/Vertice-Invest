# Diagnóstico — o cron mensal da lista âncora passa no portão de 36h?

**Data:** 23/08/2026 · **Método:** leitura do código + consulta **somente leitura** ao Mongo de produção.

---

## Pergunta

`validateAnchorPublication` (`server/services/anchorPublicationService.js:264`) termina em
`validateFundamentalsPublicationHealth` (`server/utils/ingestionHealth.js:80`), que exige
`lastSyncStats.fundamentalsHealthy === true` **e** timestamp dentro de
`FUNDAMENTALS_HEALTH_MAX_AGE_HOURS = 36`.

A suspeita registrada no card era: como `sync:prod` é **manual e sem hora fixa**, o cron do dia 1
às 07:30 encontraria fundamentos com mais de 36h e seria bloqueado — a lista âncora nunca iria ao ar
sozinha.

**A suspeita está errada, e a premissa por trás dela também.**

---

## O que a produção mostra

### 1. `lastSyncStats` não é escrito só pelo `sync:prod`

Quem escreve o campo é `syncService.performFullSync()` (`server/services/syncService.js:466`), e ele
é chamado por **dois crons diários do host**, não apenas pelo comando manual:

| Cron | Horário (BRT) | Registro |
|---|---|---|
| `daily-morning` | 09:00 | `schedulerService.js:617` |
| `daily-evening` | 18:30 | `schedulerService.js:647` |

O `sync:prod` manual é um **terceiro** caminho para o mesmo campo, não o único.

### 2. A cadência medida confirma

Amostra dos 60 `MarketAnalysis` mais recentes (STOCK/BUY_HOLD), que só são criados quando o sync
roda:

```
carimbos concentrados em 09:01 e 18:37 BRT, todo dia
gaps: n=59   min=0,0h   mediana=9,6h   max=24,0h
gaps > 36h:  0 de 59
```

Nenhum intervalo chegou perto do teto de 36h em ~30 dias. Simulando o portão nos dias 1 com dados
reais: 01/06, 01/07 e 01/08 **passariam**, com o último sync a 22,5h, 19,0h e 12,9h do disparo.

O cron da âncora dispara às 07:30, **antes** do sync das 09:00 — logo quem o alimenta é o
`daily-evening` da véspera, ~13h antes. Folga confortável dentro das 36h.

### 3. Estado do portão no momento da medição

```
lastSyncStats.fundamentalsHealthy : true
lastSyncStats.timestamp           : 2026-08-23T10:17:50Z  (idade 0,33h)
gate STOCK : { ok: true }
gate FII   : { ok: true }
```

---

## Então por que nunca houve publicação âncora?

Confirmado no banco: **zero** `PublishedResearchPointer` com `strategy: 'BUY_AND_HOLD'` e **zero**
documentos `MarketAnalysis` dessa estratégia. Só existe `BUY_HOLD`.

O motivo é banal e não tem nada a ver com o portão: o cron `monthly-anchor-publish` nasceu em
**22/08/2026** (commit `18450dd`) e roda **dia 1**. Ele ainda não teve um dia 1 para rodar. A
primeira execução seria **01/09/2026 às 07:30**.

---

## O risco que sobra (e é outro)

A fragilidade real não é a **idade** dos fundamentos — é a **flag de saúde**.

Quando o Fundamentus responde 403, `syncService` grava
`fundamentalsHealthy: false` com timestamp **fresco** (`syncService.js:156` e `:299`). O portão
então reprova pela flag, não pela idade. E como o job é **mensal**, um único sync degradado na
janela errada custa **um mês inteiro** de lista parada — com aviso apenas por `Sentry.captureMessage`,
que [o dono não acompanha](../CLAUDE.md).

É exatamente para isso que serve o botão manual entregue neste card: o caminho de recuperação
quando o cron mensal for bloqueado, sem esperar 30 dias.

---

## Decisões

1. **Não mexer no portão.** Ele funciona como projetado e a premissa de que bloquearia sempre não se
   sustenta. Afrouxar as 36h resolveria um problema que não existe.
2. **O botão manual continua justificado**, por dois motivos que independem do portão:
   - a **primeira publicação** (bootstrap) iria ao ar sem nenhum humano ter visto a lista; o
     `dryRun` deixa o dono conferir antes;
   - é o caminho de recuperação quando um sync degradado bloquear o cron mensal.
3. **`getPublishStatus` fica como está**, filtrando `strategy: 'BUY_HOLD'`. O card âncora carrega o
   próprio estado. Parametrizar a strategy acrescentaria a âncora ao contrato que o
   **"Publicar Tudo Pendente"** consome — e publicação âncora é mensal e deliberada, não pode ir a
   reboque de um clique feito para o semanal.
4. **Nada foi publicado** durante este trabalho. Apertar o botão é decisão do dono.
