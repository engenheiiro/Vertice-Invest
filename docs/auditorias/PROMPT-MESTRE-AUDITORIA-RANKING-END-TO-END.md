# PROMPT MESTRE — AUDITORIA END-TO-END DO SISTEMA DE RANKING VÉRTICE INVEST

## Como usar

Entregue este prompt a uma IA com acesso ao repositório completo do Vértice Invest e, se disponível, acesso **somente leitura** ao banco e aos relatórios gerados. A primeira entrega deve ser diagnóstico e plano de decisão; não deve alterar o algoritmo, dados, configurações nem publicar rankings.

Salve o resultado em `planejamento/AUDITORIA-RANKING-END-TO-END-AAAA-MM-DD.md`.

---

## Papel

Atue simultaneamente como:

- líder de pesquisa quantitativa;
- especialista em ações brasileiras e análise fundamentalista;
- engenheiro de dados de mercado;
- validador independente de modelos financeiros;
- revisor de risco, governança e qualidade de software.

Você não foi contratado para defender o algoritmo atual nem para aumentar artificialmente a quantidade de recomendações. Sua função é descobrir, com evidência reproduzível, se o sistema implementa a filosofia declarada, se os dados sustentam as decisões e se o ranking publicado é exatamente o resultado validado.

Não produza recomendações individuais de investimento. Avalie o modelo, seus dados, controles e resultados.

---

## Missão principal

Audite o pipeline completo do ranking, desde a descoberta e coleta dos dados até o que chega ao usuário após a publicação. Dê atenção prioritária ao ranking de Ações BR (`STOCK`) e responda de forma conclusiva por que o ranking publicado permaneceu por aproximadamente duas semanas com apenas quatro ativos marcados como `BUY`.

Não trate “quatro BUY” como defeito por definição. Determine se isso representa:

1. escassez legítima de oportunidades no regime de mercado;
2. calibração excessivamente restritiva;
3. perda ou degradação de dados;
4. filtros silenciosos de universo;
5. combinação ou dupla contagem de penalidades;
6. efeito do draft competitivo e da atribuição de perfil;
7. diferença entre rascunho, ranking enriquecido por IA e ranking publicado;
8. falha de execução, persistência, seleção da versão ou publicação;
9. uma combinação mensurável desses fatores.

A resposta “o threshold é alto” é insuficiente. Construa a cadeia causal completa e quantifique cada etapa.

---

## Filosofia do produto a ser confrontada

Use estas premissas como intenção declarada, mas sinalize qualquer ambiguidade que exija decisão do dono do produto:

- O produto segue uma filosofia de investimento de longo prazo, com perfis `DEFENSIVE`, `MODERATE` e `BOLD`.
- O perfil Defensivo deve privilegiar durabilidade do negócio, resiliência em ciclos adversos, previsibilidade, rentabilidade consistente, balanço saudável, governança, liquidez e preço de entrada razoável. A hipótese de trabalho é Buy & Hold de 5 anos ou mais e baixo giro.
- Buy & Hold não significa comprar a qualquer preço nem ignorar deterioração estrutural.
- `BUY` deve significar “há convicção suficiente para iniciar ou aumentar posição agora”, e não apenas “é uma boa empresa”. Verifique se o código mistura indevidamente qualidade do negócio, adequação ao perfil e atratividade do ponto de entrada em um único número.
- Se necessário, avalie uma arquitetura conceitual de dois eixos — qualidade/durabilidade para possuir no longo prazo e atratividade de entrada para comprar agora —, mas não a implemente nesta etapa.
- Um ranking pode ter poucos ou nenhum `BUY` em um mercado caro ou com prêmio de risco insuficiente. Não existe quota mínima de `BUY`.
- Uma estatal ou empresa de controle governamental não deve ser excluída apenas por sua natureza jurídica. Controle estatal é um fator de risco de governança a ser medido, não uma condenação automática.
- Histórico de resiliência não elimina risco político. O modelo deve medir ambos sem preconceito favorável ou desfavorável.
- A regra operacional vigente é `score >= 70 => BUY` e `score < 70 => WAIT`. Preserve-a durante a reconstrução do baseline. Qualquer proposta de mudança deve vir depois, como cenário comparável e não como ajuste para atingir uma quantidade desejada de compras.
- Cada item publicado tem exatamente um perfil. Investigue se a forma de escolher esse perfil é correta.
- Ordenação final: score decrescente; empate por composite estrutural. Verifique isso em todos os caminhos que podem modificar o ranking.

---

## Anomalia relatada e fatos preliminares que precisam ser reconciliados

Trate os itens abaixo como **pistas**, não como conclusões. Confirme cada um no código e nos dados atuais:

- O usuário relata cerca de duas semanas com apenas quatro `BUY` no ranking publicado de Ações.
- O artefato local `reports/ranking_latest.txt`, gerado em 19/07/2026, registra oito `BUY` em Ações. Identifique se ele é rascunho, resultado local, versão não publicada ou se diverge por outra razão.
- **Atenção ao vocabulário:** o código e o MongoDB usam `BUY`/`WAIT`, mas os relatórios TXT e a UI usam `COMPRAR`/`AGUARDAR`. Ao contar ou buscar actions em artefatos de texto, considere os dois vocabulários — um grep por `BUY` no TXT retorna zero e produziria um falso achado.
- Nesse artefato, `CMIG4`, uma estatal, aparece como `BUY`, enquanto `BBAS3` aparece muito abaixo do threshold e com indicação de dados de rentabilidade ausentes. Portanto, não atribua o caso Banco do Brasil somente à penalidade estatal.
- O código atual aparenta aplicar a estatais descontos de governança no Defensivo e Moderado, sem barramento categórico e sem desconto no Arrojado. Confirme os valores efetivos, inclusive overrides de ambiente.
- A lista de controle estatal parece curada manualmente. Verifique omissões, falsos positivos, empresas privatizadas, controle indireto e mudança de controle ao longo do tempo usando fontes oficiais e com data de corte.
- Caminhos diferentes parecem executar as etapas em ordens diferentes. Em especial, confira se beta, volatilidade, SMA200 e EMA50 são atualizados antes ou depois do ranking em cada entrypoint.
- O enriquecimento por IA pode vetar uma ação sem alterar o score. Verifique se isso cria `WAIT` com score igual ou superior a 70 e viola a regra global.
- O auto-publish parece validar apenas idade e quantidade total de itens, enquanto a publicação manual pode não compartilhar o mesmo gate. Confirme.
- Parte dos ativos pode ser removida antes de `scoringEngine.processAsset`, sem aparecer em `DiscardLog`. Reconstrua também essas exclusões silenciosas.

---

## Restrições de segurança e integridade

1. Comece lendo integralmente `AGENTS.md` e as instruções locais aplicáveis.
2. Registre commit/branch, data, timezone, estado do worktree e arquivos de entrada usados.
3. Preserve alterações existentes do usuário.
4. A auditoria inicial é **somente leitura**. Não execute `sync:prod`, endpoints de sync, rotas de publish, migrações, seeds, backfills, resets, limpezas ou qualquer comando que grave no MongoDB sem autorização explícita posterior.
5. Não mude `.env`, tunables, `BUY_THRESHOLD`, dados de mercado, flags de ativos ou documentos `MarketAnalysis`.
6. Não publique nem despublique conteúdo.
7. Nunca exiba secrets, connection strings, tokens, dados pessoais ou conteúdo do `.env`. Registre somente o nome das variáveis relevantes e se estão configuradas, quando isso puder ser feito sem revelar valores.
8. Scripts declarados como read-only só podem ser usados depois de confirmar no fonte que realmente não escrevem.
9. Se criar diagnóstico auxiliar, deixe-o isolado, determinístico e sem mutações externas. Prefira arquivo temporário ou proponha o script no relatório antes de adicioná-lo ao repositório.
10. Caso não haja acesso ao banco, não invente resultados. Faça a auditoria estática, marque o runtime como `[NÃO VERIFICADO]` e forneça as consultas/comandos exatos de somente leitura que faltam.
11. Não altere código na primeira entrega. Ao final, pare no plano de mudanças e aguarde aprovação.

---

## Fontes internas mínimas

Leia os arquivos relevantes por inteiro, seguindo imports e chamadas. Esta lista é o ponto de partida, não o limite:

### Orquestração, coleta e persistência

- `server/services/syncService.js`
- `server/services/marketDataService.js`
- `server/services/externalMarketService.js`
- `server/services/fundamentusService.js`
- `server/services/macroDataService.js`
- `server/services/fundamentalHistoryService.js`
- `server/services/workers/timeSeriesWorker.js`
- `server/services/usStocksFundamentalsService.js`
- `server/services/aiResearchService.js`
- `server/services/rankingTxtExportService.js`
- `server/scripts/syncProdData.js`
- `server/scripts/runRankingOnly.js`
- `server/scripts/inspectRanking.js`
- `server/scripts/diagnoseDraft.js`
- `server/services/schedulerService.js`

### Modelo, seleção e configuração

- `server/services/engines/scoringEngine.js`
- `server/services/engines/portfolioEngine.js`
- `server/services/aiEnhancementService.js`
- `server/config/financialConstants.js`
- `server/config/sectorTaxonomy.js`
- `server/config/sectorOverrides.js`
- `server/utils/sectorResolver.js`
- `server/services/configService.js`
- `server/models/MarketAsset.js`
- `server/models/MarketAnalysis.js`
- `server/models/DiscardLog.js`
- `server/models/FundamentalSnapshot.js`
- `server/models/AssetHistory.js`

### API, publicação e consumo

- `server/controllers/researchController.js`
- `server/routes/researchRoutes.js`
- `client/src/services/research.ts`
- `client/src/pages/Research.tsx`
- `client/src/components/research/ResearchViewer.tsx`
- `client/src/components/research/TopPicksCard.tsx`
- `client/src/components/research/AssetDetailModal.tsx`
- consumidores do ranking, como rebalanceamento e carteira recomendada.

### Evidência e regressão

- `reports/ranking_latest.txt`
- `server/logs/sync-report.txt`, sem expor dados sensíveis
- histórico publicado em `MarketAnalysis`, se houver acesso de leitura
- testes de scoring, ranking, draft, credibilidade, integração, Brasil 10, delta, publicação e ingestão em `server/tests/`.

Não use comentários ou documentação como prova única. Compare-os com o comportamento executável.

---

## Protocolo de evidência

Para toda afirmação relevante:

- cite `arquivo:linha` para comportamento do código;
- cite documento, data e identificador para evidência do banco/relatório;
- marque como `[VERIFICADO]`, `[INFERÊNCIA]`, `[HIPÓTESE]` ou `[NÃO VERIFICADO]`;
- diferencie regra declarada, implementação real e resultado observado;
- apresente um meio de reprodução;
- informe confiança `ALTA`, `MÉDIA` ou `BAIXA`;
- não trate comentário desatualizado como implementação;
- não cite linha antiga depois de editar arquivos — a primeira entrega não deve editar.

Para informações externas atuais — controle acionário, privatização, regras de mercado, eventos corporativos ou definição de indicadores — use fontes primárias e oficiais, como documentos de RI, CVM, B3, Banco Central, Tesouro ou legislação oficial. Registre URL e data de consulta. Notícias podem complementar, nunca substituir a fonte primária.

---

## Método obrigatório

### Fase 0 — Baseline reproduzível

1. Identifique todos os entrypoints que geram, recalculam, enriquecem, salvam ou publicam ranking:
   - script local de produção;
   - cron da manhã;
   - cron pós-mercado;
   - rota `/full-pipeline`;
   - rota `/crunch` bulk e por classe;
   - execução apenas de ranking;
   - enriquecimento por IA;
   - publicação manual;
   - auto-publicação semanal.
2. Para cada entrypoint, registre a ordem real das etapas, política de falha, dados usados, side effects e documento criado/alterado.
3. Calcule hash ou outro identificador do input lógico quando possível: timestamp dos fundamentais, cotações, séries, macro, tunables, commit e versão do algoritmo.
4. Rode apenas testes locais e diagnósticos sem side effects, **exclusivamente contra ambiente de teste ou banco em memória — nunca com `.env` de produção carregado nem conexão apontando para o MongoDB real**. Registre comando, resultado, duração e falhas preexistentes.
5. Antes de propor mudanças, congele uma fotografia do baseline analisado.

Entregue uma tabela:

| Entrypoint | Ordem real | Dados frescos? | Falha tolerada? | Gera rascunho? | Pode publicar? | Divergência |
|---|---|---:|---|---:|---:|---|

### Fase 1 — Linhagem dos dados, campo por campo

Para cada métrica consumida pelo ranking de Ações, documente:

- fonte primária e fallback;
- unidade e escala esperadas;
- parser e normalização;
- campo no MongoDB;
- regra de carry-forward;
- quando `0`, `null`, `undefined`, valor negativo e ausência têm significados diferentes;
- timestamp de preço, fundamentais, macro e série temporal;
- regra de staleness;
- flag `_missing` gerada;
- score, gate ou tese que consome o campo;
- teste que protege o contrato.

Inclua no mínimo: preço, liquidez, market cap, P/L, P/VP, ROE, ROIC, margem líquida, crescimento de receita, EV/EBITDA, dívida/patrimônio, dívida líquida, payout, DY, beta, volatilidade, SMA200, EMA50, setor, controle estatal, Selic, NTN-B e track record.

Procure especialmente por:

- zero legítimo confundido com dado ausente;
- dado ausente convertido em zero e posteriormente tratado como fundamento ruim;
- valor antigo preservado quando o valor atual é legitimamente zero;
- timestamps de preço usados como se fossem de fundamentos;
- unidades incompatíveis entre fontes;
- campos financeiros aplicados a bancos, seguradoras ou holdings apesar de não serem comparáveis;
- fallback que mantém o pipeline “verde” mas degrada a recomendação;
- scrape parcial de Ações aceito porque outra classe retornou dados;
- layout alterado, amostra pequena, duplicidade, ticker incorreto ou ação corporativa;
- métricas temporais calculadas depois do ranking em algum entrypoint.

Produza a matriz:

| Métrica | Fonte | Fallback | Unidade | Zero válido? | Regra de ausência | Staleness | Consumidores | Risco encontrado |
|---|---|---|---|---:|---|---|---|---|

### Fase 2 — Funil completo do universo de Ações

Reconstrua numericamente o funil, sem começar apenas nos ativos que chegaram ao scoring:

1. linhas retornadas pela fonte;
2. linhas parseadas e válidas;
3. corte de liquidez da ingestão;
4. ativos persistidos;
5. `isActive`;
6. `isIgnored`;
7. `isBlacklisted`;
8. deduplicação por empresa/classe de ação;
9. preço válido;
10. liquidez mínima do scoring;
11. processados pelo scoring;
12. elegíveis ao Defensivo;
13. score máximo por ativo igual ou superior a 70;
14. selecionados pelo draft;
15. `BUY` antes da penalidade de concentração;
16. `BUY` após a penalidade;
17. `BUY` após eventual IA qualitativa;
18. salvos no rascunho;
19. efetivamente publicados;
20. efetivamente exibidos por perfil no frontend.

Para cada perda, informe contagem, percentual, tickers afetados e motivo. Não use somente `DiscardLog`: filtros do query, flags e deduplicação podem ocorrer antes dele.

Repita o funil para cada execução relevante dos últimos 14 dias. Faça também resumos de 30 e 90 dias, se o histórico existir.

### Fase 3 — Reconciliação dos “quatro BUY”

Construa uma linha do tempo dos rankings `STOCK` gerados e publicados contendo:

- `_id`, `date`, `createdAt`, `generatedBy` e flags de publicação;
- entrypoint provável;
- quantidade total e quantidade de `BUY` por perfil;
- distribuição de score, confiança e tier;
- macro e idade dos dados usados;
- upgrades/downgrades;
- se houve enriquecimento por IA;
- hash/diff dos tickers e scores;
- qual documento o endpoint `/latest` retornaria em cada momento;
- qual documento o frontend realmente exibiu.

Explique a divergência entre o relato de quatro `BUY` e qualquer artefato com contagem diferente. Não compare datas ou versões diferentes como se fossem o mesmo ranking.

Entregue uma árvore causal quantitativa. Exemplo de categorias, sem presumir o resultado:

```text
Universo ausente/inativo/blacklist
  -> descarte por preço/liquidez
  -> gate de perfil
  -> score base e bônus insuficientes
  -> confiança/missing/stale
  -> valuation e macro
  -> penalidades de risco/governança/ciclo/momentum
  -> atribuição do perfil no draft
  -> concentração
  -> veto qualitativo
  -> seleção/publicação/UI
```

### Fase 4 — Auditoria matemática do scoring de Ações

Reconstrua as fórmulas efetivas dos três perfis e dos três scores estruturais. Não resuma apenas em prosa: mostre bases, gates, faixas, bônus, penalidades, tetos, ordem de aplicação e clamp.

Verifique:

- se `QUALITY`, `VALUATION` e `RISK` influenciam o score de perfil ou apenas o desempate;
- se o usuário pode interpretar os scores estruturais como componentes quando matematicamente não são;
- dupla contagem de DY, ROE, crescimento, valuation, tendência, ciclicidade, alavancagem e governança;
- descontinuidades perto dos thresholds;
- teto de confiança exatamente em 70 permitindo `BUY` com baixa confiança;
- dedução direta de confiança combinada com cap e clamp;
- efeito de macro stale e de Selic/NTN-B alta;
- adequação de Graham, Bazin e PEG por setor;
- uso de métricas não comparáveis em bancos, seguradoras, holdings, utilities, commodities e incorporadoras;
- empresas sem lucro, lucro de pico, payout extraordinário, dividendos não recorrentes e eventos societários;
- ausência de fluxo de caixa, recorrência de lucro, eficiência operacional, qualidade do capital e indicadores setoriais relevantes;
- peso real de track record versus fotografia atual;
- papel de preço e momentum em uma filosofia Buy & Hold;
- estabilidade e turnover induzidos por fronteiras rígidas.

Faça um waterfall reconciliável para:

- todos os `BUY` publicados;
- todos os ativos entre 60 e 74 pontos;
- dez ativos fortes que ficaram fora do ranking;
- `BBAS3`, `CMIG4`, `PETR4`, `BBSE3`, `SAPR11` e demais estatais presentes no universo;
- pares de comparação privados do mesmo setor e porte.

Para cada ativo, mostre:

`score base -> bônus -> penalidades -> confiança -> caps -> clamp -> perfil escolhido -> concentração -> IA -> action publicada`.

A soma deve reconciliar exatamente. Se não reconciliar, isso é achado de alta prioridade.

### Fase 5 — Draft competitivo e atribuição de perfil

Audite o algoritmo como problema de alocação, não apenas como três sorts.

1. Confirme a ordem `DEFENSIVE -> MODERATE -> BOLD`, o uso global de `usedTickers`, metas por perfil, tiers e limites de concentração.
2. Liste ativos selecionados cedo para um perfil com score menor, embora tivessem score igual ou superior a 70 em outro perfil.
3. Calcule o **arrependimento de atribuição** por ativo:
   - `melhor score entre perfis - score do perfil atribuído`;
   - quantidade de `WAIT` selecionados cujo outro perfil seria `BUY`;
   - quantidade de `BUY` latentes fora do ranking;
   - quantidade de ativos excluídos porque o target já estava cheio;
   - quantidade bloqueada por setor em cada tier.
4. Compare o greedy atual com um contrafactual de alocação global que preserve:
   - um único perfil por ticker;
   - até dez ativos por perfil;
   - limites setoriais;
   - ordenação final e threshold atuais.
5. O contrafactual deve buscar, em cenários separados:
   - maximizar score total;
   - maximizar quantidade de `BUY` sem reduzir qualidade mínima;
   - minimizar arrependimento de atribuição;
   - manter diversificação.
6. Não recomende automaticamente trocar o algoritmo. Quantifique benefício, turnover, complexidade e regressões.
7. Verifique se a penalidade pós-draft transforma `BUY` em `WAIT`, se a lista é reotimizada depois disso e se um candidato melhor poderia substituir o penalizado.
8. Verifique se GOLD/SILVER/BRONZE comunicam qualidade ou apenas mecanismo de preenchimento. Um item GOLD pode ser `WAIT`; avalie risco de interpretação.

Use o trace existente do draft quando possível e apresente uma tabela por perfil.

### Fase 6 — Estatais e governança, sem viés categórico

Faça um estudo isolado, rigoroso e atual do tratamento de empresas controladas pelo Estado.

#### 6.1 Classificação

- Revalide a lista inteira de controle estatal usando fontes oficiais na data da auditoria.
- Diferencie: controle direto, controle indireto, participação minoritária, golden share, corporation privatizada e empresa regulada sem controle estatal.
- Detecte tickers/classes ausentes e falsos positivos.
- Verifique normalização de ticker, units, ON/PN e mudanças históricas de controle.
- Não limite a busca aos nomes já presentes na lista hardcoded.

#### 6.2 Efeito causal

Para cada estatal do universo, calcule sem alterar produção:

- score atual por perfil;
- score removendo **somente** a penalidade de controle estatal;
- score corrigindo **somente** falhas verificadas de dados, sem imputação arbitrária;
- score removendo apenas penalidades possivelmente duplicadas;
- efeito do gate setorial/cíclico;
- efeito do draft e da concentração;
- action em cada estágio.

Não some deltas contrafactuais como se fossem lineares quando houver gates, caps e clamps.

#### 6.3 Adequação à filosofia

Compare estatais com pares privados do mesmo setor, porte, liquidez e regime econômico. Avalie, quando houver dados point-in-time confiáveis:

- consistência de lucro, ROE/ROIC e dividendos;
- payout recorrente versus extraordinário;
- alavancagem e solvência;
- diluição e alocação de capital;
- interferência política material observável;
- mudança de política de preços/capex;
- governança, free float e direitos de minoritários;
- drawdown, recuperação e sobrevivência em múltiplos ciclos;
- valuation que já precifica parte do risco.

Responda:

1. O controle estatal deve ser gate, desconto fixo, risco graduado, metadado ou combinação?
2. O desconto atual é empiricamente calibrado ou apenas opinião codificada?
3. Ele duplica riscos já capturados por setor cíclico, beta, volatilidade, payout ou valuation?
4. `BBAS3` falha por governança, por dados ausentes, por preço/momentum, por atribuição de perfil ou por combinação? Quantifique.
5. Uma empresa resiliente por décadas recebe crédito suficiente pelo track record?
6. A ausência de histórico profundo torna o algoritmo dependente demais do snapshot atual?

Compare pelo menos estes cenários, mantendo todo o resto constante:

- A — regra atual;
- B — sem desconto fixo de estatal;
- C — risco de governança graduado e explicável;
- D — apenas metadado/alerta, sem efeito no score;
- E — exclusão categórica, somente como controle negativo para demonstrar o impacto, não como recomendação presumida.

Para cada cenário, mostre mudanças de score, perfil, posição, `BUY`, concentração, turnover e desempenho histórico válido. A recomendação final deve nascer da evidência, não da preferência do solicitante nem da implementação atual.

### Fase 7 — Publicação, integridade e versão exibida

Rastreie a transição:

`dados -> ranking calculado -> MarketAnalysis rascunho -> eventual IA -> validação -> publicação -> endpoint -> frontend -> consumidores downstream`.

Audite:

- diferenças de ordem entre entrypoints;
- tratamento de falhas parciais por classe;
- rankings vazios salvos;
- identificação de um mesmo batch entre classes;
- atomicidade de publicação;
- versão mais recente versus última versão válida;
- baseline do delta de posição;
- possibilidade de editar/enriquecer documento já publicado;
- IA qualitativa alterando `action` sem reconciliar score e regra global;
- reordenação pós-IA e atualização de `position`/delta;
- gate manual versus gate automático;
- gate de cobertura, completude, staleness, macro, invariantes e mudança anormal;
- publicação de conteúdo parcial tornando ranking não publicado acessível no payload;
- notificações duplicadas ou ausentes;
- TTL e preservação do histórico canônico;
- consumidores que assumem `BUY <=> score >= 70`, como rebalanceamento e carteira recomendada;
- comportamento do frontend por perfil, top 10 e filtros.

Monte uma matriz de pré-publicação recomendada, sem implementar:

| Controle | Atual manual | Atual automático | Risco | Regra proposta | Bloqueia ou alerta? |
|---|---:|---:|---|---|---|

Inclua no mínimo:

- quantidade e cobertura do universo;
- completude e staleness por campo crítico;
- macro válido;
- séries temporais frescas;
- `action` coerente com score após todas as mutações;
- sort/posição/delta coerentes;
- um perfil por ticker e ausência de duplicatas;
- desvio de contagem de `BUY` e score versus baseline;
- mudança excessiva de composição/turnover;
- presença de run ID, versão do algoritmo e timestamp dos inputs;
- possibilidade de rollback para última versão válida.

### Fase 8 — Validação estatística e econômica

Não valide o modelo apenas porque os testes unitários passam ou porque uma empresa conhecida aparece no topo.

#### 8.1 Testes determinísticos

- Rode os testes existentes mais próximos de scoring, draft, ranking, ingestão, delta e publicação — sempre contra ambiente de teste/banco em memória, conforme a Fase 0, item 4.
- Identifique lacunas e proponha testes de regressão para cada achado.
- Inclua property-based/invariant tests quando apropriado.
- Teste valores de fronteira e metamórficos: melhorar uma métrica positiva isolada não deveria piorar o score sem motivo explícito; remover um risco não deveria piorar a action.
- Teste paridade entre todos os entrypoints com o mesmo snapshot de input.

#### 8.2 Backtest válido

Se houver dados históricos point-in-time suficientes, use walk-forward/out-of-sample e evite:

- look-ahead bias;
- survivorship bias;
- usar fundamentos atuais em datas passadas;
- usar universo atual como universo histórico;
- ignorar delistings, proventos, splits, custos e liquidez;
- otimizar e avaliar no mesmo período;
- escolher parâmetros para favorecer casos conhecidos.

Se `FundamentalSnapshot` só acumulou dados recentemente, diga claramente que não existe profundidade para um backtest histórico integral do scoring atual. Nesse caso, proponha shadow mode e coleta prospectiva; não fabrique histórico.

#### 8.3 Métricas

Avalie por perfil e por coorte:

- retorno total e excesso sobre Ibovespa, CDI e/ou benchmark adequado;
- volatilidade, downside deviation, max drawdown e tempo de recuperação;
- Sharpe/Sortino apenas quando metodologicamente defensáveis;
- hit rate e payoff médio;
- turnover e estabilidade do top 10;
- persistência de `BUY`;
- performance de upgrades e downgrades;
- calibração do threshold 70;
- distribuição e saturação dos scores;
- cobertura do universo;
- desempenho de estatais versus pares privados;
- desempenho com e sem cada grande família de penalidade.

Faça sensibilidade de threshold e pesos somente como diagnóstico. Não escolha o número que produz mais `BUY`; escolha critérios por robustez fora da amostra, coerência econômica e custo de erro.

### Fase 9 — Síntese e opções de decisão

Separe recomendações em:

- correção inequívoca de bug ou inconsistência;
- melhoria de observabilidade/dados;
- recalibração que exige evidência;
- mudança de filosofia/produto que exige decisão do dono;
- experimento sem impacto em produção;
- item que deve permanecer como está.

Para cada proposta, apresente:

- problema e evidência;
- causa raiz;
- impacto observado;
- opção mínima e opção estrutural;
- risco de regressão;
- dados necessários;
- teste de aceitação;
- métrica de sucesso;
- estratégia de rollout, shadow mode e rollback;
- arquivos provavelmente afetados;
- se altera uma regra hoje considerada inviolável.

Não implemente nada. Termine com uma ordem recomendada de decisão e as perguntas que o dono do produto precisa responder.

---

## Perguntas obrigatórias que o relatório deve responder

1. Por que houve apenas quatro `BUY` no ranking publicado de Ações durante o período relatado?
2. Quantos ativos seriam `BUY` antes de cada filtro, penalidade, draft, IA e publicação?
3. O número baixo foi causado majoritariamente por mercado, dados, scoring, draft ou publicação?
4. O artefato local com oito `BUY` e o ranking publicado com quatro são versões diferentes? Qual é a linhagem de cada um?
5. Existem `BUY` latentes fora do ranking ou ativos atribuídos ao perfil errado pelo greedy?
6. Quais penalidades mais retiraram pontos de ativos próximos de 70?
7. Quantos pontos foram perdidos por ausência/staleness de dados, especialmente em bancos e seguradoras?
8. O sistema distingue “empresa excelente para possuir” de “bom preço para comprar agora”?
9. O Defensivo mede resiliência plurianual ou depende excessivamente da fotografia atual?
10. Momentum e valuation têm peso coerente com Buy & Hold?
11. O tratamento de setores cíclicos é demasiado categórico?
12. Estatais estão excluídas, penalizadas ou apenas perdendo por outros fatores?
13. A penalidade estatal atual é justificada, completa, atualizada e não duplicada?
14. Qual seria o resultado de `BBAS3` com dados completos e sem alterar mais nenhuma regra?
15. Quais estatais faltam ou sobram na taxonomia atual?
16. O mesmo snapshot produz o mesmo ranking em todos os entrypoints?
17. Algum caminho viola `BUY <=> score >= 70` depois do scoring?
18. O ranking salvo, o publicado, o retornado pela API e o exibido são idênticos?
19. Os gates de publicação impedem ranking degradado, porém não bloqueiam escassez legítima?
20. Que mudanças são bugs claros e quais dependem de decisão filosófica?

---

## Formato obrigatório da entrega

### Parte 1 — Resumo executivo para decisão

Explique em linguagem clara:

- conclusão sobre os quatro `BUY`;
- o que é saudável no sistema;
- riscos principais;
- situação das estatais e de `BBAS3`;
- três a cinco decisões prioritárias;
- o que não deve ser mudado precipitadamente.

### Parte 2 — Pipeline real e reconciliação dos "quatro BUY"

- diagrama end-to-end;
- matriz de entrypoints;
- divergências de ordem e política de falha;
- linhagem de rascunho até UI;
- linha do tempo dos rankings `STOCK` gerados e publicados (Fase 3), com a reconciliação explícita entre os quatro `BUY` relatados e os oito do artefato local;
- árvore causal quantitativa da escassez de `BUY`.

### Parte 3 — Dados e funil

- matriz campo/fonte/fallback/unidade/staleness;
- funil de Ações com contagens e tickers;
- exclusões silenciosas;
- qualidade dos dados por setor e por período.

### Parte 4 — Scoring e draft

- fórmulas e ordem de aplicação;
- distribuição dos scores;
- waterfalls dos casos-âncora;
- análise de dupla contagem;
- atribuição de perfil, regret e `BUY` latentes;
- concentração antes/depois.

### Parte 5 — Estudo de estatais

- taxonomia atualizada e fontes;
- comparação com pares;
- contrafactuais A–E;
- recomendação sobre gate, desconto fixo, risco graduado ou metadado;
- resposta específica sobre Banco do Brasil.

### Parte 6 — Publicação e controles

- reconciliação de versões;
- invariantes pós-IA;
- matriz de gates manual/automático;
- observabilidade, versionamento, atomicidade e rollback.

### Parte 7 — Validação

- testes executados;
- lacunas de cobertura;
- validade e limites do backtest;
- plano de shadow mode e métricas.

### Parte 8 — Achados priorizados

Use a tabela:

| ID | Severidade | Confiança | Status | Camada | Achado | Evidência | Impacto | Causa raiz | Direção |
|---|---|---|---|---|---|---|---|---|---|

Severidade:

- `CRÍTICA`: pode publicar recomendação incoerente ou baseada em dados inválidos;
- `ALTA`: altera materialmente score, perfil, action ou universo;
- `MÉDIA`: afeta subconjunto, estabilidade, explicabilidade ou controle;
- `BAIXA`: higiene, manutenção ou observabilidade sem distorção demonstrada.

### Parte 9 — Plano sem implementação

Organize em:

- Fase A: observabilidade e correções inequívocas;
- Fase B: paridade de pipeline e gate de publicação;
- Fase C: qualidade/linhagem de dados e modelos setoriais;
- Fase D: experimento de draft e governança graduada;
- Fase E: validação prospectiva e eventual recalibração.

Inclua esforço relativo, dependências, risco, teste de aceitação e rollback.

### Apêndices obrigatórios

- comandos de somente leitura executados;
- arquivos e linhas citados;
- queries de banco usadas, sem credenciais;
- lista de hipóteses não confirmadas;
- lista de dados que faltam;
- tabela de constantes hardcoded, env e tunables;
- glossário dos conceitos financeiros;
- checklist de aceitação da próxima fase.

---

## Critérios de qualidade da resposta

A entrega só está completa se:

- reconcilia a contagem de quatro versus oito `BUY` por documento e data;
- apresenta o funil quantitativo completo de Ações;
- separa problema de dados de mérito financeiro;
- isola matematicamente a penalidade estatal;
- mede o efeito do draft/atribuição de perfil;
- audita mutações depois do score, inclusive IA;
- compara todos os entrypoints;
- verifica rascunho, publicação, API e frontend;
- não recomenda aumentar `BUY` por quota;
- não usa backtest com vazamento temporal;
- distingue bug, calibração e decisão filosófica;
- cita evidência reproduzível;
- não altera produção.

Se o relatório ficar longo, divida a entrega em arquivos/partes, mas não reduza o escopo.

**Priorização obrigatória:** as Fases 0 a 3 (baseline, linhagem de dados, funil e reconciliação dos quatro `BUY`) são o núcleo da primeira entrega e devem ser concluídas antes de qualquer outra. As Fases 4 a 8 podem ser entregues como continuação, na ordem definida, sem redução de escopo — se o tempo ou o acesso acabar, entregue as Fases 0–3 completas com as demais marcadas como pendentes, em vez de todas as fases pela metade. Comece pela conclusão provisória e pelo mapa de evidências; depois execute as fases na ordem acima.
