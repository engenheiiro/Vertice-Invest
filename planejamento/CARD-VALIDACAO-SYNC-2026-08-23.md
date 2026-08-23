# Card — Rodar o sync, triar o que é crítico para o ranking, fechar

**Data:** 23/08/2026 · **Tipo:** validação operacional, não desenvolvimento de feature.

## Pré-requisito

**Este card começa depois que `planejamento/CARD-RETENCAO-AJUSTES-2026-08-23.md` (task da retenção) tiver commitado na `main`.** Rodar o sync antes disso valida código que está prestes a mudar. Confirme com `git log --oneline -5` que os ajustes da retenção já estão na main antes de começar.

---

## O que este card é

Um ciclo fechado, repetido até dar limpo:

```
sync:prod → auditar a apuração → é crítico? → sim: corrigir → sync:prod de novo
                                            → não: registrar e ignorar
                                                        ↓
                                              commit + push + encerrar
```

O dono está com orçamento curto. **Nada de escopo novo.** Se um achado não se encaixa na definição de crítico abaixo, ele é registrado no relatório final e não é tratado aqui.

---

## Definição de CRÍTICO (a única que vale neste card)

Um achado é crítico se, e somente se, **ele altera a lista que o assinante vê ou impede a publicação**. Sete gatilhos:

1. **Qualquer item com `action: 'BUY'` e `score < 70`**, em qualquer classe da estratégia `BUY_HOLD`. Quebra do contrato — para tudo.
2. **Ranking vazio** ou com contagem que despencou contra a apuração anterior (queda > 30% dos itens numa classe).
3. **Invariante de ordenação quebrado:** score fora de ordem decrescente, posição não contígua, ou o mesmo ticker em dois perfis na mesma classe.
4. **Item no ranking apoiado em fundamento velho:** algum ativo *dentro da lista publicada* com fundamento acima de 36h. (Ativo velho fora da lista **não** é crítico — é o item pendente da blacklist da B3.)
5. **`ERROS` > 0 no relatório do sync** (`server/logs/sync-report.txt`, seção `[ERROS]`). Na apuração de 23/08 eram 0.
6. **Portão de fundamentos reprovado** — `validateFundamentusIngestion` falhando, ou aceitação abaixo do mínimo (`server/utils/ingestionHealth.js`). Isso bloqueia publicar.
7. **Contaminação entre estratégias:** qualquer documento `BUY_AND_HOLD` com campo `retention`/`retentionExits`, ou qualquer `BUY_HOLD` com `anchor`/`anchorExits`.

## Explicitamente NÃO crítico (registrar e seguir)

Estes apareceram no sync de 23/08 e **não devem ser tratados aqui**:

- **brapi com cota mensal estourada** (HTTP 429, 15.000 req do plano gratuito). É limite externo, não tem conserto em código.
- **Yahoo sem símbolo para ativos já documentados** (HOLX, MMC, SEE, CFLT, EXAS, MRUS) — vivos, lacuna de fonte conhecida, **não blacklistar**.
- **Tickers mortos com fundamento antigo** fora da lista (PORT3, OIBR4, OSXB3 e cia). É o item pendente da blacklist da B3.
- **FII publicando 30 de 30 COMPRAR.** É o achado V-02 do estudo de maturidade, item #9 do roteiro — exige recalibração de escala, que está fora de escopo.
- **Alertas de performance do backtest** (MTRE3, POMO4, PETR4, TRXF11, TGAR11, BBIG11). São picks publicados que caíram; é informação, não falha de sync.
- **Ativos ainda inativos após a reativação.**

---

## Passo 1 — Ferramenta de auditoria reutilizável

Antes do primeiro sync, crie `server/scripts/auditRankingRun.js`: script **somente leitura** que lê a apuração mais recente de cada classe e responde aos sete gatilhos acima com um veredito por classe e um resumo final `CRÍTICO / LIMPO`.

Ele precisa existir como script versionado (e não como script temporário) porque o ciclo deste card o roda pelo menos duas vezes, e porque a próxima rodada de sync vai querer o mesmo cheque.

O que ele deve ler, por classe (`BRASIL_10`, `STOCK`, `FII`, `CRYPTO`, `STOCK_US`, `REIT`, `ETF`), no documento `MarketAnalysis` mais recente de `strategy: 'BUY_HOLD'`:

- `content.ranking[]` → contrato do 70, duplicidade de perfil, monotonia do score, contiguidade de posição, contagem;
- cruzar cada ticker do ranking com `MarketAsset.lastFundamentalsDate` (com fallback para `updatedAt`) → gatilho 4;
- `MarketAnalysis` com `strategy: 'BUY_AND_HOLD'` → gatilho 7;
- Brasil 10: confirmar 5 STOCK + 5 FII, e calcular o Jaccard contra a última publicação com `isRankingPublished: true`.

Cuidado conhecido: `MarketAnalysis.find().sort()` sem índice estoura o limite de memória do Mongo. Use o índice existente `{ assetClass, strategy, createdAt: -1 }` e projete só o que precisa (`.select(...).lean()`).

Segundo cuidado: os logs do Winston sujam o `stdout`. Se o script imprimir JSON, escreva em arquivo via variável de ambiente em vez de `console.log`.

## Passo 2 — Rodar o sync

```bash
npm run sync:prod
```

Leva ~13 min. Ele **não publica** — gera rascunhos. Acompanhe e, ao terminar, leia `server/logs/sync-report.txt` (sobrescrito a cada run): a Parte 1 tem o resumo e a Parte 2 o detalhe técnico com as seções `[ERROS]`, `[AVISOS OPERACIONAIS]` e `[ALERTAS DE PERFORMANCE]`.

## Passo 3 — Auditar e triar

Rode o `auditRankingRun.js`. Para cada achado, decida contra a lista de sete gatilhos. **Não conserte nada que não esteja lá.** Um achado fora da lista vai para o relatório final como "registrado, não tratado", com uma linha de motivo.

## Passo 4 — Corrigir só o crítico

Se houver crítico: conserte, com teste que falha antes e passa depois, e **volte ao passo 2**. O ciclo se repete até o veredito sair `LIMPO`.

Se não houver: siga para o passo 5.

## Passo 5 — Fechar

- `npm test` verde (server + client).
- Commit direto na `main`, com push.
- Se nada de código mudou, ainda assim commite o `auditRankingRun.js` e um registro curto do veredito.

---

## O que não fazer

- **Não publicar.** Publicação é decisão do dono, sempre.
- **Não** recalibrar pesos, nem o limiar 70, nem `holdScore`, nem `maxRetentionShare`.
- **Não** mexer na estratégia âncora (`BUY_AND_HOLD`).
- **Não** ampliar escopo para os itens da lista "não crítico", por mais tentador que seja o conserto.
- **Não** rodar durante o pregão (10h–18h BRT em dia útil): o sync grava candle parcial como fechamento.

---

## Regras operacionais do projeto

- Backend em **ES Modules** (`import/export`, nunca `require`).
- Scripts contra o Mongo: **somente leitura**. Antes de rodar, releia o script e confirme que não há `save/update/insert/bulkWrite/delete` e que ele não sobe scheduler. Use o conector endurecido `server/scripts/lib/scriptDb.js`. Se importar algo que chame `calculateRanking`, neutralize `DiscardLog.insertMany` **antes** do import — padrão em `server/scripts/auditWeeklyRetentionShadow.js:480`. (O `sync:prod` é a exceção: ele escreve por design, e é o único comando de escrita autorizado neste card.)
- O `.env` local aponta para o Mongo de **PRODUÇÃO**. `DISABLE_SCHEDULER=true` é obrigatório.
- No sandbox do Bash, script de banco precisa de `dangerouslyDisableSandbox: true`.
- O `sync:prod` demora ~13 min: rode em background e não fique consultando em laço.

---

## Relatório final (o que o dono precisa ler)

Termine com um resumo curto, em português claro, contendo:

1. **Veredito:** limpo ou não, e quantos ciclos de sync foram necessários.
2. **Críticos encontrados e o que foi feito** em cada um — ou "nenhum".
3. **Registrado e não tratado:** a lista dos achados fora da definição de crítico, uma linha cada.
4. **Estado da apuração:** data/hora dos rascunhos gerados, e o lembrete de que **nada foi publicado** e de que o portão de 36h conta a partir do sync.
5. Confirmação explícita de que **nenhuma classe publica `BUY` com score abaixo de 70**.

---

## Linha de base da apuração de 23/08 20:16 UTC (para comparar)

| classe | itens | COMPRAR |
|---|---|---|
| Brasil 10 | 10 | 10 |
| Ações | 30 | 17 |
| FIIs | 30 | 30 |
| Cripto | 16 | 5 |
| Ações US | 30 | 16 |
| REIT | 24 | 13 |
| ETF | 41 | 15 |

Brasil 10: Jaccard 1,000 contra a publicação de 21/08. Fundamentos: Ações 331/994 aceitos, FIIs 310/560. Zero erros, 9 avisos operacionais, 11 alertas de performance.
