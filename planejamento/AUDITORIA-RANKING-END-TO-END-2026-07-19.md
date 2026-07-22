# Auditoria end-to-end do ranking — relatório final

**Data da fotografia:** 19/07/2026  
**Timezone:** America/Sao_Paulo (UTC-03:00)  
**Escopo concluído:** Fases 0–6 do prompt mestre, correção da ingestão e recuperação controlada dos dados  
**Escopo inicial:** diagnóstico e plano; a execução posterior foi autorizada em passos separados e auditáveis  
**Adendo autorizado:** correção do parser e dos gates, backup, sync controlado, saneamento dos três documentos contaminados e geração de novo rascunho; publicação não autorizada  
**Status geral:** a causa dos “quatro BUY” está reconciliada; o defeito crítico da ingestão foi corrigido e os fundamentos foram recuperados. Um novo ranking foi salvo somente como rascunho, sem alterar o publicado.

## Adendo de implementação inicial — 19/07/2026

Após autorização explícita, foram implementados somente os itens de código, testes e validação in-memory:

- schema STOCK v2 com as 22 colunas atuais e `Mrg Bruta` no índice 12;
- validação fail-closed por largura exata, nomes e ordem do cabeçalho;
- extração corrigida de margem, ROIC, ROE, liquidez, patrimônio, dívida líquida/patrimônio e crescimento;
- health gate por classe com contagens `parsed`, `accepted`, `rejectedLowLiquidity`, `duplicates` e `acceptanceRate`;
- bloqueio antes do `bulkWrite` quando houver scrape parcial, fonte pequena ou colapso de aceitação;
- instrumentação de `fundamentalsHealthy`, `errorCode` e contagens em `lastSyncStats`, posteriormente exercitada no sync controlado;
- bloqueio de publicação manual e automática para STOCK/FII/BRASIL_10 quando a saúde fundamental estiver ausente, degradada ou tiver mais de 36 horas;
- relatório do `sync:prod` separado por classe, sem chamar operações externas de “ativos fundamentados”.

Validação live somente em memória: 994 ações parseadas, 333 aceitas com liquidez ≥R$ 5 mil, 236 com ≥R$ 200 mil e 199 com ≥R$ 1 milhão; health gate `ok=true`. PETR4, CMIG4, BBAS3, BBSE3, ITSA4 e SAPR11 retornaram ROE, liquidez, patrimônio, dívida e crescimento nas colunas corretas.

Testes deste estágio: suíte direcionada final com 32/32; suíte completa do servidor com **92 arquivos e 816 testes aprovados**, zero falhas. Todos os arquivos JavaScript alterados passaram em `node --check`.

Até o encerramento deste estágio inicial, nenhum `performFullSync`, `sync:prod`, `runBatchAnalysis`, publish, save de `MarketAnalysis`, migração ou correção de documento havia sido executado. A recuperação autorizada e realizada depois está documentada no adendo seguinte.

## Adendo de recuperação controlada — 19/07/2026

Antes de qualquer escrita foi criado o snapshot local `backup_audit_ranking_20260719_2025`, com cinco coleções, contagens e hashes SHA-256 registrados em `MANIFEST.md`. A política de rollback é seletiva por documento/campo para não apagar escritas concorrentes legítimas.

### Sync fundamental

O método `syncService.performFullSync()` foi executado uma única vez, de `2026-07-19T23:28:50Z` a `23:30:47Z`. Não houve chamada a publish.

| Classe | Parseados | Aceitos | Baixa liquidez | Duplicados | Taxa de aceitação |
|---|---:|---:|---:|---:|---:|
| STOCK | 994 | 333 | 661 | 0 | 33,50% |
| FII | 560 | 316 | 242 | 2 | 56,43% |
| Total fundamental | 1.554 | 649 | 903 | 2 | 41,76% |

O health gate foi persistido com `fundamentalsHealthy=true`. Foram atualizados 649 snapshots fundamentais, sendo 333 de STOCK. O sync também executou as etapas já integrantes de `performFullSync` — macro, cotações e universos externos — sem executar ranking ou publicação.

Durante a reconciliação apareceu uma segunda mudança de layout: a tabela FII passou de 13 para 14 colunas pela adição de `Endereço` no final. Como os 13 campos financeiros anteriores mantiveram posições e semântica, não houve deslocamento nem corrupção de fundamentos FII. O schema FII foi elevado para v2, com assinatura completa do cabeçalho e validação fail-closed. A captura live tinha 560 linhas e o parser v2 foi validado com sucesso.

### Saneamento e reconciliação

- Os três documentos contaminados pelo parser STOCK v1 (`ADMF3`, `PLTO5`, `PLTO6`) foram corrigidos em uma transação atômica, protegida pelo timestamp exato da escrita defeituosa.
- A liquidez correta dos três é zero; portanto, os três snapshots indevidos foram removidos. Os documentos foram preservados e agora têm os campos nas colunas semanticamente corretas.
- O sync criou quatro documentos STOCK que não existiam no baseline: `AZUL3`, `ENMT4`, `PASS3` e `SAUD3`.
- Os ativos-âncora `PETR4`, `CMIG4`, `BBAS3`, `BBSE3`, `ITSA4` e `SAPR11` foram reconciliados no banco com ROE, liquidez, patrimônio, dívida e crescimento nas posições corretas.

### Novo rascunho, sem publicação

Depois da reconciliação, `runBatchAnalysis(null)` foi executado para materializar rascunhos das sete classes. Todas as quatro flags de publicação dos documentos novos permaneceram falsas.

O novo draft STOCK é `6a5d5f287287c2814f6f2ca0`, criado em `2026-07-19T23:35:04.341Z`: 30 ativos, 11 `BUY` — 4 `DEFENSIVE`, 2 `MODERATE` e 5 `BOLD` — sem violação do invariante global `score ≥ 70 ⇔ BUY`. Hash canônico: `5854137d972b41a1648acc1b226fe0e19e0a0d585ad924eb9a0b51ec9453c64a`.

O documento publicado continua sendo `6a5658c1481e245978d1aebc`, de 14/07/2026, com 30 ativos e 8 `BUY` (4/2/2). Portanto, a recuperação não alterou a resposta publicada consumida pelo frontend.

Validação final: suíte completa do servidor com **92 arquivos e 818 testes aprovados**, zero falhas. O TXT local foi regenerado pelo batch, com 1.216.995 bytes, timestamp UTC `2026-07-19T23:35:29Z` e SHA-256 `F92B251F419AE2BC131CECB3BA8EEE967A0DE212AA9AE9F6A170A8B884BAE190`.

## Parte 1 — Resumo executivo para decisão

### Conclusão sobre os “quatro BUY”

**[VERIFICADO · confiança ALTA] O ranking publicado não contém quatro `BUY` no total. Ele contém oito.** Quatro é a quantidade de `BUY` do perfil `DEFENSIVE`, filtro selecionado por padrão no frontend.

- O documento publicado que vence a consulta da API é `MarketAnalysis 6a5658c1481e245978d1aebc`, criado em `2026-07-14T15:41:54.170Z` (12:41:54 BRT): 30 itens, 8 `BUY`, distribuídos em 4 `DEFENSIVE`, 2 `MODERATE` e 2 `BOLD`.
- A API retorna o ranking inteiro desse documento. A consulta vencedora foi reproduzida com a mesma condição do controller.
- O componente inicia `riskFilter` em `DEFENSIVE`, filtra o ranking pelo perfil e só então conta os `BUY` (`client/src/components/research/TopPicksCard.tsx:55`, `:81-100`, `:121`).
- O TXT local também contém 8 `BUY` no total (`reports/ranking_latest.txt:892-895`), igualmente distribuídos em 4/2/2.

Portanto, a anomalia relatada é principalmente uma **diferença de escopo visual**: “quatro exibidos na aba Defensivo” versus “oito existentes em todos os perfis”. Não foi encontrada evidência de um documento STOCK publicado com exatamente quatro `BUY` totais nos últimos 14 dias.

### Problema crítico independente encontrado

**[VERIFICADO · confiança ALTA] O sync de 19/07 raspou 994 linhas de ações, mas apenas 3 ações atravessaram o corte de liquidez da ingestão e receberam fundamentos novos.** O job foi considerado bem-sucedido porque o contador final mistura operações de STOCK, FII, cripto e ativos externos. A investigação read-only posterior confirmou a causa exata: o site adicionou `Mrg Bruta` no índice 12, deslocando em uma posição todos os campos posteriores, enquanto o schema local permaneceu com 21 colunas.

- O relatório declara 994 ações parseadas e 560 FIIs (`server/logs/sync-report.txt:94-97`).
- O código descarta silenciosamente qualquer linha cuja liquidez parseada seja menor que R$ 5 mil antes do `bulkWrite` e antes de qualquer `DiscardLog` (`server/services/syncService.js:130-145`).
- A fotografia do banco mostra somente 3 documentos STOCK com `lastFundamentalsDate` de 19/07 e somente 3 snapshots STOCK, contra 326 snapshots FII.
- Entre 341 ações atualmente elegíveis pelos flags, 326 têm fundamentos datados de 02/05/2026, 12 não têm data e somente 3 têm data de 19/07.
- O log “915 ativos fundamentados” é `operations.length`, que também recebe cripto e ativos externos (`server/services/syncService.js:231-310`, `:319-320`, `:452`). Ele não comprova que 915 fundamentos BR foram atualizados.
- No schema antigo, o índice de `liq2m` aponta para a célula atual de ROE; por isso apenas ADMF3, PLTO6 e PLTO5 passaram pelo corte de R$ 5 mil. A liquidez correta dos três é zero.
- Com o mapa atual de 22 colunas, 333 ações passariam o corte de R$ 5 mil; 236 também superariam R$ 200 mil e 199 superariam R$ 1 milhão.

O ranking ainda usa o cache antigo. Com 77–78 dias, ele ainda não recebe a penalidade de staleness, que começa somente acima de 90 dias (`server/services/engines/scoringEngine.js:113-125`). Se a ingestão continuar falhando, 326 ações se aproximam de uma queda simultânea de 15 pontos de confiança. Em uma simulação read-only de 02/08, mantendo os demais inputs constantes e acrescentando 14 dias à idade, 139 scores mudam, 107 perdem exatamente 15 pontos, os ativos com melhor score ≥70 caem de 14 para 4 e os `BUY` pós-concentração caem de 8 para 1. Isso é um cenário causal, não uma previsão de mercado.

### Confirmação da causa da ingestão — adendo read-only

**Captura da fonte:** 19/07/2026 20:05:41 BRT; HTTP 200; 761.770 bytes; SHA-256 `99ade3da87496e7695d8446c466febac5e90676cb6a298e31ef00aca0d8320eb`. O conteúdo foi analisado somente em memória e não foi persistido.

| Campo | Índice no schema v1 | Índice atual da fonte | O que o parser v1 lê hoje |
|---|---:|---:|---|
| `mrgEbit` | 12 | 13 | margem bruta |
| `netMargin` | 13 | 14 | margem EBIT |
| `currentRatio` | 14 | 15 | margem líquida |
| `roic` | 15 | 16 | liquidez corrente |
| `roe` | 16 | 17 | ROIC |
| `liq2m` | 17 | 18 | ROE |
| `patrimLiq` | 18 | 19 | liquidez de 2 meses |
| `divBrutaPatrim` | 19 | 20 | patrimônio líquido |
| `cresRec5a` | 20 | 21 | dívida líquida/patrimônio |

O schema está em `server/config/scraperSchemas.js:42-48`; a extração usa esses índices em `server/services/fundamentusService.js:139-145`. A página atual tem 22 células em todas as 994 linhas, enquanto `maxIdx` continua 20. O validador só rejeita linhas com **menos** de 21 células (`scraperSchemas.js:147-154`) e testa `roe` e `patrimLiq` apenas como números (`:54-59`). Depois do deslocamento, ROIC e liquidez continuam numéricos; portanto o validador devolve `ok=true` para um layout semanticamente quebrado.

Exemplos observados na mesma resposta:

| Ticker | ROE lido/real | Liquidez lida/real | Patrimônio lido/real |
|---|---:|---:|---:|
| PETR4 | 16,79 / 24,17% | 24,17 / R$ 1,60091 bi | R$ 1,60091 bi / R$ 445,189 bi |
| CMIG4 | 9,62 / 16,75% | 16,75 / R$ 159,821 mi | R$ 159,821 mi / R$ 28,8876 bi |
| BBAS3 | 0 / 7,71% | 7,71 / R$ 448,973 mi | R$ 448,973 mi / R$ 186,52 bi |

Conclusão causal: `parseBrFloat` funciona para o formato recebido; a falha é de **mapeamento semântico de colunas** e de **validação permissiva**, não de conversão numérica.

### O que está saudável

- O limiar efetivo é 70; os documentos mais recentes estão coerentes. A varredura histórica encontrou 15 documentos legados com action/score divergentes, sem ocorrência depois de 17/04.
- A ordenação e o tiebreak estrutural estão implementados no draft e no ranking principal.
- Macro atual: SELIC 14,25%, IPCA 4,64%, NTN-B longa 8,09%, `ratesStale=false`, com fontes BCB/BCB/Tesouro Transparente.
- Os diagnósticos oficiais `inspectRanking.js` e `diagnoseDraft.js` foram lidos antes do uso e não contêm escrita.
- Na Fase 8, 185 testes determinísticos focais e 13.500 verificações metamórficas passaram; isso comprova coerência local, não retorno econômico.

### Decisões prioritárias

1. **Fechar publicação/versionamento antes de recalibrar.** Snapshot imutável, ponteiro ativo, gate por seção, rollback e invariantes pós-IA são a maior prioridade restante.
2. **Escolher conscientemente o destino do draft recuperado.** Ele não deve ser publicado por acidente pelo cron nem confundido com a versão de 14/07.
3. **Unificar o pipeline e a linhagem.** Séries antes do ranking, `runId`, hashes/timestamps e baseline fixado devem valer em todos os entrypoints.
4. **Definir o contrato do produto.** BUY, veto da IA, objetivo do draft, tiers e comportamento com zero BUY exigem decisão do dono.
5. **Coletar shadow prospectivo antes de mudar threshold/pesos.** Os backtests atuais são exploratórios e não sustentam recalibração.

Não se deve reduzir o threshold, remover penalidades ou “forçar” mais `BUY` antes de corrigir ingestão, observabilidade e paridade. A escassez de oportunidades não pode ser calibrada com confiança enquanto a frescura dos fundamentos não é garantida.

## Parte 2 — Pipeline real e reconciliação dos “quatro BUY”

### Fluxo end-to-end observado

```text
Fundamentus/Yahoo/Google/Brapi + macro + séries
    -> MarketAsset/SystemConfig
    -> marketDataService.getMarketData (flags + deduplicação)
    -> scoringEngine.processAsset (scores dos 3 perfis + estruturais)
    -> portfolioEngine.performCompetitiveDraft (D -> M -> B; usedTickers global)
    -> penalidade de concentração pós-draft
    -> MarketAnalysis rascunho (flags de publicação false)
    -> enriquecimento IA opcional no mesmo documento
    -> publish manual ou auto-publish
    -> GET /research/latest
    -> ResearchViewer -> TopPicksCard
    -> filtro DEFENSIVE por padrão: 4 BUY visíveis de 8 totais
```

### Matriz de entrypoints

| Entrypoint | Ordem real | Dados frescos? | Falha tolerada? | Rascunho? | Publica? | Divergência |
|---|---|---:|---|---:|---:|---|
| `scripts/syncProdData.js` | full sync → reativação → séries → ranking → radar → backtest | Intenção: sim | Etapas finais não críticas | Sim | Não | Referência mais completa; `timeSeries` antes do ranking (`:46-76`) |
| cron manhã | full sync → ranking | Parcial | Erro capturado pelo cron | Sim | Não | Não atualiza séries antes do ranking (`schedulerService.js:475-503`) |
| cron pós-mercado | full sync → séries → ranking | Intenção: sim | Erro capturado pelo cron | Sim | Não | Alinhado com script local (`schedulerService.js:505-535`) |
| `/full-pipeline` | full sync → ranking → radar → séries → backtest | Não para beta/SMA da própria run | Séries são não críticas | Sim | Não | Ranking ocorre antes de séries (`researchController.js:271-292`) |
| `/crunch` bulk | `runBatchAnalysis` | Usa o cache atual | Handler falha em erro | Sim | Não | Não sincroniza dados (`researchController.js:302`) |
| `/crunch` por classe | `calculateRanking` → `MarketAnalysis.create` | Usa o cache atual | Handler falha em erro | Sim | Não | Caminho próprio de persistência (`researchController.js:303-305`) |
| `runRankingOnly.js` | conecta ao banco → batch | Usa o cache atual | Processo encerra em erro | Sim | Não | Mutante; não executado nesta auditoria |
| enriquecimento IA | último documento, publicado ou não → IA → salva o mesmo documento | Notícias atuais; ranking preexistente | Falha da IA propaga | Altera existente | Não diretamente | Pode alterar `action`; seleciona “último”, não “último rascunho” (`researchController.js:309`) |
| publicação manual | carrega ID → liga flags → salva | Não valida frescura | Sem gate material | Não | Sim | Sem mínimo, idade, invariantes ou hash (`researchController.js:312-345`) |
| auto-publicação | último doc → gate idade ≤7 dias e lista ≥5 → liga flags | Gate raso | Pula classe inválida | Não | Sim | Não valida dados, ações, ordenação ou completude (`schedulerService.js:359-410`) |

### Linhagem das duas versões

| Artefato | Identificador | Criado/gerado | Publicação | Total/BUY | Perfis BUY | Hash lógico |
|---|---|---|---:|---:|---:|---|
| Publicado e retornado pela API | `6a5658c1481e245978d1aebc` | 14/07 12:41 BRT | Sim | 30/8 | 4/2/2 | `899c8dd4462ab4b4…` |
| TXT local | SHA-256 `BFA71B87…E8516` | 19/07 13:20 BRT | Não; exporta a run em memória | 30/8 | 4/2/2 | composição equivalente ao draft `8696057a496b3ec1…` |
| Último draft observado | `6a5d43ad43384cb5b7756b37` | 19/07 18:37 BRT | Não | 30/8 | 4/2/2 | `8696057a496b3ec1…` |

São versões diferentes: o publicado é de 14/07 e o TXT é um rascunho de 19/07. A contagem 8, porém, é igual. O TXT inclui a classificação global; a UI mostra o subconjunto do perfil ativo.

### Linha do tempo STOCK — últimos 14 dias

**[VERIFICADO]** Foram encontrados 51 documentos gerados e 5 publicados. Contagens de `BUY` nos gerados: 7, 8, 10, 11, 14, 18, 19 e 20. Contagens nos publicados: 8, 19 e 20. Não há publicado com 4 `BUY` totais.

| Publicação | Documento | BUY total | D/M/B |
|---|---|---:|---:|
| 06/07 09:01 BRT | `6a4b9936…` | 20 | 9/4/7 |
| 06/07 10:12 BRT | `6a4ba9c2…` | 20 | 9/4/7 |
| 08/07 09:01 BRT | `6a4e3c0d…` | 19 | 8/4/7 |
| 13/07 09:01 BRT | `6a54d3a0…` | 8 | 4/2/2 |
| 14/07 12:41 BRT | `6a5658c1…` | 8 | 4/2/2 |

### Árvore causal quantitativa do snapshot de 19/07

```text
207 ações processadas pelo scoring
└─ 14 tinham score máximo entre perfis >= 70
   ├─ 5 foram selecionadas antes em perfil com score < 70
   │  RECV3, MILS3, AZZA3, VTRU3, POMO4
   └─ 9 BUY após atribuição greedy, antes da concentração
      ├─ PSSA3: 70 -> 65 por concentração
      └─ 8 BUY após concentração
         ├─ 8 no rascunho
         ├─ 8 no documento publicado atual
         └─ 4 visíveis por padrão no perfil DEFENSIVE
```

Não há “BUY latente completamente fora dos 30” neste snapshot. Há cinco ativos dentro dos 30 cujo melhor perfil seria `BUY`, mas cuja atribuição efetiva é `WAIT`. A penalidade pós-draft retira mais um `BUY`. O algoritmo não reotimiza depois da penalidade (`server/services/engines/portfolioEngine.js:111-164`).

## Parte 3 — Dados e funil

### Funil STOCK

As duas primeiras linhas são a ingestão fresca da run; as demais mostram o universo cacheado realmente usado pelo ranking.

| Etapa | Contagem | Evidência/observação |
|---|---:|---|
| linhas retornadas e parseadas da fonte STOCK | 994 | `sync-report.txt:94-97` |
| linhas que atravessaram o corte de ingestão e foram carimbadas em 19/07 | **3** | banco: 3 `lastFundamentalsDate` novos e 3 snapshots STOCK |
| documentos STOCK persistidos no acervo | 367 | fotografia read-only |
| `isActive=true` | 358 | 9 inativos |
| `isIgnored=true` | 8 | excluídos antes do scoring |
| `isBlacklisted=true` | 13 | excluídos antes do scoring |
| query elegível por flags | 341 | `isActive=true`, não ignorado, não blacklisted |
| após deduplicação por raiz de ticker | 283 | `marketDataService.getMarketData` |
| processados pelo scoring | 207 | 76 descartes |
| descartes por liquidez do scoring | 75 | `< R$ 200 mil/dia` |
| descarte por preço | 1 | preço ≤ 0,01 |
| elegíveis ao Defensivo | 57 | gate do scoring |
| score máximo entre perfis ≥70 | 14 | contrafactual de melhor perfil |
| selecionados pelo draft | 30 | 10 por perfil |
| BUY antes da concentração | 9 | ação pelo perfil atribuído |
| BUY depois da concentração | 8 | PSSA3 70→65 |
| BUY depois de IA no publicado atual | 8 | nenhum conflito observado |
| BUY salvos no draft | 8 | draft de 19/07 |
| BUY publicados | 8 | publicado de 14/07 |
| BUY exibidos no perfil padrão | **4** | filtro `DEFENSIVE` |

Diagnósticos complementares, não somáveis como etapas sequenciais: entre os 341 elegíveis por flags, 340 têm preço >0,01 e 233 têm liquidez ≥R$ 200 mil. A deduplicação ocorre antes dos descartes do scoring e mantém, por raiz de quatro letras, a classe com maior liquidez (`marketDataService.js:630-649`).

### Qualidade e atualidade por campo

| Campo lógico | Fonte/persistência | Fallback/ausência | Unidade | Atualidade usada | Risco observado |
|---|---|---|---|---|---|
| preço | Yahoo; Google/Brapi fallback → `lastPrice` | 0 invalida no scoring | BRL | `updatedAt`, sem timestamp de preço dedicado | médio |
| liquidez | Fundamentus → `liquidity` | 0; corte 5k na ingestão e 200k no scoring | BRL/dia | segue `lastFundamentalsDate` | **crítico: 991/994 linhas STOCK não atravessaram o corte** |
| P/L, P/VP, ROE, margens, EV/EBITDA, crescimento | Fundamentus → `MarketAsset` | parser converte vazio/`-` em 0 | %, razão | um único `lastFundamentalsDate` | valores ausentes e ruins podem se confundir |
| market cap e LTM | derivados do Fundamentus; carry-forward não zero | mantém valor antigo quando scrape vem 0 | BRL | recebe o mesmo timestamp geral | mistura de vintages sob um timestamp único |
| beta, volatilidade, SMA200, EMA50 | worker de histórico Yahoo | 0 desativa/penaliza partes do motor | razão/%/BRL | não há timestamp por campo | caminho manhã/full-pipeline pode usar valor velho |
| SELIC/IPCA | BCB; BrasilAPI/IBGE; fallback | guard de autoridade e `ratesStale` | % a.a./12m | SystemConfig | saudável no snapshot |
| NTN-B longa | Tesouro Transparente; Investidor10; último conhecido/hardcoded | plausibilidade de taxa real | % real a.a. | SystemConfig | saudável no snapshot |
| track record | `FundamentalSnapshot` mensal | `null` abaixo de 6 períodos | razões 0–1 | período mensal | totalmente dormente para STOCK |

Completude entre 341 ações elegíveis: P/L ausente/zero 6; P/VP 6; ROE 5; margem líquida 40; DY 102; payout 114; D/E 61; crescimento 7; EV/EBITDA 35; market cap 4; liquidez 1; beta 5; volatilidade 5; SMA200 7; EMA50 5.

O track record não está operacional para ações: 338/341 não têm snapshot, 3 têm somente um e nenhuma alcança o mínimo de 6 períodos (`server/utils/trackRecord.js:24-27`).

### Exclusões silenciosas

- `isActive`, `isIgnored` e `isBlacklisted` são aplicados na query antes de `processAsset`; por isso não entram no `DiscardLog` (`marketDataService.js:517-523`).
- O corte de R$ 5 mil da ingestão ocorre antes da persistência e não gera descarte (`syncService.js:142-145`).
- A deduplicação por `ticker.slice(0,4)` remove classes sem registrar o ticker eliminado (`marketDataService.js:630-649`).
- `calculateRanking` escreve `DiscardLog` assincronamente (`aiResearchService.js:292-294`); não é uma função puramente read-only apesar do nome.

### Bancos e seguradoras — reconciliado após a recuperação

O detector de confiança considera `netMargin=0` como rentabilidade ausente para qualquer ação (`scoringEngine.js:83-92`), embora o próprio score estrutural trate margem como “N/A” em setores financeiros. Isso penaliza bancos e seguradoras por uma métrica estruturalmente pouco aplicável.

- `BBAS3`: ROE 7,71%, margem 0, crescimento −8,63%, score D/M/B 21/15/16 no snapshot recuperado. Waterfall efetiva do Defensivo: base 40 + large cap 10 − tendência 6 − estatal 8 − confiança por “rentabilidade ausente” 15 = 21.
- Remover somente a ausência indevida de margem levaria o Defensivo de 21 a 36, ainda `WAIT`. Remover também a penalidade estatal levaria a 44, ainda `WAIT`. Logo BBAS3 não está categoricamente excluída; perde por combinação de snapshot, momentum, governança e ausência de bônus suficientes.
- `BBSE3` recebe −25 por crescimento zero e −15 por rentabilidade ausente, apesar de ROE 72,72% e margem tratada como N/A pelo score estrutural. Sua confiança cai a 60 e o score D/M/B fica 34/11/10.

## Parte 4 — Auditoria matemática do scoring de Ações — Fase 4 concluída

**Fotografia matemática:** `2026-07-19T23:44:38.802Z`; macro SELIC 14,25%, IPCA 4,64%, NTN-B longa 8,09%, `ratesStale=false`; 287 ações após filtros de flags/deduplicação, 203 processadas e 84 descartadas no scoring (83 por liquidez e uma por preço). A consulta foi somente leitura e não criou `MarketAnalysis`.

### Fórmulas efetivas e ordem de aplicação

| Perfil | Base/gate | Principais bônus | Principais descontos/caps |
|---|---|---|---|
| Defensivo | elegível: 40; inelegível: 30 sem os bônus internos | market cap +10/+4; DY +22/+16/+10/+5; ROE +15/+10/+5; upside +8/+5/+3; beta baixo +5; payout +5; track record até +7; “Aristocrat” +10 | P/VP −10/−5; beta −15/−8; volatilidade −20/−10; payout −30/−20; DL/EBITDA −15/−8; sobrepreço −20/−10; P/L caro sem âncora −20/−10; SMA200; ciclicidade; estatal −8; teto sem lucro 55 |
| Moderado | market cap >R$2 bi: 40 e ativa todos os modificadores internos; caso contrário: 25 e pula esse bloco | crescimento +22/+16/+10/+4; ROE +15/+10/+7/+3; upside +20/+15/+10/+5; track record +3; “Aristocrat” +5 | margem −15; ROE abaixo da Selic −20/−10; payout −10; sobrepreço −40/−25; SMA200; ciclo −8/−4; estatal −4; alavancagem −20/−10 e cap 70; sem lucro cap 72 |
| Arrojado | 35 para toda ação processada | PEG +30/+22/+12/+5; crescimento +25/+15/+8; upside +30/+20/+10/+5 | volatilidade −20/−10; payout −20; sobrepreço −40/−25; P/L caro −8/−4; SMA200 a 70% da penalidade-base; alavancagem −15/−8 e cap 75; sem lucro cap 82 |

O gate Defensivo exige liquidez ≥R$200 mil, market cap ≥R$1 bi, beta <1,5, setor não cíclico, ROE/margem/payout/alavancagem mínimos e, fora da lista de setores seguros, DY ≥6% com P/L ≤10 (`scoringEngine.js:138-190`). Os modificadores de Ações estão em `scoringEngine.js:291-694`.

Depois do score específico, Ações sofrem a dedução direta `100 − confidence`; recebem os bônus finais; passam pelo teto de confiança 100/85/70; e finalmente pelo clamp `[10, teto]` (`scoringEngine.js:1031-1125`). O clamp inferior e o teto normal de 100 não criam fator no audit log.

### Scores estruturais não são componentes do score de perfil

| Estrutural | Fórmula STOCK resumida |
|---|---|
| Qualidade | ROE até 25 + margem até 25 + D/E até 25 + crescimento até 25 + payout entre −30 e +15; clamp 0–100 |
| Valuation | P/L até 30 + P/VP até 30 + EV/EBITDA 20 + DY 20 + spread do earnings yield contra NTN-B entre −20 e +20; clamp 0–100 |
| Segurança | base 50 + porte ±20 + liquidez +10/−20 + alavancagem entre −40 e +10; clamp 0–100 |

Esses três scores são calculados separadamente (`scoringEngine.js:1128-1282`) e só influenciam o desempate no draft (`portfolioEngine.js:8-21`). Entretanto, são exibidos ao lado do score final em barras e radar (`AssetDetailModal.tsx:205-208,304-314,383-397`; `TopPicksCard.tsx:415-433`), sem esclarecer que não o compõem. **[VERIFICADO · ALTA]** Há risco de o usuário interpretar Qualidade/Valuation/Segurança como decomposição do número que determina `BUY`.

`ROIC` e `EMA50` não participam de nenhum score STOCK; EMA50 sequer participa da tese. Beta só altera o Defensivo; volatilidade altera Defensivo e Arrojado, mas não Moderado. Fluxo de caixa, recorrência de lucro e eficiência operacional também não entram no score de perfil.

### Distribuição pós-recuperação

| Perfil bruto | Mínimo | P25 | Mediana | P75 | Máximo | Scores ≥70 |
|---|---:|---:|---:|---:|---:|---:|
| Defensivo | 10 | 10 | 10 | 25 | 88 | 4 |
| Moderado | 10 | 10 | 10 | 27 | 96 | 3 |
| Arrojado | 10 | 10 | 19 | 40 | 96 | 11 |

A concentração reduziu 12 `BUY` do draft para 11: `DIRR3` caiu de 72 para 67 como terceiro ativo do balde imobiliário no perfil Arrojado. O único score bruto exatamente 70 é o Arrojado de `JHSF3`, mas o ticker foi atribuído ao Moderado com 80.

Confiança no universo processado: 161 ativos em 100; 2 em 95; 10 em 85; 26 em 70; 3 em 60; 1 em 55. Nenhum dos 11 `BUY` do novo draft tem confiança menor que 100. O teto de confiança não reduziu nenhum score nesta fotografia — a subtração direta já havia colocado todos abaixo do teto —, portanto a dupla incidência é **possível no código, mas não observada neste snapshot**. A regra ainda permite conceitualmente confidence <60, teto 70 e `BUY` exatamente em 70.

### Waterfalls dos 11 BUY do novo rascunho recuperado

| Ticker | Perfil | Score | Waterfall reconciliada |
|---|---|---:|---|
| MDNE3 | M | 96 | 40 base +22 crescimento +15 ROE +20 upside −6 tendência +5 Aristocrat |
| VTRU3 | B | 91 | 35 base +30 PEG +30 upside −4 tendência |
| RECV3 | B | 89 | 35 base +30 PEG +8 crescimento +20 upside −4 tendência |
| CMIG4 | D | 88 | 40 base +10 porte +16 DY +10 ROE +5 upside +5 payout −8 estatal +10 Aristocrat |
| JHSF3 | M | 80 | 40 base +10 crescimento +15 ROE +10 upside +5 Aristocrat |
| WIZC3 | D | 80 | 40 base +10 DY +15 ROE +5 payout +10 Aristocrat |
| CYRE3 | B | 77 | 35 base +30 PEG +8 crescimento +20 upside −8 tendência −8 alavancagem |
| TAEE11 | D | 76 | 40 base +10 porte +16 DY +10 ROE +5 payout −15 alavancagem +10 Aristocrat |
| ITSA4 | D | 76 | 40 base +10 porte +16 DY +10 ROE |
| MTRE3 | B | 75 | 35 base +30 PEG +8 crescimento +30 upside −8 tendência −15 alavancagem −5 cap de alavancagem |
| AZUL3 | B | 73 | 35 base +30 PEG +8 crescimento; guarda SMA200 indisponível |

Todos reconciliam exatamente com o score salvo e respeitam `score ≥70 => BUY`. Nenhum recebeu penalidade de concentração.

### Waterfalls dos oito BUY efetivamente publicados em 14/07

| Ticker | Perfil | Score | Waterfall do documento publicado `6a5658c1481e245978d1aebc` |
|---|---|---:|---|
| BRAV3 | B | 90 | 35 base +30 PEG +25 crescimento |
| ITSA4 | D | 81 | 40 base +10 porte +16 DY +10 ROE +5 payout |
| MDNE3 | M | 76 | 40 base +22 crescimento +15 ROE +15 upside −10 payout −6 tendência |
| WIZC3 | D | 75 | 40 base +10 DY +15 ROE −5 P/VP +5 payout +10 Aristocrat |
| LAVV3 | M | 75 | 40 base +22 crescimento +15 ROE +20 upside −10 payout −12 tendência |
| TAEE11 | D | 75 | 40 base +10 porte +10 DY +15 ROE +5 payout −15 alavancagem +10 Aristocrat |
| MTRE3 | B | 74 | 35 base +30 PEG +8 crescimento +20 upside −4 tendência −15 alavancagem |
| CMIG4 | D | 72 | 40 base +10 porte +5 DY +10 ROE +5 payout −8 estatal +10 Aristocrat |

Essas waterfalls pertencem ao snapshot antigo e não devem ser comparadas fator a fator com o draft recuperado como se fossem a mesma versão.

### Faixa de decisão: todos os ativos com melhor score entre 60 e 74

| Ticker | Melhor bruto | Perfil | Atribuição/final |
|---|---:|---|---|
| AZUL3 | 73 | B | B 73 BUY |
| DIRR3 | 72 | B | B 67 WAIT após concentração |
| ABCB4 | 69 | D | D 64 WAIT após concentração |
| TRIS3 | 69 | B | fora do draft |
| INTB3 | 67 | D | D 67 WAIT |
| CPFE3 | 65 | D | D 60 WAIT após concentração |
| DMVF3 | 65 | B | B 60 WAIT após concentração |
| GMAT3 | 65 | B | B 65 WAIT |
| PINE4 | 65 | B | M 56 WAIT |
| COGN3 | 63 | B | fora do draft |
| PFRM3 | 63 | B | fora do draft |
| RIAA3 | 63 | M | M 63 WAIT |
| VULC3 | 63 | M | D 57 WAIT |
| EUCA4 | 62 | M | M 62 WAIT |
| CSED3 | 61 | B | fora do draft |
| CURY3 | 61 | M | fora do draft |
| FIQE3 | 61 | M | M 61 WAIT |
| HBRE3 | 61 | B | fora do draft |
| PSSA3 | 60 | D | fora do draft |
| TGMA3 | 60 | M | fora do draft |

Penalidades na trilha do melhor perfil desses 20 ativos: tendência −106 pontos em 11 ativos; payout insustentável −90 em 7; sobrevalorização −30 em 2; rentabilidade ausente −30 em 2; liquidez abaixo de R$1 mi −30 em 1; volatilidade −30 em 3; alavancagem crítica −15 em 1; P/VP −10 em 2; beta −8 em 1; Selic/ciclo −4 em 1. São somas de eventos, não efeitos contrafactuais lineares — remover um fator pode acionar caps, gates ou alterar o draft.

### Dez ativos de maior score bruto fora do ranking

| Ticker | Melhor score/perfil | Estrutural Q/V/S | Observação |
|---|---|---|---|
| LAVV3 | 75 M | 70/100/60 | `BUY` latente; causa e contrafactual detalhados na Fase 5 |
| TRIS3 | 69 B | 60/100/50 | WAIT |
| COGN3 | 63 B | 65/100/60 | WAIT |
| PFRM3 | 63 B | 65/100/50 | WAIT |
| CSED3 | 61 B | 100/100/60 | estruturais altos não compõem o perfil |
| CURY3 | 61 M | 70/80/70 | WAIT |
| HBRE3 | 61 B | 45/100/0 | risco estrutural zero não impede score 61 |
| PSSA3 | 60 D | 100/75/80 | qualidade estrutural 100, mas score de compra 60 |
| TGMA3 | 60 M | 70/95/70 | WAIT |
| PGMN3 | 59 B | 65/100/70 | WAIT |

### Casos-âncora e pares privados — sem recomendação de investimento

| Caso | D/M/B | Conf. | Q/V/S | Causa dominante observada |
|---|---|---:|---|---|
| BBAS3 | 21/15/16 | 85 | 25/80/80 | ROE 7,71%, crescimento −8,63%, margem N/A cobrada em confiança, tendência −6 e estatal −8/−4 |
| ITUB4 | 56/31/40 | 85 | 90/75/80 | margem N/A também custa −15, mas ROE/DY compensam parcialmente |
| BBDC4 | 53/37/20 | 85 | 55/100/80 | margem N/A −15; fundamentos de perfil superiores aos de BBAS3 |
| BBSE3 | 34/11/10 | 60 | 50/60/80 | crescimento zero −25 + margem N/A −15 + P/VP −10 + estatal |
| PSSA3 | 60/30/25 | 100 | 100/75/80 | sobrevalorização e P/VP retiram 15 no Defensivo; sem desconto estatal |
| CMIG4 | 88/65/40 | 100 | 100/100/80 | fortes DY/ROE/payout/upside e Aristocrat superam −8 estatal |
| CPFE3 | 65/30/10 | 100 | 80/95/80 | sobrepreço/PVP retiram 15; cai a 60 por concentração |
| EGIE3 | 27/10/10 | 100 | 80/0/65 | fair price muito abaixo do preço gera forte sobrevalorização |
| PETR4 | 16/57/40 | 100 | 75/100/80 | gate cíclico zera acesso aos bônus Defensivos; no M perde −4 ciclo e −4 estatal |
| PRIO3 | 14/23/47 | 100 | 75/15/80 | gate cíclico; crescimento forte, mas valuation desfavorável |
| RECV3 | 14/52/89 | 100 | 100/100/60 | gate cíclico no D; PEG/crescimento/upside elevam o B |
| SAPR11 | 32/10/10 | 100 | 55/90/90 | sobrevalorização −10/−25 e estatal −8/−4 |
| SBSP3 | 35/26/25 | 100 | 100/40/80 | sem desconto estatal, mas sobrevalorização domina |

### Achados matemáticos da Fase 4

1. **[VERIFICADO · ALTA] “Dividend Aristocrat” não mede histórico.** O predicado usa apenas crescimento, ROE, DY, margem e payout do snapshot corrente (`scoringEngine.js:132-136`) e concede +10 D/+5 M. O track record verdadeiro é outro mecanismo e está dormente. O nome e a tese sugerem persistência não demonstrada.
2. **[VERIFICADO · ALTA] Métricas correlacionadas acumulam pontos.** No Defensivo, DY entra diretamente, influencia Bazin e o upside, integra o predicado Aristocrat e se combina com payout; ROE também entra diretamente e no Aristocrat. Em CMIG4, DY/ROE/payout/upside/Aristocrat representam 46 dos 88 pontos, embora não sejam cinco evidências independentes.
3. **[VERIFICADO · ALTA] PEG e crescimento são acumulativos no Arrojado.** Além disso, depois do primeiro tier, as condições de PEG não exigem PEG positivo (`scoringEngine.js:463-476`): P/L zero ou negativo com crescimento >10 pode receber +22. O teto de empresa sem lucro limita o máximo, mas não remove o bônus economicamente inválido.
4. **[VERIFICADO · MÉDIA] Momentum e ciclo podem contar o mesmo regime adverso mais de uma vez.** Uma cíclica abaixo da SMA200 recebe tendência amplificada; se também tiver P/L baixo e margem/ROE altos, recebe “pico de ciclo”; com Selic ≥12, recebe ainda o desconto de juros. POMO4 acumula −16, −8 e −4 no Moderado.
5. **[VERIFICADO · ALTA] Aplicabilidade setorial é inconsistente.** Margem zero de bancos/seguradoras é N/A no estrutural e na penalidade de margem, mas é “rentabilidade ausente” na confiança. Margem >100 de holdings também é N/A no estrutural, porém não perde confiança. BBAS3/ITUB4/BBDC4 perdem 15; ITSA4 com margem 203,91% não perde.
6. **[VERIFICADO · ALTA] O gate cíclico Defensivo é categórico.** INDUSTRIAL, COMMODITIES e rótulos de consumo cíclico são inelegíveis independentemente de qualidade, liquidez ou preço (`sectorTaxonomy.js:192-220`; `scoringEngine.js:148-152`). Isso explica D=16 para PETR4 apesar de Q/V/S 75/100/80. Se é excessivo, é decisão filosófica que exige contrafactual/backtest, não correção automática.
7. **[VERIFICADO · ALTA] Há grandes descontinuidades.** Market cap Moderado logo acima de R$2 bi troca base 25 por 40 e ativa todo o bloco de bônus; o gate Defensivo pode trocar um score elaborado por base 30; SMA200 salta −6/−12/−20 nos desvios de −8%/−15%/−25%; DY, ROE, P/VP e upside usam degraus rígidos. Isso tende a turnover perto das fronteiras.
8. **[VERIFICADO · MÉDIA] Clamp não é totalmente auditável.** O piso 10 e o teto normal 100 não geram fator. BBSE3 Arrojado tem soma bruta −5, mas score 10; sem acrescentar manualmente `clamp +15`, a waterfall persistida não reconcilia.
9. **[VERIFICADO · MÉDIA] Confiança tem dois mecanismos, mas a dupla incidência não ocorreu agora.** A dedução direta é observada; zero eventos de teto adicional no snapshot recuperado. O desenho ainda admite baixa confiança chegar a 70/BUY e precisa de teste/decisão explícita.
10. **[INFERÊNCIA · MÉDIA] O modelo mistura “possuir” e “comprar agora”.** Os estruturais poderiam representar durabilidade/valuation/segurança, mas não compõem a decisão. O score de perfil mistura qualidade corrente, preço justo, momentum, macro, governança e adequação ao perfil em um único número. Separar eixos é opção arquitetural a avaliar, não mudança autorizada.

### Draft competitivo e atribuição de perfil — Fase 5 concluída em shadow mode

A ordem real é `DEFENSIVE → MODERATE → BOLD`, com `usedTickers` global e dez vagas por perfil (`portfolioEngine.js:34-125`). O GOLD usa cap setorial 3 no Defensivo e 2 nos demais; o SILVER/BRONZE usa cap 3. Como candidatos GOLD bloqueados só voltam a competir no SILVER se ainda restarem vagas, o perfil pode completar dez nomes mais fracos no GOLD e nunca reconsiderar um nome forte bloqueado pelo cap estrito.

#### Diagnóstico do greedy atual

| Métrica | Resultado recuperado |
|---|---:|
| Selecionados | 30 (10/10/10) |
| BUY pré-concentração | 12 |
| BUY pós-concentração | 11 |
| Score total pós-concentração | 2.037 |
| Score médio | 67,90 |
| Arrependimento total de atribuição | 88 pontos |
| Composite estrutural médio/mínimo | 78,33 / 36,67 |
| Baldes distintos D/M/B | 5 / 7 / 5 |

Arrependimento por ativo, definido como `melhor score entre perfis − score bruto do perfil atribuído`:

| Ticker | Atribuído | Melhor perfil | Regret | Efeito |
|---|---:|---:|---:|---|
| EZTC3 | D 49 | B 81 | 32 | selecionado como WAIT; seria BUY no melhor perfil |
| AZZA3 | M 63 | B 92 | 29 | selecionado como WAIT; seria BUY no melhor perfil |
| POMO4 | M 63 | B 75 | 12 | selecionado como WAIT; seria BUY no melhor perfil |
| PINE4 | M 56 | B 65 | 9 | continua WAIT |
| VULC3 | D 57 | M 63 | 6 | continua WAIT |

Há exatamente um `BUY` bruto fora dos 30: `LAVV3`, M=75. Ele foi barrado no GOLD Moderado pelo cap estrito de dois ativos imobiliários; o target terminou completo com dez GOLD e, por isso, o ciclo SILVER — que permitiria o terceiro nome do setor — não foi executado.

O trace registrou bloqueios por cap setorial: D GOLD 3, D SILVER 5, M GOLD 5, B GOLD 11 e B SILVER 11. Depois de completar os targets, 24 candidatos Defensivos, 23 Moderados e 31 Arrojados com score >30 nem chegaram a ser avaliados. Isso não significa que deveriam entrar; significa apenas que “não avaliado porque o target já encheu” é hoje invisível no resultado persistido.

A concentração retirou cinco pontos de `ABCB4` (69→64), `CPFE3` (65→60), `DIRR3` (72→67) e `DMVF3` (65→60). Somente DIRR3 mudou de BUY para WAIT. A lista não é reotimizada depois da penalidade, embora exista candidato fora com M=75.

#### GOLD/SILVER/BRONZE não são níveis de recomendação

O draft atual selecionou 15 itens GOLD com action WAIT e um item SILVER com action BUY. Não houve BRONZE nesta fotografia. Portanto, os tiers descrevem a rodada mecânica de preenchimento, não qualidade absoluta nem `BUY/WAIT`; expô-los como “Elite/Oportunidade” sem essa ressalva pode induzir interpretação incorreta.

#### Contrafactual global

Foi usado um fluxo de custo mínimo determinístico, exclusivamente em memória. Restrições preservadas: um perfil por ticker, dez ativos por perfil, score bruto >30, até três ativos por balde/perfil e penalidade de cinco pontos na terceira vaga setorial. O modelo não reproduz os rótulos sequenciais GOLD/SILVER; ele representa o limite efetivo final. Nenhum resultado foi salvo.

| Cenário | BUY | Score total | Regret | Composite médio/mín. | Baldes D/M/B | Turnover vs atual |
|---|---:|---:|---:|---:|---|---:|
| Greedy atual | 11 | 2.037 | 88 | 78,33 / 36,67 | 5/7/5 | 0 |
| Maximizar score total | 15 | 2.096 | 6 | 78,94 / 55,00 | 4/7/5 | 4 nomes |
| Maximizar BUY, preservando mínimos atuais | 15 | 2.091 | 38 | 80,00 / 56,67 | 5/7/5 | 3 nomes |
| Minimizar regret | 15 | 2.094 | 0 | 78,11 / 55,00 | 5/7/5 | 4 nomes |
| Maximizar diversificação | 11 | 1.976 | 101 | 77,33 / 36,67 | 7/9/8 | 6 nomes |

No cenário “maximizar BUY”, foram preservados o menor score final atual (49) e o menor composite estrutural atual (36,67); o resultado melhora ambos ou os mantém. Entram `CEAB3`, `LAVV3` e `RDOR3`; saem `AURE3`, `DMVF3` e `SHUL4`. AZZA3 e POMO4 migram para BOLD; LAVV3 ocupa a terceira vaga imobiliária Moderada e cai 75→70; MTRE3 ocupa a terceira vaga imobiliária BOLD e cai 75→70. O total chega a 15 BUY sem mudar threshold ou score de qualquer ativo.

O cenário de score total aumenta 59 pontos (+2,9%), reduz regret em 82 e troca quatro nomes, mas permite score mínimo 45 — abaixo dos 49 atuais. O cenário de diversificação amplia os baldes distintos de 17 para 24, porém perde 61 pontos, não adiciona BUY, aumenta regret e troca seis nomes. Diversificação máxima isolada não é uma boa função objetivo.

#### Decisão da Fase 5

**[VERIFICADO · ALTA]** O greedy causa perda material de alocação neste snapshot, mas isso não prova superioridade econômica do otimizador. Os quatro BUY adicionais vêm sobretudo de realocar AZZA3, POMO4 e EZTC3 para BOLD e recuperar LAVV3; esses scores dependem de PEG/crescimento/upside, justamente onde a Fase 4 encontrou sobreposição e guarda de PEG defeituosa. Trocar o draft antes de corrigir/validar o scoring poderia apenas amplificar um erro anterior.

Recomendação de governança: manter o greedy produtivo como controle e executar o alocador global em shadow mode por várias runs, registrando score total, BUY, regret, turnover, baldes, persistência e desempenho prospectivo. Uma eventual troca exige critérios de estabilidade e não deve usar “mais BUY” como objetivo primário.

Não houve alteração de score, threshold, taxonomia, tunable, algoritmo produtivo ou documento de ranking nas Fases 4–5.

## Parte 5 — Estatais e governança — Fase 6 concluída em shadow mode

### Regra produtiva e corte temporal

O sistema não usa gate categórico de estatal. A lista hardcoded contém `PETR3/4`, `BBAS3`, `BBSE3`, `SAPR3/4/11`, `CMIG3/4`, `CSMG3` e `BRSR3/5/6` (`server/config/sectorTaxonomy.js:239-249`); o desconto é −8 Defensivo, −4 Moderado e zero Arrojado (`scoringEngine.js:600-613`). A Fase 6 adotou corte oficial em **19/07/2026**, consulta em fontes primárias na mesma data e nenhuma alteração produtiva.

O simulador reproduzível está em `server/scripts/auditStateGovernance.js`. Ele consulta o mesmo cache STOCK, altera a taxonomia somente em memória, restaura o `Set` ao final e não salva `MarketAnalysis`, `DiscardLog`, configuração ou publicação.

### Revalidação oficial da taxonomia

| Emissor/classes | Classificação em 19/07/2026 | Evidência oficial atual |
|---|---|---|
| Petrobras `PETR3/4` | controle direto federal | [RI Petrobras — composição de maio/2026](https://www.investidorpetrobras.com.br/visao-geral/composicao-acionaria/) |
| Banco do Brasil `BBAS3` | controle direto federal | [RI BB — composição acionária](https://ri.bb.com.br/o-banco-do-brasil/composicao-acionaria/) e [FAQ de propriedade](https://ri.bb.com.br/faq/propriedade/) |
| BB Seguridade `BBSE3` | controle indireto federal via BB | [Cadastro B3 — BB com 68,25%](https://sistemaswebb3-listados.b3.com.br/listedCompaniesPage/main/23159/BBSE/overview?language=pt-br) |
| Banco da Amazônia `BAZA3` | controle direto federal | [RI BASA — governança, atualizado em 30/06/2026](https://ri.bancoamazonia.com.br/governanca-e-sustentabilidade/estrutura-de-governanca/) e [Relatório Integrado 2025 — União 97% direta/indireta](https://cdn.bancoamazonia.com.br/bancoamazonia/Relatorio_de_Gestao_Anual_Integrado_2025_1_pdf_982f7a2beb.pdf) |
| Banco do Nordeste `BNBR3` | controle direto federal | [RI BNB — União 62,21% ON](https://ri.bnb.gov.br/governanca-e-sustentabilidade/estrutura-de-governanca/composicao-acionaria) |
| Telebras `TELB3/4` | controle direto federal | [ITR 1T26 — União 94,79% ON e 93,52% total](https://www.telebras.com.br/wp-content/uploads/2026/05/ITR-Informacoes-Trimstrais-1-TRI-2026.pdf) |
| Sanepar `SAPR3/4/11` | controle direto do Paraná | [RI Sanepar — Estado com 60,08% do voto](https://ri.sanepar.com.br/governanca-corporativa/composicao-acionaria) |
| Cemig `CMIG3/4` | controle direto de Minas Gerais | [RI Cemig — Estado com 50,97% ON](https://ri.cemig.com.br/governanca-corporativa/composicao-acionaria) |
| Banrisul `BRSR3/5/6` | controle direto do Rio Grande do Sul | [RI Banrisul — Estado com 98,13% ON](https://ri.banrisul.com.br/governanca-corporativa/estrutura-acionaria/) |
| Celesc `CLSC3/4` | controle direto de Santa Catarina | [RI Celesc — Estado com 50,18% ON](https://ri.celesc.com.br/a-celesc/composicao-acionaria/) |
| CEB `CEBR3/5/6` | controle direto do Distrito Federal | [RI CEB — GDF acionista majoritário](https://ri.ceb.com.br/conheca-a-ceb/historico-e-perfil-corporativo/) |
| Casan `CASN3/4` | controle direto de Santa Catarina | [DF 2025 — Estado com 90,43% ON/90,49% total](https://ri.casan.com.br/wp-content/uploads/2026/03/Relatorio-Anual-da-Administracao-e-Demonstracoes-Financeiras-2025-Casan-2.pdf) |
| Banpará `BPAR3` | controle direto do Pará | [RI Banpará — Estado com 99,9767%](https://ri.banpara.b.br/governanca-corporativa/composicao-acionaria/) |
| Banestes `BEES3/4` | controle direto do Espírito Santo | [RI Banestes — Estado com 92,48% ON](https://ri.banestes.com.br/governanca-corporativa/organograma-societario) |
| BRB `BSLI3/4` | controle direto do Distrito Federal | [AGO 30/04/2026 — DF com 56,48% ON](https://ri.brb.com.br/upload/files/4157_Ata-AGO-E-BRB-de-30-04-2026-Consolidada-Voto.pdf) |
| Banese `BGIP3/4` | controle direto de Sergipe | [RI Banese — Estado com 92% total](https://ri.banese.com.br/quem-somos/composicao-acionaria/) |
| Copasa `CSMG3` | **sem controle estatal desde 16/06/2026**; Estado com 5,03% e golden share | [RI Copasa — composição de 16/06/2026](https://ri.copasa.com.br/governanca-corporativa/composicao-acionaria/) e [Governo MG — conclusão da desestatização](https://www.agenciaminas.mg.gov.br/noticia/governo-de-minas-conclui-processo-de-desestatizacao-da-copasa-e-abre-novo-ciclo-para-o-saneamento-130335) |
| Copel `CPLE3` | corporation privatizada, sem controlador; Estado com 15,9% e golden share | [FAQ RI Copel — sem controlador desde agosto/2023](https://ri.copel.com/servicos-aos-investidores/perguntas-frequentes/) e [composição](https://ri.copel.com/governanca-corporativa/composicao-acionaria/) |
| Sabesp `SBSP3` | privatizada; participação estadual minoritária de 18% e golden share | [RI Sabesp — composição de 07/07/2026](https://ri.sabesp.com.br/governanca-corporativa/composicao-acionaria/) e [PPI-SP — processo concluído](https://www.ppi.sp.gov.br/projeto/sabesp-cia-de-saneamento-basico-do-estado-de-sao-paulo-selo-leiloado/) |
| EMAE `EMAE4` | privatizada; controle transferido ao Fundo Phoenix | [PPI-SP — privatização concluída em 2024](https://www.ppi.sp.gov.br/projeto/emae-empresa-metropolitana-de-aguas-e-energia-leiloado/) |
| Axia/Eletrobras `AXIA3/7` | true corporation; voto governamental limitado a 10%, grupo governo 40,40% ON e golden share | [RI Axia — perfil e limite de voto](https://ri.axia.com.br/a-axia/perfil-corporativo/), [composição de junho/2026](https://ri.axia.com.br/a-axia/estrutura-acionaria-composicao-acionaria/) e [B3 — troca ELET→AXIA](https://www.b3.com.br/pt_br/noticias/toque-de-campainha-8AE490C99D724062019D7C2AB06525DC.htm) |

**[VERIFICADO · ALTA]** A lista atual tem um falso positivo (`CSMG3`) e omite 18 classes de dez emissores controlados: `BAZA3`, `BNBR3`, `CLSC3/4`, `CEBR3/5/6`, `TELB3/4`, `CASN3/4`, `BPAR3`, `BEES3/4`, `BSLI3/4` e `BGIP3/4`. A normalização remove apenas sufixo fracionário `F`; ela não resolve aliases históricos nem mudança de ticker. O comentário ainda cita `ELET3/6` e `CPLE6`, enquanto a B3 migrou Eletrobras para `AXIA3/5/6` em novembro/2025 e, em junho/2026, restaram `AXIA3/7`; o cache atual ainda entregou `AXIA6`. Isso é dívida de master data independente da penalidade estatal.

No universo deduplicado atual havia 287 ativos brutos e 203 pontuados. Oito emissores controlados sobreviveram ao corte: `BAZA3`, `BBAS3`, `BBSE3`, `BRSR6`, `CLSC4`, `CMIG4`, `PETR4` e `SAPR11`. `BNBR3`, `BEES3`, `BGIP3`, `BSLI3`, `CEBR3` e `TELB4` foram descartados por liquidez abaixo de R$200 mil/dia; Casan e Banpará não estavam no cache. Portanto, o erro cadastral é amplo, mas nesta fotografia só `BAZA3` e `CLSC4` eram falsos negativos pontuados, e nenhum deles chegou ao draft.

### Isolamento causal por ativo

Scores são `D/M/B`. “Sem desconto” remove apenas −8/−4/0 da taxonomia produtiva, respeitando clamps. “Taxonomia corrigida” aplica −8/−4 ao controle direto, −4/−2 ao indireto e zero a participação minoritária/golden share/corporation; é um desenho shadow explicável por direitos de controle, **não calibrado empiricamente**. “Dados aplicáveis” usa margem como N/A para bancos/seguradoras, sem imputar valor.

| Ticker | Controle | Atual | Sem desconto | Graduado/taxonomia correta | Somente dados aplicáveis | Gate/draft atual |
|---|---|---|---|---|---|---|
| BAZA3 | direto; omitido | 27/10/12 | 27/10/12 | 19/10/12 | 42/21/27 | elegível D; fora do draft |
| BBAS3 | direto | 21/15/16 | 29/19/16 | 21/15/16 | 36/30/31 | elegível D; fora do draft |
| BBSE3 | indireto | 34/11/10 | 42/15/10 | 38/13/10 | 49/26/10 | elegível D; fora do draft |
| BRSR6 | direto | 55/46/46 | 63/50/46 | 55/46/46 | 70/61/61 | elegível D; fora no atual; com N/A entra D=70 e cai a 65 por concentração |
| CLSC4 | direto; omitido | 42/15/10 | 42/15/10 | 34/11/10 | n/a | elegível D; fora do draft |
| CMIG4 | direto | 88/65/40 | 96/69/40 | 88/65/40 | n/a | D BUY 88, posição 4, sem concentração |
| PETR4 | direto | 16/57/40 | 24/61/40 | 16/57/40 | n/a | gate cíclico bloqueia D; M WAIT 57, posição 24 |
| SAPR11 | direto | 32/10/10 | 40/10/10 | 32/10/10 | n/a | elegível D; fora do draft |
| CSMG3 | Estado minoritário + golden; falso positivo | 22/10/10 | 30/14/10 | 30/14/10 | n/a | fora do draft |

Nenhuma penalidade foi removida como “duplicada”: há sobreposição conceitual possível em `PETR4` entre controle, ciclo, beta/volatilidade e política de payout/preços, mas não existe decomposição empírica que prove dupla contagem. Tratar suspeita como delta somável seria falsa precisão. O contrafactual “sem desconto” já isola o único termo explicitamente estatal.

`BBAS3` falha por combinação, não por uma causa única: D=21; retirar somente controle leva a 29; corrigir somente a aplicabilidade da margem leva a 36; fazer ambos levaria a 44, ainda `WAIT`. O restante vem principalmente de ROE 7,71%, crescimento −8,63%, tendência −6 e ausência de bônus de DY/valuation suficientes. Não há gate estatal nem problema de atribuição de perfil, pois nenhum perfil chega a 30 no cenário completo citado.

### Cenários A–E sobre o mesmo snapshot

| Cenário | BUY | Score total | Penalidade de concentração | Estatais selecionadas | Mudança/turnover vs A | Perfis/concentração |
|---|---:|---:|---:|---|---|---|
| A — regra atual | 11 | 2.037 | 20 | CMIG4 D 88 #4 BUY; PETR4 M 57 #24 WAIT | 0 | máximo por balde D/M/B = 3/2/3 |
| B — sem desconto fixo | 11 | 2.049 | 20 | CMIG4 D 96 #1; PETR4 M 61 #20 | 0 | nenhum perfil muda; 3/2/3 |
| C — risco graduado por direitos de controle | 11 | 2.037 | 20 | CMIG4 D 88 #4; PETR4 M 57 #24 | 0 | nenhum perfil muda; 3/2/3 |
| D — somente metadado/alerta | 11 | 2.049 | 20 | igual a B | 0 | nenhum perfil muda; 3/2/3 |
| E — exclusão categórica, controle negativo | 11 | 2.005 | 25 | nenhuma | 2 nomes | saem CMIG4/PETR4; entram LAVV3/RDOR3; FIQE3 M→D; máximo 3/3/3 |

A correção isolada da taxonomia, mantendo desconto fixo, não alterou nenhum selecionado, posição ou BUY neste snapshot. A correção isolada de aplicabilidade de dados trocou `BMGB4` por `BRSR6`, moveu `ABCB4` de D para M e elevou o total em um ponto; `BRSR6` entrou com D=70, mas a concentração bancária retirou cinco pontos e preservou `WAIT`. Isso reforça que qualidade de dados e draft têm mais efeito marginal que o rótulo estatal nesta fotografia.

Não há desempenho histórico comparável válido para A–E. O repositório não possui ranking/data/algoritmo point-in-time versionados nem track record suficiente; usar preços atuais ou histórico survivorship-biased fabricaria evidência. O resultado é causal no snapshot, não prova econômica de retorno futuro.

### Pares e adequação à filosofia

Os pares privados já auditados na Fase 4 não sustentam uma condenação categórica: `CMIG4` (88) supera `CPFE3` (65 bruto/60 final) e `EGIE3` (27), enquanto `SAPR11` (32) fica próxima de `SBSP3` privatizada (35). Em petróleo, o gate cíclico domina tanto `PETR4` (D=16) quanto `PRIO3/RECV3` (D=14), mostrando que boa parte do tratamento setorial independe do controlador. Em bancos, `BBAS3` (21) perde para `ITUB4` (56) e `BBDC4` (53), mas os três perdem 15 pela mesma margem N/A; `BRSR6` chega a 70 bruto quando essa falha é corrigida. Esses são scores do modelo, não comparação histórica completa de solvência, interferência política ou retorno.

**Decisão da Fase 6:** controle estatal não deve ser gate. O desconto atual é opinião codificada — não há estudo, coeficiente, backtest ou referência que calibre −8/−4/0 — e a lista manual já ficou desatualizada. A recomendação é manter **metadado obrigatório e temporal**, separar controle direto, indireto e direitos especiais, e testar um risco graduado em shadow mode. Efeito em score só deve permanecer após calibração walk-forward que demonstre poder incremental além de setor, beta, volatilidade, payout, valuation e qualidade. Até lá, D (metadado sem score) é o baseline epistemicamente mais defensável; C é o candidato experimental. A exclusão E é rejeitada pelo controle negativo.

## Parte 6 — Publicação, integridade e versão exibida — Fase 7 concluída

### Cadeia real e ordens concorrentes

```text
sync/cache -> [séries antes OU depois] -> calculateRanking
 -> sete MarketAnalysis independentes e não publicados
 -> [enhance IA opcional, no próprio documento]
 -> gate manual OU auto-publish semanal
 -> flags no documento
 -> GET /research/latest seleciona qualquer seção publicada
 -> Research / Comparador / Dashboard / rebalance / carteira recomendada / backtest
```

Não existe um pipeline canônico único. `syncProdData` e o cron das 18:30 executam séries temporais **antes** do ranking; `/full-pipeline` executa ranking antes das séries; o cron das 09:00 e `/crunch` não atualizam as séries imediatamente antes. Assim, a mesma base fundamental/preço pode usar beta, volatilidade, SMA e EMA de vintages diferentes conforme o entrypoint.

`runBatchAnalysis` grava as classes sequencialmente (`STOCK -> FII -> CRYPTO -> STOCK_US -> REIT -> ETF -> BRASIL_10`). Cada `MarketAnalysis.create` é isolado: não há transação, batch ID comum ou manifest de completude. Falha em uma criação deixa as classes anteriores persistidas e as seguintes ausentes; falha interna de cálculo vira ranking vazio, que ainda é salvo como rascunho. `BRASIL_10` depende dos objetos STOCK/FII daquela execução, mas essa relação também não fica persistida.

### Persistência, IA e invariantes

O documento não guarda `runId` comum, versão do algoritmo, hash/versão dos inputs, timestamps por fonte/campo, `publishedAt`, `updatedAt`, revisão ou ponteiro de versão ativa. O `runId` existente serve apenas aos `DiscardLog`, não vincula os sete `MarketAnalysis`.

O delta atual parte corretamente do último `isRankingPublished=true`, e não do último draft. Porém, cada classe consulta esse baseline durante sua própria execução, e a comparação faz outra consulta independente; o ID do baseline não é persistido nem fixado no início do batch. Uma publicação concorrente pode, portanto, misturar baselines dentro da mesma run.

O enriquecimento IA opera sobre o documento mais recente, publicado ou não, e substitui `content.ranking` **in place**. Se o documento já estiver publicado, continua publicado sem nova revisão. A IA pode vetar `BUY` para `WAIT` mantendo `score >= 70`; depois ordena apenas por score, sem o desempate estrutural soberano, e não recalcula `position`, `previousPosition`, comparação, prompt explicável ou auditoria completa. O campo `aiMetadata` retornado pelo serviço não existe no schema do item e tende a ser descartado pelo Mongoose.

A auditoria read-only de 1.129 documentos encontrou 15 documentos históricos com `action/score` incoerentes, os mesmos 15 com ordem e posição incoerentes; a ocorrência mais recente foi em 17/04/2026. Foram encontrados 315 documentos históricos cujo `previousPosition` não reconcilia com o último publicado anterior pelo contrato atual; a última ocorrência detectada foi em 02/07/2026. Os drafts e publicados mais recentes não exibem essas anomalias, mas o caminho de mutação continua aberto.

### Gate manual versus automático

| Controle atual | Manual | Automático semanal |
|---|---:|---:|
| documento existe | sim | sim |
| ranking com pelo menos 5 itens | não | sim |
| idade máxima de 7 dias | não | sim |
| Fundamentus saudável e confirmado em até 36h | STOCK/FII/BRASIL_10 | STOCK/FII/BRASIL_10 |
| conteúdo da seção realmente presente | não | não |
| macro/séries válidos | não | não |
| ação, sort, posição, delta, perfil e duplicidade | não | não |
| cobertura/completude por classe e desvio do baseline | não | não |
| batch completo/versionado | não | não |

O endpoint manual aceita `analysisId/type` sem schema Zod. Um tipo desconhecido pode salvar nada e ainda responder “Publicado”. É possível publicar análise antiga, mas como não há ponteiro ativo nem despublicação transacional da nova, isso não constitui rollback determinístico.

O auto-publish seleciona o documento mais recente de cada classe, independentemente de ele pertencer a um batch completo, e marca ranking, relatório e IA explicável como publicados em sete saves separados. Não exige que relatório ou IA tenham conteúdo. Falha no meio gera publicação parcial entre classes; cada exceção é absorvida e o loop prossegue.

### Estado real observado em 19/07/2026

Consulta somente leitura às 21:35 BRT:

| Classe | Docs | Rankings publicados | Drafts | Itens no último draft | Último ranking publicado |
|---|---:|---:|---:|---:|---|
| BRASIL_10 | 190 | 44 | 146 | 10 | 14/07 12:42 BRT |
| CRYPTO | 190 | 44 | 146 | 16 | 14/07 12:41 BRT |
| ETF | 109 | 20 | 89 | 41 | 14/07 12:42 BRT |
| FII | 190 | 46 | 144 | 30 | 14/07 12:41 BRT |
| REIT | 106 | 18 | 88 | 24 | 14/07 12:42 BRT |
| STOCK | 190 | 46 | 144 | 30 | 14/07 12:41 BRT |
| STOCK_US | 154 | 31 | 123 | 30 | 14/07 12:42 BRT |

No snapshot, a versão escolhida pela API coincide com o último ranking publicado em todas as classes; portanto, não há vazamento ativo de draft hoje. Porém, os sete documentos publicados mais recentes têm `isMorningCallPublished`, `isReportPublished` e `isExplainableAIPublished=true` sem Morning Call nem texto de IA. No histórico completo: 177 documentos publicaram a flag de IA sem texto e 164 publicaram Morning Call sem texto. Não havia ranking publicado vazio, ticker duplicado ou perfil inválido no snapshot auditado.

### Seleção da API, frontend e consumidores

`GET /research/latest` seleciona o documento mais novo que tenha **qualquer** uma das flags ranking, Morning Call ou IA. Logo, um documento mais recente com somente IA/Morning Call publicado pode sombrear o último ranking válido e incluir no payload seu ranking ainda não publicado.

A página principal Research verifica `isRankingPublished` antes de renderizar a lista, mas o deep link procura e abre ativo em `content.ranking` antes dessa verificação. O Comparador e o `scoreMap` do Dashboard consomem o array sem checar a flag; a carteira do usuário pode, assim, receber score/action de um draft. O modal de aporte também recebe o array sempre que presente. O risco é alcançável no código, embora não estivesse ativo na fotografia do banco.

No ranking visível, `TopPicksCard` inicia em `DEFENSIVE`, filtra o perfil, reordena por score e corta 10. Isso explica o “Top 10” por perfil e os quatro BUY visíveis, mas perde o desempate estrutural no frontend. Cada item persistido tem um único perfil; o frontend não escolhe o melhor perfil do ativo.

Os consumidores de backend que carregam ranking publicado filtram corretamente a flag. A carteira recomendada exige `action='BUY'`; o rebalanceamento também usa action para novos ativos, mas permite reforço de holding apenas por `score >=70`, ignorando eventual veto `WAIT`. O backtest de acurácia avalia os dez maiores scores, não a cesta de `BUY`, questão aprofundada na Fase 8.

### Notificações, retenção e rollback

O broadcast é disparado sem `await`, não tem chave idempotente/índice único e falhas são absorvidas pelo serviço. Uma corrida manual/automática pode duplicar; encerramento do processo após o save pode omitir. Foram encontrados 167 broadcasts e nenhum par da mesma classe em até cinco minutos, portanto o risco é de desenho, não incidente observado.

O índice TTL remove apenas drafts após 90 dias e declara publicados como histórico canônico. Porém, `cleanupService` apaga **todo** `MarketAnalysis` com mais de 120 dias, inclusive publicado. Em 19/07 o histórico publicado disponível ia apenas de 13/04 a 14/07 (249 documentos). Não há snapshot imutável, ponteiro ativo ou mecanismo de rollback para a última versão válida.

### Matriz pré-publicação recomendada — sem implementação

| Controle | Atual manual | Atual automático | Risco | Regra proposta | Bloqueia ou alerta? |
|---|---:|---:|---|---|---|
| quantidade e cobertura do universo | só saúde BR | `>=5` | cinco itens podem representar colapso severo | manifest por classe com bruto, elegível, pontuado e ranqueado; comparar com piso histórico rolling e sync da própria run | bloqueia colapso/zero; alerta desvio moderado |
| completude por campo crítico | não | não | score confiável sobre dados faltantes/mixed vintage | matriz classe×campo; preço/moeda/tipo obrigatórios em 100% dos publicados e cobertura mínima calibrada dos campos usados por perfil | bloqueia campo estrutural; alerta degradação não estrutural |
| staleness por campo/fonte | Fundamentus agregado até 36h | idem | timestamp único esconde vintages mistos | timestamps por família/input; limite compatível com frequência da fonte e flag explícita de fallback | bloqueia input vencido que afeta action; alerta fallback tolerado |
| macro válido | não | não | fallback silencioso muda score | registrar fonte, valor, `asOf` e fallback; validar faixa e idade antes do cálculo/publicação | bloqueia inválido; alerta fallback fresco |
| séries temporais frescas | não | não | entrypoints divergem em beta/SMA/EMA | séries antes do ranking; manifest com `asOf`; mesma sessão de mercado da run ou tolerância declarada por classe | bloqueia auto; override manual auditado |
| `action ⇔ score>=70` pós-mutações | não | não | consumidores discordam | derivar action no último estágio; IA gera alerta/veto separado, nunca action divergente | bloqueia |
| sort, tiebreaker, posição e delta | não | não | ranking/UX/setas incoerentes | ordenar soberanamente, renumerar, então calcular delta contra ponteiro do último ranking ativo | bloqueia |
| um perfil por ticker e sem duplicatas | não | não | dupla exposição/atribuição | schema/validador garante ticker normalizado único e exatamente um perfil válido | bloqueia |
| BUY/score versus baseline | não | não | colapso ou salto passa silencioso | comparar contagem, mediana e distribuição com últimas versões válidas e explicar waterfall da mudança | alerta; mudança extrema exige revisão manual |
| composição/turnover | não | não | churn excessivo sem causa de mercado | Jaccard/turnover por perfil/classe com banda rolling e lista causal dos maiores deltas | alerta; extremo suspende auto |
| batch ID e completude entre classes | não | não | mistura/ausência parcial | `runId` comum + manifest esperado/concluído + status `CALCULATED/VALIDATED` | bloqueia auto se batch incompleto |
| versão de algoritmo/input | não | não | irreprodutível | commit/semver do motor, config versionada, hashes e timestamps de cada input | bloqueia auto após período shadow; alerta legado |
| conteúdo por seção | não | não | flag publicada vazia | seção só pode ser ativada se payload validado e não vazio; ranking nunca vaza por flag alheia | bloqueia a seção |
| publicação atômica/versão ativa | não | não | sete classes ou seções ficam parciais | snapshot imutável + transação que move ponteiros ativos somente após todos os gates | bloqueia |
| notificação idempotente | não | não | duplicada/ausente | outbox transacional com chave `runId+classe+seção+revisão` e retry observável | alerta operacional; não invalida ranking já ativo |
| rollback | não | não | não há retorno confiável | manter versões publicadas imutáveis e ponteiro para última válida; rollback troca ponteiro e registra ator/motivo | requisito para ativar auto-publish novo |

**Decisão da Fase 7:** o ranking atual exibido é o documento publicado de 14/07, mas a cadeia não garante essa propriedade. Antes de recalibrar score ou draft, é prioritário instituir snapshot imutável/versionado, pipeline canônico, validador único pós-IA e seleção de endpoint por seção/ponteiro ativo. Gates de anomalia devem começar em shadow mode; invariantes determinísticos e conteúdo ausente podem bloquear imediatamente quando implementados. Escassez legítima de BUY deve gerar alerta explicável, não bloqueio automático por quantidade de BUY.

## Parte 7 — Validação determinística e econômica — Fase 8 concluída

Comando seguro, sem conexão ao MongoDB:

```text
npm.cmd exec vitest -- run tests/scoring_engine.spec.js tests/scoring_parity.spec.js
tests/portfolio_engine.spec.js tests/portfolio_draft_edge.spec.js
tests/ranking_invariants.spec.js tests/research_ranking_contract.spec.js
tests/research_delta.spec.js tests/auto_publish_gate.spec.js
tests/pipeline_integration.spec.js tests/time_series_staleness.spec.js
tests/fundamentus_parse.spec.js tests/ingestion.spec.js tests/brasil10.spec.js
tests/ranking_credibility.spec.js
```

Resultado: **14 arquivos aprovados, 128 testes aprovados, 0 falhas**, duração Vitest 3,74 s. A primeira tentativa com `npm` falhou pela política PowerShell; a repetição com `npm.cmd` passou.

Verificação determinística ao concluir a Fase 4: `scoring_engine`, `scoring_parity`, `ranking_invariants`, `ranking_credibility`, `portfolio_engine` e `portfolio_draft_edge` — **6 arquivos, 83 testes aprovados, zero falhas**, duração 2,23 s. Os testes rodam sem conexão ao MongoDB.

Verificação ao concluir a Fase 6: `scoring_engine`, `scoring_parity`, `portfolio_engine`, `portfolio_draft_edge` e `ranking_invariants` — **5 arquivos, 64 testes aprovados, zero falhas**, duração Vitest 958 ms. O simulador A–E também passou em `node --check` e foi executado read-only sobre 287 ativos brutos/203 pontuados.

Verificação ao concluir a Fase 7: `auto_publish_gate`, `ingestion_health`, `research_gating`, `research_ranking_contract`, `research_delta`, `ranking_invariants`, `pipeline_integration`, `rebalance_service` e `recommended_basket` — **9 arquivos, 64 testes aprovados, zero falhas**, em duas execuções Vitest. `auditPublicationIntegrity.js` passou em `node --check` e consultou o banco somente para leitura. Os testes verdes não cobrem seleção por seção, mutação de documento publicado, atomicidade entre classes, conteúdo publicado vazio, outbox/idempotência ou retenção canônica; por isso não invalidam os achados da Fase 7.

Lacuna original, posteriormente corrigida: os testes de parser/ingestão usavam amostras STOCK de 21 colunas e não protegiam a inserção numérica no meio. Os schemas STOCK e FII v2 agora validam largura exata e assinatura ordenada do cabeçalho; o health gate valida tamanho da fonte, aceitação e duplicidade por classe. Após a recuperação e a atualização da fixture FII para 14 colunas, a suíte completa passou com 92 arquivos/818 testes.

### Testes determinísticos adicionais da Fase 8

A suíte focal foi repetida com `NODE_ENV=test` e `MONGO_URI` apontando para um nome local de teste, sem conexão ao MongoDB real: **21 arquivos, 185 testes aprovados, zero falhas**, duração Vitest 3,61 s. Ela incluiu scoring, snapshots de paridade, refinamentos 1–3, draft, invariantes, pipeline, ingestão, delta, publicação, Brasil 10, staleness, seleção da carteira recomendada e a regra de holding do backtest legado.

O auditor puro `auditScoringMetamorphic.js` executou 500 STOCK sintéticas com seed fixa. Para cada ativo, varreu ROE, ROIC, margem, crescimento, alavancagem, beta, volatilidade e P/L em direção economicamente favorável, nos três perfis: **13.500 verificações**, nenhuma regressão metamórfica, nenhum score não finito/fora de 10–100. Os limites `price=0,01`, `price>0,01`, liquidez `199.999` e `200.000` também respeitaram o contrato. O teste prova propriedades locais dentro do domínio amostrado; não prova retorno nem monotonicidade para combinações fora dele.

### Lacunas de regressão ainda abertas

| Achado/risco | Teste proposto | Aceitação |
|---|---|---|
| PEG nulo/negativo premiado | tabela `PEG <=0`, `0+`, 0,5/1/2 e missing | nenhum bônus PEG sem numerador/denominador positivo |
| clamp não reconciliado | propriedade `base + fatores + normalização = score` | waterfall fecha para scores 10 e 100 |
| IA altera action/ordem | ranking sintético passa por enhance mockado e validador final | action derivada do score; tiebreaker/posição/delta preservados |
| paridade de entrypoints | todos chamam o mesmo orquestrador com snapshot/hash congelado | ranking e manifest byte-equivalentes |
| batch/publicação parcial | falha injetada em cada classe/seção | ponteiro ativo não muda e nenhuma seção parcial vaza |
| data efetiva da recomendação | cálculo sexta, publicação sábado, execução segunda | entrada usa primeira cotação negociável após publicação |
| saída por omissão | queda entre publicações e remoção posterior | saída usa cotação executável na data efetiva, nunca preço antigo |
| proventos/splits | série com split e dividendo conhecidos | retorno total e unidades reconciliam exatamente |
| ativo sem preço/delistado | série interrompida e evento de delisting | não omite nem congela silenciosamente; política conservadora explícita |
| zero BUY | publicação posterior sem nenhum BUY | comportamento caixa/saída declarado e testado; não mantém cesta por acidente |
| custos | rebalance conhecido com spread/corretagem/slippage | retorno líquido = bruto − custos e turnover reconciliado |
| versão histórica | duas versões do motor no mesmo período | métricas segmentadas; nunca agregadas como uma estratégia única |
| threshold/ablação | folds temporais congelados, thresholds/famílias predefinidos | escolha somente fora da amostra, com custos e intervalos de confiança |

### Veredito sobre backtest válido

**Não existe hoje profundidade point-in-time para validar economicamente o scoring atual.** `FundamentalSnapshot` começou em 23/06/2026; na fotografia auditada, 338/341 STOCK não tinham snapshot, três tinham apenas um e zero alcançavam os seis períodos mínimos. O histórico publicado disponível vai de 13/04 a 14/07 por causa da retenção de 120 dias. Desde abril, `scoringEngine` teve 16 commits e `portfolioEngine` oito, mas `MarketAnalysis` não registra versão do algoritmo/configuração. Misturar esses documentos mede várias estratégias não identificadas.

Logo, retorno total, alpha, Sharpe, Sortino, drawdown, payoff, calibração do 70 e ablações históricas do modelo atual são **não verificáveis** com rigor. Reaplicar hoje o scoring sobre preços antigos usaria fundamentos/universo atuais e introduziria look-ahead e survivorship bias. O script `stressTest2020.js` faz exatamente um contrafactual inválido para validação: aplica a carteira atual a 2020 e compara com um drawdown do Ibovespa hardcoded em −45%.

### Auditoria das duas implementações de performance

| Aspecto | `runBacktestEngine`/`AlgorithmPerformance` | `recommendedPortfolioEngine`/curva contínua |
|---|---|---|
| objeto medido | top 10 por score, inclusive WAIT e sem perfil | cesta BUY por perfil, equal-weight |
| evento de entrada | `report.date`/preço do cálculo | `report.date` e fechamento daquele dia |
| publicação real | não existe `publishedAt`; pode entrar antes de o usuário ver | mesmo problema |
| saída | último preço visto **antes** da publicação que omitiu o ativo | rebalance no fechamento da data do relatório |
| zero BUY | não aplicável | ignora o evento e mantém a cesta anterior |
| retorno | média simples de holdings com durações diferentes | patrimônio contínuo base 100 |
| proventos/splits | usa `close` antes de `adjClose`; sem total return | usa somente `close`; sem proventos/splits explícitos |
| custos/liquidez | ausentes | ausentes; faltantes são removidos e pesos renormalizados |
| delisting/preço ausente | pick ativo pode ser ignorado | último preço conhecido pode ficar congelado |
| CDI | taxa atual aplicada retroativamente com dias/252 | série diária quando existe; fallback atual flat |
| benchmarks | IBOV para FII/BRASIL_10; SPX para STOCK_US | benchmarks mais adequados por classe, mas price-return |
| reprodutibilidade | snapshots gravados e removidos após 90 dias | curva é reconstruída/overwrite com dados atuais, sem hash |

A curva contínua é arquiteturalmente superior ao legado porque mantém patrimônio e eventos, mas ainda **não é um backtest investível**. O viés mais grave do legado é a saída: se o ativo cai e some do ranking, ele sai pelo último preço antigo, apagando a perda entre publicações. Na curva contínua, usar `report.date` em vez de `publishedAt/effectiveAt` permite entrada anterior à recomendação. O uso de `close`, ausência de custos e tratamento otimista de faltantes também tendem a superestimar desempenho.

### O que pode e não pode ser medido agora

Pode-se medir, de forma descritiva e sem alegar skill:

- cobertura do universo, distribuição/saturação dos scores e distância ao threshold;
- contagem de BUY por perfil/coorte;
- persistência de BUY, Jaccard e turnover nominal entre publicações identificadas;
- upgrades/downgrades e causas de waterfall;
- estabilidade das seleções e sensibilidade instantânea de threshold/pesos;
- diferenças causais em shadow mode sobre o **mesmo snapshot**, como draft global e cenários de governança.

Ainda não se pode defender:

- retorno/alpha do scoring atual, Sharpe, Sortino, drawdown e recuperação;
- hit rate/payoff comparáveis por perfil;
- superioridade do threshold 70;
- desempenho de estatais versus privadas ou de cada família de penalidade;
- conclusão de que mais ou menos BUY produz resultado econômico melhor.

A sensibilidade já observada é apenas mecânica: no snapshot recuperado, os scores brutos têm forte massa no piso 10, somente um score bruto é exatamente 70 e a concentração move `DIRR3` de 72 para 67. Isso mostra descontinuidade perto do corte, não calibra o corte.

### Shadow mode prospectivo recomendado

1. Na publicação, congelar snapshot imutável com `runId`, `algorithmVersion`, `configVersion`, hash dos inputs, universo completo, reason codes, `calculatedAt`, `publishedAt` e `effectiveAt`.
2. Definir `effectiveAt` como a primeira janela negociável após publicação; capturar preço de execução conservador (abertura/VWAP), moeda e spread observável.
3. Registrar em paralelo o controle produtivo e experimentos pré-registrados: greedy atual, draft global, governança D/C, ablações de penalidades e thresholds de diagnóstico. Nenhum altera a UI.
4. Construir carteira contínua por classe/perfil, com caixa quando não houver BUY, rebalance apenas no evento efetivo, proventos, splits, delistings, FX, custos e limites de liquidez.
5. Preservar universo point-in-time, inclusive inativos/rejeitados, e séries de benchmark total-return com a mesma moeda/calendário.
6. Fechar coortes em horizontes predefinidos e não sobrepostos; publicar cobertura e intervalos de incerteza, não apenas médias.
7. Só iniciar walk-forward de calibração quando houver múltiplos regimes e observações suficientes por perfil. Separar treino, validação e teste final temporal; parâmetros ficam congelados no fold de teste.

### Métricas e critérios futuros

| Dimensão | Métrica | Regra metodológica |
|---|---|---|
| retorno | total return líquido e excesso vs IBOV/IFIX/SPX/BTC/CDI adequado | mesma moeda, período e data efetiva |
| risco | volatilidade, downside deviation, max drawdown, recuperação | série diária íntegra; sem Sharpe/Sortino com amostra curta |
| seleção | hit rate, payoff, upgrades/downgrades | por coorte/perfil e horizonte congelado |
| estabilidade | persistência BUY, turnover, Jaccard top 10 | custos aplicados e publicação como evento |
| calibração | retorno/probabilidade por faixa de score; 70 vs bandas vizinhas | out-of-sample, sem escolher por quantidade de BUY |
| cobertura | bruto→válido→pontuado→ranking e dados ausentes | point-in-time por classe/campo |
| governança | estatal vs privada pareada por setor/tamanho/valuation | matched cohorts; controle de confundidores |
| penalidades | ablação de cada família | mesmo input/fold; medir retorno, risco, turnover e erro tipo I/II |

**Decisão da Fase 8:** testes determinísticos sustentam a coerência local do código, mas nenhuma evidência disponível sustenta recalibrar threshold, pesos, ciclicidade ou governança por retorno. O painel atual deve ser interpretado como curva retrospectiva exploratória, não prova de acurácia. A ação correta é corrigir primeiro timing/total-return/versionamento e iniciar coleta prospectiva; o algoritmo atual permanece controle até haver evidência walk-forward suficiente.

## Parte 8 — Achados priorizados

| ID | Severidade | Confiança | Status | Camada | Achado | Evidência | Impacto | Causa raiz | Direção |
|---|---|---|---|---|---|---|---|---|---|
| A-01 | CRÍTICA | ALTA | CORRIGIDO E RECUPERADO; PUBLICAÇÃO PENDENTE | ingestão | coluna `Mrg Bruta` deslocou 9 campos; 994 STOCK parseadas, somente 3 atualizadas no sync defeituoso | HTML, log, datas/snapshots DB e reconciliação pós-sync | cache fundamental antigo e risco de queda simultânea por staleness | schema de 21 colunas, validador sem largura/semântica exatas e gate agregado | parser/gates v2, backup, sync de 333 STOCK e saneamento transacional concluídos; novo draft não publicado |
| A-02 | ALTA | ALTA | VERIFICADO | frontend | “4 BUY” é o filtro Defensivo de 8 totais | DB + `TopPicksCard:55,81-121` | interpretação equivocada do ranking | contador sem contexto global | exibir perfil/total e timestamp/versão |
| A-03 | ALTA | ALTA | VERIFICADO PÓS-RECUPERAÇÃO | draft | regret total 88; EZTC3, AZZA3 e POMO4 são WAIT no perfil atribuído e BUY no melhor | trace + contrafactual global | greedy atual tem 11 BUY versus 15 no shadow com mínimos preservados | ordem fixa + `usedTickers` global | manter controle e medir alocador global em shadow |
| A-04 | ALTA | ALTA | VERIFICADO PÓS-RECUPERAÇÃO | concentração | DIRR3 cai 72→67 e não há reotimização; LAVV3 M=75 fica fora | trace + engine | remove 1 BUY e deixa 1 BUY latente | penalidade pós-seleção e GOLD completa target antes do flex | reconsideração/reotimização em experimento |
| A-05 | ALTA | ALTA | CÓDIGO VERIFICADO | IA | IA pode produzir WAIT com score ≥70 | `aiEnhancementService:100-130` | viola regra global | action alterada sem score/revalidação | invariant checker pós-IA |
| A-06 | ALTA | ALTA | CÓDIGO VERIFICADO | pipeline | entrypoints usam ordens distintas | matriz acima | mesmo cache pode gerar ranking diferente | orquestrações duplicadas | pipeline canônico único |
| A-07 | ALTA | ALTA | CÓDIGO VERIFICADO | publicação | API pode escolher doc com ranking não publicado | `researchController:455-461` | versão exibida incoerente | `$or` de seções | exigir flag da seção solicitada |
| A-08 | ALTA | ALTA | CÓDIGO VERIFICADO | publicação | gates manual/auto insuficientes | controller + scheduler | ranking degradado publicável | sem contrato de qualidade | gate por invariantes e freshness |
| A-09 | MÉDIA | ALTA | CÓDIGO VERIFICADO; NÃO OBSERVADO NO SNAPSHOT ATUAL | scoring | missingness reduz score e também pode aplicar teto | `scoringEngine:1059-1117`; 0 caps ativos pós-recuperação | dupla incidência possível e baixa confiança ainda pode chegar a 70 | confiança com dois mecanismos | explicitar contrato e testar cap/invariante |
| A-10 | ALTA | ALTA | VERIFICADO | setores | bancos/seguradoras perdem por margem N/A | BBAS3/BBSE3 + engine | viés setorial material | confiança não reconhece métrica inaplicável | matriz de aplicabilidade por setor |
| A-11 | MÉDIA | ALTA | VERIFICADO | observabilidade | flags/dedup/corte 5k não entram no discard | services citados | funil opaco | logging começa tarde | reason codes em todas as etapas |
| A-12 | MÉDIA | ALTA | VERIFICADO | contrato | cap Defensivo declarado 4, implementado 3 | AGENTS.md vs engine | comportamento/documentação divergentes | regra duplicada | decisão explícita + teste |
| A-13 | MÉDIA | ALTA | VERIFICADO | histórico | track record STOCK está dormente | 0 ativos com ≥6 períodos | Defensivo depende do snapshot | histórico começou sem backfill | plano de série histórica confiável |
| A-14 | ALTA | ALTA | VERIFICADO | scoring | bônus “Dividend Aristocrat” usa somente snapshot corrente | `scoringEngine:132-136,1073-1082` | +10/+5 sugere persistência histórica não medida | proxy recebeu nome/conclusão de histórico | renomear ou exigir track record válido |
| A-15 | ALTA | ALTA | VERIFICADO | scoring | PEG não positivo pode receber +22 no Arrojado | `scoringEngine:463-470` | empresa sem lucro/PL ausente pode ganhar bônus de valuation | guarda `>0` existe apenas no primeiro tier | invariant test e guarda de PEG positivo |
| A-16 | MÉDIA | ALTA | VERIFICADO | explicabilidade | clamp 10/100 não entra no audit log | `scoringEngine:1105-1117`; BBSE3 B −5→10 | waterfall persistida não reconcilia em extremos | clamp padrão tratado como cosmético | registrar fator de normalização |
| A-17 | MÉDIA | ALTA | VERIFICADO | produto | estruturais parecem componentes do score, mas são só desempate/exibição | engine + `AssetDetailModal` + `TopPicksCard` | usuário pode interpretar causalidade inexistente | apresentação não distingue eixos | explicitar independência ou redesenhar arquitetura |
| A-18 | ALTA | ALTA | VERIFICADO; DECISÃO FILOSÓFICA | setores | todo cíclico é inelegível ao Defensivo | `sectorTaxonomy:192-220`; `scoringEngine:148-152` | qualidade/valuation não conseguem compensar; PETR4 D=16 | gate categórico por macro-setor | contrafactual e backtest antes de manter/recalibrar |
| A-19 | MÉDIA | ALTA | VERIFICADO | draft/produto | GOLD/SILVER/BRONZE são rodadas de preenchimento, não qualidade/action | 15 GOLD WAIT e 1 SILVER BUY no snapshot | tier pode induzir leitura invertida | nomenclatura mistura mecânica e mérito | ocultar/renomear ou explicar |
| A-20 | ALTA | ALTA | VERIFICADO; NÃO CORRIGIDO | governança/master data | taxonomia estatal tem 18 classes ausentes e `CSMG3` falso positivo após 16/06/2026 | fontes oficiais com corte 19/07/2026 + shadow | desconto aplicado a quem não é mais controlado e omitido em controladas | lista manual sem vigência, fonte ou alias histórico | metadado temporal por emissor/controlador; classes derivadas do security master |
| A-21 | MÉDIA | ALTA | VERIFICADO; DECISÃO FILOSÓFICA | scoring/governança | −8/−4/0 não possui calibração empírica e pode sobrepor riscos já medidos | código + A–E; B não muda BUY/seleção, E perde 32 pontos | falsa precisão e manutenção frágil | opinião codificada como constante universal | metadado como baseline; risco graduado somente em shadow/backtest |
| A-22 | ALTA | ALTA | INCIDENTE ATIVO | publicação/seções | os sete rankings atuais têm Morning Call/relatório/IA marcados como publicados sem conteúdo | consulta read-only; 177 flags IA e 164 Morning Call vazias no histórico | seção em branco e estado administrativo falso | auto-publish ativa flags incondicionalmente | validar conteúdo por seção; publicar somente seção existente |
| A-23 | CRÍTICA | ALTA | CÓDIGO VERIFICADO | imutabilidade/IA | endpoint de IA pode editar ranking já publicado in place | controller + serviço IA | muda recomendação pública sem revisão, versão ou nova notificação | ausência de snapshot/revisão e filtro de draft | IA cria nova revisão; publicado é imutável; invariant checker final |
| A-24 | ALTA | ALTA | CÓDIGO VERIFICADO | batch/persistência | sete classes são salvas sem batch ID, manifest ou transação | sequência de `MarketAnalysis.create` | batch parcial e classes de vintages mistos | persistência independente por classe | run manifest + status + ativação atômica após completude |
| A-25 | ALTA | ALTA | CÓDIGO VERIFICADO | versão/API | `$or` por qualquer seção pode retornar ranking ainda não publicado e sombrear o último válido | endpoint, deep link, Comparador e Dashboard | draft alcança consumidores downstream | documento agrega seções sem projeção/ponteiro por seção | endpoint por seção e versão ativa; payload mínimo |
| A-26 | ALTA | ALTA | CÓDIGO VERIFICADO | gates | manual valida só fundamentos BR; auto adiciona 5 itens/7 dias | controller + scheduler | macro, séries, invariantes e drift não controlados | validadores fragmentados | validador único conforme matriz pré-publicação |
| A-27 | ALTA | ALTA | CÓDIGO VERIFICADO | action/consumidores | IA pode gerar WAIT≥70; carteira recomendada obedece action, reforço do rebalance obedece apenas score | serviços IA/recommended/rebalance | produtos recomendam cestas diferentes | dois campos de decisão e contratos distintos | action derivada; veto separado; invariantes em todos consumidores |
| A-28 | MÉDIA | ALTA | RISCO DE DESENHO; NÃO OBSERVADO | notificação | broadcast não é aguardado nem idempotente | serviço/controller/scheduler; 167 broadcasts, zero near-duplicate em 5 min | aviso duplicado ou ausente | side effect best-effort pós-save | transactional outbox + chave idempotente |
| A-29 | ALTA | ALTA | CÓDIGO VERIFICADO | retenção/rollback | TTL preserva publicados, mas cleanup apaga todos após 120 dias | model + cleanup; histórico atual desde 13/04 | backtest/rollback/reprodutibilidade truncados | políticas de retenção contraditórias | retenção canônica separada de drafts e ponteiro de rollback |
| A-30 | ALTA | ALTA | HISTÓRICO VERIFICADO; ÚLTIMOS DOCS ÍNTEGROS | persistência | 15 docs históricos violam action/ordem/posição e 315 não reconciliam delta pelo contrato atual | auditor read-only; últimas ocorrências 17/04 e 02/07 | histórico não é uniformemente comparável | mutações/contratos legados sem migração/versionamento | marcar versão do algoritmo/schema e não misturar séries no backtest |
| A-31 | MÉDIA | ALTA | CÓDIGO VERIFICADO | frontend | Research inicia Defensivo e faz sort só por score; deep link/modal recebem payload antes do gate de ranking | componentes Research/TopPicksCard | “Top 10” e desempate divergem do contrato soberano; draft pode abrir em modal | filtro local e confiança excessiva no payload | payload somente publicado; comparator compartilhado; contexto global/perfil explícito |
| A-32 | CRÍTICA | ALTA | METODOLOGIA INVÁLIDA | backtest legado | entrada usa data/preço do cálculo e saída por omissão usa último preço antigo | `runBacktestEngine` + teste que codifica a regra | look-ahead na entrada e perda apagada na saída | ausência de `publishedAt/effectiveAt` e preço executável | não usar como validação; reconstruir eventos prospectivos |
| A-33 | CRÍTICA | ALTA | CÓDIGO VERIFICADO | curva recomendada | curva entra em `report.date`, usa close sem total return/custos e ignora publicação com zero BUY | `recommendedPortfolioEngine` | performance otimista e política de saída implícita | evento de cálculo confundido com recomendação e execução | engine event-driven com effectiveAt, caixa, adj total return e custos |
| A-34 | CRÍTICA | ALTA | EVIDÊNCIA INSUFICIENTE | histórico/modelo | zero STOCK com seis snapshots; histórico publicado curto mistura versões não identificadas | snapshots, retenção e git: 16 commits scoring/8 portfolio desde abril | impossível atribuir retorno ao algoritmo atual | coleta recente e ausência de versionamento | shadow prospectivo; walk-forward apenas após profundidade |
| A-35 | ALTA | ALTA | CÓDIGO VERIFICADO | dados de backtest | delistado/faltante pode ser omitido, renormalizado ou congelado no último preço | dois engines de performance | survivorship/missing-data bias | política fail-open para série ausente | preservar universo/eventos e política conservadora testada |
| A-36 | ALTA | ALTA | CÓDIGO VERIFICADO | reprodutibilidade | curva é sobrescrita com séries atuais e sem hash; performance legada expira em 90 dias | models/cleanup/engine | números históricos podem mudar e evidência desaparece | artefato derivado mutável | snapshots de performance imutáveis e versionados |
| A-37 | ALTA | ALTA | SCRIPT INVÁLIDO PARA INFERÊNCIA | stress test | `stressTest2020` aplica carteira atual a 2020 e usa IBOV −45% hardcoded | script local | forte look-ahead/survivorship; aprovação enganosa | seleção ex-post de ativos atuais | rotular apenas cenário contrafactual ou remover da validação |
| A-38 | MÉDIA | ALTA | LACUNA DE TESTE | testes | 185 testes passam, mas não há curva completa, custos, corporate actions, delisting nem paridade real de entrypoints | suíte focal + tabela de lacunas | falso conforto determinístico | testes concentram-se em funções locais | regressões propostas + propriedade/eventos no engine novo |

## Parte 9 — Plano sem implementação

### Classificação das recomendações

| Categoria | Achados principais | Tratamento |
|---|---|---|
| bug/inconsistência inequívoca | A-01, A-05–08, A-12, A-15–16, A-22–33, A-35–37 | corrigir por contrato; não exige escolher mais BUY |
| observabilidade/dados | A-02, A-10–14, A-20, A-24, A-29–30, A-34–36 | instrumentar e preservar antes de calibrar |
| recalibração dependente de evidência | A-09, A-18, A-21 e pesos/threshold | manter controle; testar prospectivamente |
| filosofia/produto | A-03–04, A-12, A-17–19, veto IA, zero BUY | decisão explícita do dono; código não decide sozinho |
| experimento sem produção | draft global, governança C/D, ablações, thresholds e engine event-driven | shadow mode pré-registrado |
| permanecer como está por ora | threshold 70, sem quota de BUY, sort soberano, um perfil por ticker, delta contra publicado | só mudar com decisão/evidência posterior |

### P-01 — Encerrar a recuperação de ingestão sem misturar com recalibração

- **Categoria:** correção inequívoca, parcialmente concluída. O parser v1 deslocava nove campos; v2, health gate, backup, sync e saneamento foram concluídos. O draft recuperado tem 11 BUY e permanece não publicado.
- **Causa/impacto:** contrato de 21 colunas permissivo e sucesso agregado ocultaram colapso STOCK. O impacto observado foi cache antigo e risco futuro de cliff de staleness, não prova de que o mercado deveria ter mais BUY.
- **Opção mínima:** conservar schemas v2/gates por classe, validar o draft recuperado pela matriz da Fase 7 e submeter sua publicação como decisão separada.
- **Opção estrutural:** versionar contrato/fonte por hash de cabeçalho, quarentenar layouts desconhecidos e persistir manifest bruto→parseado→aceito→atualizado.
- **Risco/dados:** falso bloqueio quando a fonte muda legitimamente; exige baseline rolling de linhas/aceitação e amostras sanitizadas.
- **Aceitação/sucesso:** fixture de coluna inserida falha fechada; STOCK/FII têm contagens independentes; nenhuma escrita ocorre quando o health gate falha. Sucesso = zero falso positivo semântico e reconciliação diária por classe.
- **Rollout/rollback:** alerta shadow para mudanças não críticas; bloqueio imediato para assinatura/largura inválida. Rollback seleciona schema anterior somente com assinatura correspondente, nunca por fallback cego.
- **Arquivos:** `scraperSchemas.js`, `fundamentusService.js`, `syncService.js`, `ingestionHealth.js`, testes de parser/ingestão. **Não altera regra inviolável.**

### P-02 — Tornar publicação versionada, imutável e selecionada por seção

- **Categoria:** correção inequívoca. Sete documentos atuais têm flags de conteúdo vazio; a API pode expor ranking draft por outra flag; IA pode editar publicado; não há ponteiro ativo/rollback e o cleanup apaga publicados após 120 dias.
- **Causa/impacto:** um documento mutável agrega cálculo, seções e estado de publicação. Saves independentes, `$or` genérico e side effects best-effort permitem versão errada, seção vazia, lote parcial e notificação ausente/duplicada.
- **Opção mínima:** validar payload por seção; API de ranking exige `isRankingPublished`; impedir enhance em publicado; manter última versão válida quando a nova falhar; corrigir retenção contraditória.
- **Opção estrutural:** snapshots imutáveis/revisões + ponteiro ativo por classe/seção, manifest de batch, transação de ativação, `publishedAt/effectiveAt`, outbox idempotente e rollback por troca de ponteiro.
- **Risco/dados:** migração de leitura/admin e decisão se atomicidade é por classe, por seção ou pelos sete rankings. Exige inventário de consumidores e política de retenção.
- **Aceitação/sucesso:** falha injetada em qualquer classe/seção não muda ponteiros; draft nunca aparece em Research/Comparador/Dashboard; seção vazia não ativa flag; rollback restaura exatamente a revisão anterior. Sucesso = 100% das respostas com versão/flag/payload coerentes.
- **Rollout/rollback:** dupla leitura e shadow pointer; depois ativação por feature flag. Rollback volta ao seletor antigo e ao último snapshot sem apagar revisões.
- **Arquivos:** `MarketAnalysis.js`, `researchController.js`, `schedulerService.js`, `aiEnhancementService.js`, `cleanupService.js`, `notificationService.js`, Research/Comparator/Dashboard. **Preserva threshold/action; fortalece publicação.**

### P-03 — Unificar entrypoints e persistir linhagem completa

- **Categoria:** bug de paridade + observabilidade. Séries rodam antes do ranking em `syncProdData`/18:30 e depois ou nunca nos demais caminhos; sete classes não compartilham identidade ou baseline fixado.
- **Causa/impacto:** orquestrações duplicadas. O mesmo cache pode produzir rankings distintos e uma publicação concorrente pode mudar o baseline do delta no meio da run.
- **Opção mínima:** extrair orquestrador único com ordem `sync → séries → snapshot/manifest → ranking → validação → persistência draft`; todos os entrypoints delegam a ele.
- **Opção estrutural:** máquina de estados da run, `runId`, versões/hashes/timestamps, baselines fixados no início e status por classe.
- **Risco/dados:** cron pode aumentar duração e uma classe lenta bloquear o batch; exige orçamento de tempo, retry e decisão sobre parcialidade.
- **Aceitação/sucesso:** fixture congelada executada por todos os entrypoints gera o mesmo hash/ranking; falha em cada estágio produz estado terminal explícito. Sucesso = paridade byte a byte e 100% das runs rastreáveis.
- **Rollout/rollback:** novo orquestrador em shadow nos crons; comparar manifests antes de substituir. Feature flag retorna ao fluxo legado.
- **Arquivos:** `syncProdData.js`, `schedulerService.js`, `researchController.js`, `runRankingOnly.js`, `aiResearchService.js`, workers. **Não altera regra inviolável.**

### P-04 — Aplicar um validador final único após toda mutação

- **Categoria:** correção inequívoca. IA pode gerar WAIT≥70 e alterar ordem sem renumerar; consumidores divergem; PEG não positivo pode receber bônus; clamp não fecha a waterfall.
- **Causa/impacto:** score, action, ordem, posição e explicação são mutáveis em estágios diferentes. Houve 15 documentos históricos incoerentes e recomendações downstream podem divergir.
- **Opção mínima:** rederivar action, aplicar comparator soberano, renumerar/recalcular delta e rejeitar duplicatas/perfis inválidos antes de save/publish; corrigir guarda PEG e registrar normalização do clamp.
- **Opção estrutural:** ranking como objeto validado por schema/invariantes, produzido uma vez; IA só acrescenta metadado/veto separado, nunca altera a decisão quantitativa.
- **Risco/dados:** documentos legados podem falhar; precisa versionar schema e não reescrever histórico silenciosamente.
- **Aceitação/sucesso:** property tests e fixtures pós-IA garantem `BUY ⇔ score≥70`, sort/tiebreaker/posição/delta, waterfall exata e PEG positivo. Sucesso = zero violação nova e todos consumidores concordando.
- **Rollout/rollback:** validador primeiro em audit-only; hard block para invariantes determinísticos após uma janela sem falsos positivos. Rollback volta a alertar, preservando logs.
- **Arquivos:** `scoringEngine.js`, `portfolioEngine.js`, `aiEnhancementService.js`, `aiResearchService.js`, schema/model, rebalance/recommended engine. **Reafirma regras invioláveis 1–3.**

### P-05 — Modelar aplicabilidade setorial, temporalidade e security master

- **Categoria:** dados/explicabilidade. Bancos/seguradoras perdem por margem N/A; “Dividend Aristocrat” usa snapshot; há mixed vintage; taxonomia estatal omite 18 classes e mantém `CSMG3` privatizada.
- **Causa/impacto:** um schema genérico trata “não aplicável” como “ausente”; rótulos prometem história que não existe; listas manuais por ticker não têm vigência/controlador.
- **Opção mínima:** matriz classe/setor×campo, renomear o bônus snapshot, timestamps por família e corrigir taxonomia com fonte/vigência.
- **Opção estrutural:** security master por emissor/classe/evento corporativo, métricas setoriais próprias e histórico point-in-time de fundamentos/controladores.
- **Risco/dados:** migração e mudança material de scores financeiros; exige amostras por setor, fontes oficiais e regras contábeis documentadas.
- **Aceitação/sucesso:** banco não perde confiança por margem inaplicável; classe/ticker/controlador resolvem por data; label histórico só aparece com série mínima. Sucesso = missingness verdadeira separada de N/A e cobertura temporal auditável.
- **Rollout/rollback:** primeiro metadado/UI e shadow score; efeitos de score apenas após revisão e backtest prospectivo. Leitura compatível com schema antigo.
- **Arquivos:** `MarketAsset`, `FundamentalSnapshot`, `marketDataService`, `scoringEngine`, taxonomias/config, modal/UI. **Pode alterar scores; não liberar diretamente em produção.**

### P-06 — Rebaixar “backtest/acurácia” a exploratório e construir shadow investível

- **Categoria:** correção de alegação + infraestrutura de evidência. Backtest legado usa entrada pré-publicação/saída antiga; curva contínua também entra por data do cálculo, ignora custos/total return e mantém a cesta quando há zero BUY.
- **Causa/impacto:** não existe `publishedAt/effectiveAt`, política de execução ou universo histórico íntegro. Números podem superestimar retorno e não validam threshold/pesos.
- **Opção mínima:** rotular painel como retrospectivo exploratório, ocultar métricas não defensáveis e impedir uso de `stressTest2020` como aprovação.
- **Opção estrutural:** engine event-driven prospectivo conforme Fase 8: próxima janela negociável, caixa, proventos/splits/delistings/FX, custos, liquidez, benchmarks total-return, snapshots imutáveis.
- **Risco/dados:** custo de dados e demora até amostra suficiente; exige corporate actions, preços de execução, benchmarks e política de moeda.
- **Aceitação/sucesso:** fixtures reconciliam unidades/caixa/custos; ativo faltante não some/congela; curva não muda ao reconstruir com o mesmo hash. Sucesso = erro de reconciliação zero e cobertura publicada.
- **Rollout/rollback:** nova curva somente admin/shadow ao lado da antiga rotulada; promoção após reconciliação. Rollback remove a nova visualização, não os dados coletados.
- **Arquivos:** backtest/recommended engines, modelos de curva/performance, `financialService`, controller e painel admin. **Não altera ranking; condiciona futuras mudanças.**

### P-07 — Testar alocador global sem presumir que mais BUY é melhor

- **Categoria:** experimento. O greedy atual teve regret 88; três ativos foram capturados como WAIT apesar de BUY em outro perfil; shadow global passou de 11 para 15 BUY mantendo mínimos.
- **Causa/impacto:** ordem DEFENSIVE→MODERATE→BOLD e `usedTickers` global resolvem competição localmente; penalidade pós-draft não reotimiza.
- **Opção mínima:** relatório shadow de regret, BUY latentes, concentração e turnover ao lado do controle.
- **Opção estrutural:** otimizador com função objetivo explicitamente escolhida e restrições de perfil/setor/gestor, seguido de reotimização pós-penalidade.
- **Risco/dados:** maximizar BUY pode piorar adequação, risco e churn; exige decisão do objetivo e histórico prospectivo.
- **Aceitação/sucesso:** invariantes e mínimos preservados; comparar score total, adequação, concentração, regret, turnover e depois retorno líquido. Sucesso não é “mais BUY”, mas fronteira melhor no objetivo escolhido.
- **Rollout/rollback:** somente shadow até evidência; produção permanece greedy. Desligar experimento sem migração.
- **Arquivos:** `portfolioEngine.js`, simuladores/shadow e testes. **Pode mudar perfil/posição, portanto exige decisão de produto.**

### P-08 — Substituir opinião estatal fixa por metadado e experimento graduado

- **Categoria:** recalibração/filosofia. −8/−4/0 não tem calibração; lista estava desatualizada. Remover desconto não mudou BUY/seleção no snapshot; exclusão categórica piorou score total sem benefício.
- **Causa/impacto:** opinião de governança codificada como constante por ticker. O risco pode duplicar setor, beta, payout e qualidade.
- **Opção mínima:** corrigir master data e exibir controle/risco como metadado; manter score produtivo como controle enquanto coleta evidência.
- **Opção estrutural:** indicador graduado, temporal e explicável baseado em controlador, direitos especiais e eventos, calibrado apenas out-of-sample.
- **Risco/dados:** remover desconto pode ser percebido como endosso; manter lista errada penaliza classes incorretas. Exige dados oficiais temporais e coortes pareadas.
- **Aceitação/sucesso:** cenários A/C/D calculados sobre mesmo input; matched cohorts por setor/tamanho/valuation; sem gate categórico. Sucesso = efeito incremental robusto líquido de confundidores.
- **Rollout/rollback:** D (metadado sem score) e C somente shadow; A permanece controle até decisão/evidência. E permanece controle negativo rejeitado.
- **Arquivos:** `sectorTaxonomy.js`, `scoringEngine.js`, security master, UI/audit. **Altera score se promovido; exige aprovação explícita.**

### P-09 — Congelar threshold, pesos e gates setoriais até existir evidência

- **Categoria:** item a permanecer + recalibração futura. Há cliffs/massa no piso, missingness dupla possível e gate cíclico categórico, mas nenhum backtest point-in-time válido.
- **Causa/impacto:** regras heurísticas foram acumuladas sem série versionada. Mudar hoje escolheria casos conhecidos ou quantidade de BUY.
- **Opção mínima:** manter 70 e pesos atuais como controle, corrigindo apenas bugs matemáticos/invariantes.
- **Opção estrutural:** ablação/threshold sensitivity pré-registrada em shadow e walk-forward após amostra/regimes suficientes.
- **Risco/dados:** manter pode preservar viés; mudar sem evidência cria overfit. Exige série prospectiva versionada e custos.
- **Aceitação/sucesso:** folds temporais congelados; métricas por perfil/coorte com intervalos e cobertura. Promoção somente se superar controle em retorno líquido/risco/estabilidade, não por mais BUY.
- **Rollout/rollback:** nenhum rollout agora; candidatos rodam shadow. Rollback é manter versão controle.
- **Arquivos:** `financialConstants.js`, tunables, `scoringEngine.js`, experiment runner. **Mudaria a regra inviolável #1 se threshold fosse promovido; não autorizado nesta auditoria.**

### P-10 — Decidir semântica de BUY, qualidade estrutural e veto da IA

- **Categoria:** filosofia/produto. Score mistura qualidade, preço, momentum e perfil, enquanto estruturais parecem decomposição; IA possui veto informal; consumidores tratam action de modo diferente.
- **Causa/impacto:** um único rótulo “COMPRAR” tenta representar empresa para décadas, timing atual, risco extraordinário e adequação pessoal.
- **Opção mínima:** manter action quantitativa derivada do 70, mostrar estruturais como eixos independentes e IA como alerta separado.
- **Opção estrutural:** separar `quality/durability`, `valuation/opportunity`, `timing` e `risk alert`; definir qual combinação gera action e quem pode vetar.
- **Risco/dados:** mudança de linguagem e expectativa regulatória/produto; exige pesquisa com usuário e contrato comum entre Research, carteira e rebalance.
- **Aceitação/sucesso:** cada consumidor recebe o mesmo contrato; nenhum alerta muda action silenciosamente; UI explica por que empresa boa pode ser WAIT. Sucesso = zero divergência e compreensão mensurável.
- **Rollout/rollback:** copy/metadados primeiro; novo contrato em versão de API/feature flag. Rollback mantém action binária atual.
- **Arquivos:** schemas, scoring/AI, Research, modal, Dashboard, rebalance/recommended. **Pode redefinir regra inviolável somente com decisão explícita; opção mínima a preserva.**

### P-11 — Tornar perfil, tier e objetivo do draft explícitos na experiência

- **Categoria:** produto. “Quatro BUY” veio do filtro Defensivo; “Top 10” é por perfil; GOLD/SILVER/BRONZE são rodadas mecânicas, não qualidade; cap Defensivo diverge entre documentação e código.
- **Causa/impacto:** contexto global e mecânica interna são apresentados como mérito. Usuário interpreta contagem/tier incorretamente.
- **Opção mínima:** exibir “4 neste perfil / 8 no total”, timestamp/versão, explicar um perfil por ticker e ocultar/renomear tiers; alinhar cap documentado/implementado após decisão.
- **Opção estrutural:** UX orientada ao objetivo escolhido do draft, com visão global, perfil e razões de exclusão/regret.
- **Risco/dados:** sobrecarga visual; exige decisão se o produto vende ranking global, três carteiras ou adequação individual.
- **Aceitação/sucesso:** testes UI para contadores/perfis/tiebreaker e pesquisa de compreensão. Sucesso = usuário distingue total, perfil, action e tier.
- **Rollout/rollback:** copy/contador em A/B interno; rollback visual simples.
- **Arquivos:** `TopPicksCard`, `Research`, `AssetDetailModal`, serviços/types e documentação. **Não altera scoring.**

### P-12 — Núcleo que deve permanecer como controle

- **Manter agora:** `BUY ⇔ score≥70`; ordenação descendente com desempate estrutural; um perfil por ticker; delta contra último publicado; ausência de quota mínima de BUY; nenhuma exclusão categórica de estatal; algoritmo atual como controle dos shadows.
- **Razão:** são contratos coerentes ou controles necessários. Os problemas encontrados vêm de dados, mutações, seleção de versão, semântica e falta de evidência — não de uma obrigação de gerar mais recomendações.
- **Aceitação:** invariant/property tests em toda run e comparação de qualquer candidato contra a versão controle identificada.
- **Rollback:** qualquer experimento é desligável sem tocar no controle. **Nenhuma regra inviolável é alterada.**

### Roadmap A–E consolidado

| Fase | Escopo | Esforço | Dependência/risco | Aceitação | Rollback |
|---|---|---:|---|---|---|
| A | P-01; PEG/clamp; contadores/contexto UI; rotular performance exploratória | M | baixo/médio; legado | fixtures e invariantes; nenhuma mudança silenciosa de action | flags e leitura compatível |
| B | P-02–04: snapshot/pointer, gate único, pipeline/manifest canônico | L | migração e todos entrypoints | paridade, falha parcial segura, rollback real | dupla leitura + ponteiro antigo |
| C | P-05: aplicabilidade, timestamps e security master temporal | L | fontes/modelagem setorial | N/A≠missing e controlador por data | schema compatível; score em shadow |
| D | P-07–08 e decisões P-10–11 | M/L | objetivo do produto | relatórios shadow e contrato aprovado | controle atual intacto |
| E | P-06/P-09: shadow prospectivo, engine investível e walk-forward | L | tempo/dados/regimes | reconciliação, custos, OOS e intervalos | desligar candidatos, manter coleta/controle |

### Ordem recomendada de decisão

1. **Não recalibrar e não usar o painel atual como prova de acurácia.** Confirmar P-12 como controle temporário.
2. **Decidir o destino do draft recuperado:** validar e publicar conscientemente ou manter o documento de 14/07; não deixar auto-publish decidir por acidente.
3. **Autorizar P-02/P-03 como prioridade técnica:** unidade de publicação, retenção, snapshot imutável, ponteiro ativo e pipeline canônico.
4. **Fechar P-04:** IA como alerta separado e invariantes finais obrigatórios; corrigir PEG/clamp.
5. **Escolher semântica/objetivo:** o que BUY significa, qual objetivo do draft e como zero BUY deve ser tratado.
6. **Melhorar dados P-05 antes de mexer em pesos:** bancos/seguradoras, timestamps e governança temporal.
7. **Rodar P-07/P-08 somente em shadow:** draft global e governança C/D.
8. **Iniciar P-06 e acumular evidência:** só depois discutir P-09 e eventual promoção walk-forward.

### Perguntas que exigem decisão do dono do produto

1. O draft recuperado de 19/07 deve substituir o publicado de 14/07 após uma validação manual, ou permanecer apenas como evidência da auditoria?
2. A unidade atômica de publicação deve ser cada classe, cada seção, ou o batch completo de sete classes?
3. Qual retenção é necessária para auditoria/regulação/produto: permanente, anos definidos ou arquivo frio?
4. `BUY` significa oportunidade de entrada agora, empresa adequada para longo prazo, ou ambos? Se ambos, aceita separar os conceitos?
5. A IA pode bloquear uma compra? Se sim, aceita um campo `riskVeto` separado sem violar action/score?
6. O objetivo primário do draft é maximizar adequação por perfil, score total, diversidade, quantidade de BUY ou uma função ponderada explícita?
7. Quando uma publicação tem zero BUY, a carteira recomendada deve ir para caixa, manter posições anteriores ou apenas não aceitar novas entradas?
8. GOLD/SILVER/BRONZE devem existir para o usuário ou permanecer detalhe interno de preenchimento?
9. O tratamento de estatal deve ficar como desconto atual enquanto coleta dados, migrar já para metadado sem score, ou aguardar decisão posterior? Exclusão categórica é rejeitada pela evidência atual.
10. Qual moeda/base do investidor e quais benchmarks oficiais devem orientar STOCK_US, REIT, ETF e cripto?
11. Qual custo/slippage e limite de liquidez são economicamente aceitáveis no shadow?
12. Quanto tempo/amostra/regimes serão exigidos antes de permitir alteração do threshold 70 ou dos pesos?

**Conclusão da Fase 9:** a auditoria não recomenda “soltar” mais BUY. Recomenda tornar a recomendação reproduzível, imutável, coerente entre consumidores e mensurável prospectivamente. Bugs de dados/publicação/invariantes podem ser corrigidos sem debate filosófico; draft, IA, cíclicos, estatal, threshold e pesos exigem contrato de produto e/ou evidência. Nenhuma proposta foi implementada nesta fase.

## Respostas consolidadas às 20 perguntas obrigatórias

1. **Por que quatro?** Porque a UI inicia no filtro Defensivo; são 4 de 8 totais.
2. **Quantos em cada etapa?** No baseline publicado: 14 no melhor perfil, 9 após atribuição, 8 após concentração/IA/salvamento/publicação e 4 exibidos no perfil padrão. No snapshot recuperado: 16 ativos têm algum perfil ≥70, 12 entram como BUY no draft, 11 sobrevivem à concentração e permanecem somente no rascunho.
3. **Causa do número baixo?** Para 4 versus 8, frontend. Para 14 potenciais versus 8 efetivos, draft (−5) e concentração (−1). A quantidade inicial de 14 depende do scoring; a decomposição completa fica na Fase 4.
4. **TXT e publicado são versões diferentes?** Sim. O publicado é de 14/07 com 8 BUY. O TXT de 19/07 inicialmente tinha outro draft com 8; após a recuperação foi regenerado por um novo draft com 11. Nenhum dos drafts de 19/07 foi publicado.
5. **BUY latentes?** LAVV3 tem M=75 e ficou fora; DIRR3 entrou com B=72 e caiu a 67 por concentração. EZTC3, AZZA3 e POMO4 foram capturados cedo como WAIT, embora sejam BUY no melhor perfil. O shadow global com mínimos preservados passa de 11 para 15 BUY, sem recomendar quota.
6. **Penalidades próximas de 70?** Nos 20 ativos com melhor score 60–74: tendência −106, payout −90, sobrevalorização −30, rentabilidade ausente −30, baixa liquidez −30, volatilidade −30 e demais fatores menores. A concentração retirou DIRR3 no snapshot recuperado.
7. **Pontos por ausência/staleness?** BBAS3 perde 15 e BBSE3 40 por missingness. Após o sync, os 333 fundamentos STOCK aceitos estão com staleness 0; 42/203 processados têm confiança abaixo de 100. Nenhum BUY novo tem confiança degradada.
8. **Empresa excelente versus preço agora?** Não de forma limpa. Estruturais descrevem qualidade/valuation/segurança, mas não compõem a action; o score de perfil mistura durabilidade, preço, momentum, macro e adequação.
9. **Defensivo plurianual?** Hoje depende muito do snapshot; track record está dormente.
10. **Momentum/valuation coerentes?** Há sobreposições mensuradas — DY/Bazin/upside/Aristocrat e PEG/crescimento — e degraus fortes de SMA200. Coerência econômica e pesos ainda exigem backtest válido/shadow mode.
11. **Cíclicos categóricos demais?** O tratamento é categórico no Defensivo, não apenas desconto. Se é excessivo permanece decisão filosófica pendente de contrafactual e backtest.
12. **Estatais excluídas?** Penalizadas, não excluídas; CMIG4 é BUY. A exclusão categórica shadow não aumenta BUY, reduz o score total em 32 e aumenta a penalidade de concentração.
13. **Penalidade estatal justificada/atualizada?** Não. −8/−4/0 não tem calibração empírica; a lista tem 18 classes ausentes e `CSMG3` falso positivo. Sem desconto, BUY/seleção não mudam neste snapshot.
14. **BBAS3 com dados completos?** Corrigir somente margem N/A leva D 21→36; remover somente controle leva 21→29; ambos levam a 44. Continua WAIT por fundamentos/momentum do snapshot, não por gate estatal.
15. **Estatais faltando/sobrando?** Sim. Faltam 18 classes de dez emissores controlados; sobra `CSMG3` desde a privatização de 16/06/2026. Há ainda alias legado `AXIA6` no cache após mudanças de ticker/classe.
16. **Mesmo snapshot em todos entrypoints?** Não há garantia; a ordem de séries diverge.
17. **Algum caminho viola ação/score?** Sim. A IA pode forçar WAIT sem mudar score; 15 documentos históricos apresentaram violação, embora os documentos mais recentes estejam coerentes. O reforço do rebalance usa score e pode ignorar esse veto.
18. **Salvo/publicado/API/UI idênticos?** No snapshot, a API retorna o ranking publicado de 14/07 e o TXT representa outro draft. A garantia não existe: qualquer seção publicada pode selecionar um documento com ranking draft; deep link, Comparador e Dashboard consomem o array sem validar a flag.
19. **Gates impedem degradação sem bloquear escassez?** Não. Manual: somente saúde BR; automático: saúde BR, cinco itens e sete dias. A regra proposta bloqueia invariantes/dados estruturalmente inválidos e trata queda legítima de BUY como alerta/revisão, não como mínimo arbitrário de BUY.
20. **Bugs versus filosofia?** Bugs claros: ingestão/gates/seleção por flag/invariante pós-IA/paridade/observabilidade. Filosofia: threshold, peso de momentum, cíclicos, estatal e objetivo do draft.

## Apêndice A — Baseline reproduzível

- Branch: `main`
- Commit: `298f015b09db61d63f053e3fe0c0dd8d3abe298c`
- Commit em: `2026-07-12T21:04:18-03:00`
- Mensagem: `feat: strengthen landing and regression coverage`
- Worktree: sujo antes da auditoria, com alterações preexistentes em frontend/backend de segurança, autenticação, academia, mercado, macro e testes; foram preservadas. O prompt mestre era untracked.
- `reports/ranking_latest.txt`: 1.220.273 bytes; 19/07/2026 13:20:47; SHA-256 `BFA71B87A5685EB7F09398CA012E5D07CB5C89A2AEFEB3423D6F444C0EFE8516`.
- `server/logs/sync-report.txt`: 40.293 bytes; 19/07/2026 13:21:01; SHA-256 `493B9D24B3C10FB7F9C32E6112C9E6175A292B4FB9D3E6029B551CD08A321DB1`.
- Banco consultado: database lógico `test`, por acesso somente leitura. Nenhuma credencial ou URI foi registrada.

## Apêndice B — Consultas e comandos read-only

1. Git: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git show -s`.
2. Artefatos: `Get-FileHash`, `Get-Item`, buscas `rg` e leituras `Get-Content`.
3. `node server/scripts/inspectRanking.js`, após inspeção de fonte read-only.
4. `node server/scripts/diagnoseDraft.js STOCK ...`, após inspeção de fonte read-only.
5. Queries Mongoose `find`, `countDocuments` e `aggregate` sobre `MarketAnalysis`, `MarketAsset`, `DiscardLog`, `SystemConfig` e `FundamentalSnapshot`; sem `save`, `update`, `insert`, `bulkWrite` ou delete.
6. Query de seleção da API: `assetClass='STOCK'`, `strategy='BUY_HOLD'`, `$or` das três flags publicadas, sort `createdAt:-1`.
7. Testes Vitest listados na Parte 7.
8. `node server/scripts/auditPublicationIntegrity.js --compact`: consulta read-only de documentos, flags, invariantes, deltas, índices e broadcasts; nenhum `save/update/insert/delete`.
9. `node server/scripts/auditScoringMetamorphic.js --samples=500`: 13.500 verificações puras, sem I/O/banco.
10. Suíte focal Fase 8 com `NODE_ENV=test` e URI local não conectada: 21 arquivos/185 testes; nenhum acesso ao MongoDB real.

## Apêndice C — Hipóteses e dados faltantes

- **[VERIFICADO · confiança ALTA]** a inclusão de `Mrg Bruta` no índice 12 deslocou os campos posteriores; `liq2m` passou a ler ROE. A captura foi identificada por hash e uma amostra sanitizada está transcrita neste relatório.
- **[NÃO VERIFICADO]** a data exata em que a fonte passou a entregar a coluna adicional.
- **[CONCLUÍDO NA FASE 6]** controle acionário revalidado com fontes oficiais e corte em 19/07/2026; um falso positivo e 18 classes ausentes detectados.
- **[CONCLUÍDO NA FASE 4]** Waterfalls dos BUY publicados, dos BUY do novo draft, casos-âncora e todos os ativos com melhor score entre 60 e 74.
- **[CONCLUÍDO NA FASE 5]** Contrafactual global do draft para score, BUY com mínimos preservados, regret e diversificação.
- **[CONCLUÍDO NA FASE 6]** Cenários A–E, isolamento por ativo, taxonomia e dados aplicáveis; desempenho histórico permanece indisponível por falta de série point-in-time válida.
- **[CONCLUÍDO NA FASE 7]** Publicação/integridade auditadas, incluindo 1.129 documentos, gates, seções, consumidores, retenção e matriz pré-publicação.
- **[CONCLUÍDO NA FASE 8]** Metodologia estatística/econômica auditada; backtests atuais classificados como exploratórios e shadow prospectivo especificado. Walk-forward permanece condicionado à coleta futura, não é uma execução válida hoje.
- A fonte bruta e o input lógico completo da run não são versionados; o TXT e os documentos permitem reconstrução parcial, não reprodução bit a bit.

## Apêndice D — Constantes e governança

| Item | Origem | Valor efetivo observado/declaração | Situação |
|---|---|---|---|
| `BUY_THRESHOLD` | env/`financialConstants.js` | 70 | invariável de negócio |
| `DEFAULT_SELIC_FALLBACK` | env/constante | configurada; efetivo macro 14,25 | não expor valor do env |
| liquidez ingestão | hardcoded `syncService.js` | 5.000 | sem tunable/gate por classe |
| liquidez scoring STOCK | hardcoded engine | 200.000 | gera DiscardLog |
| GOLD/SILVER/BRONZE | hardcoded portfolio | ≥55 / ≥40 / >30 | mecanismo de draft, não ação |
| cap GOLD Defensivo | hardcoded portfolio | 3 implementado; 4 documentado | divergência |
| estatal D/M/B | hardcoded scoring | −8/−4/0 | não governado por tunable |
| staleness | hardcoded scoring | >90: −15; >180: −30 | cliff por timestamp único |
| track record mínimo | hardcoded utility | 6 períodos | nenhum STOCK ativo |

## Apêndice E — Glossário mínimo

- **BUY/WAIT:** ação binária derivada do score do perfil atribuído; limiar 70.
- **Score de perfil:** adequação a Defensivo, Moderado ou Arrojado.
- **Score estrutural:** qualidade, valuation e risco; hoje usado sobretudo no desempate/exibição.
- **Draft competitivo:** seleção sequencial de 10 ativos por perfil, sem reutilizar ticker.
- **Regret de atribuição:** melhor score do ativo menos o score do perfil no qual foi selecionado.
- **Staleness:** idade, em dias, do único timestamp de fundamentos.
- **Track record:** consistência mensal histórica; retorna `null` abaixo de seis períodos.

## Checklist de continuação

- [x] Fase 4 somente leitura concluída.
- [x] Fase 5 concluída em shadow mode: greedy, regret e quatro cenários globais.
- [x] Fase 6 concluída: fontes oficiais, taxonomia e cenários A–E.
- [x] Fase 7 concluída: publicação, integridade, versão exibida e matriz de gates.
- [x] Fase 8 concluída: testes metamórficos, auditoria dos backtests e desenho de shadow/walk-forward.
- [x] Fase 9 concluída: síntese, classificação, opções mínima/estrutural, roadmap e perguntas do dono.
- [ ] Definir se o objetivo do draft é maximizar BUY, adequação por perfil ou diversidade.
- [ ] Definir tolerância desejada para escassez legítima de BUY.
- [ ] Decidir o destino do draft recuperado e a unidade atômica de publicação.
- [ ] Não autorizar recalibração antes de versionamento, shadow prospectivo e evidência out-of-sample.
