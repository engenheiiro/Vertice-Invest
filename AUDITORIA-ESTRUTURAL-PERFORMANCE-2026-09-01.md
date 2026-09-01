# Auditoria estrutural e de performance — Vértice Invest

**Data da auditoria:** 01/09/2026

**Escopo:** frontend, backend, MongoDB, integrações, jobs, testes, build e observabilidade

**Status:** diagnóstico concluído; Fase 0 de instrumentação e baseline implementada em 01/09/2026

**Prompt de origem:** [`prompt_auditoria_estrutural_performance.txt`](prompt_auditoria_estrutural_performance.txt)
**Auditoria anterior:** [`RESULTADO-AUDITORIA.md`](RESULTADO-AUDITORIA.md)

> Este documento é a fotografia técnica de 01/09/2026 e o plano de referência
> para a execução futura. As estimativas de velocidade não substituem baseline
> em produção. Toda alteração financeira deve preservar as regras de negócio do
> [`AGENTS.md`](AGENTS.md), especialmente threshold global 70, ordenação soberana,
> perfis, matemática segura e transações da carteira.

---

## 1. Resumo executivo

O Vértice possui uma base madura: boa cobertura automatizada, regras financeiras
testadas, transações MongoDB, circuit breaker, correlation ID, validação, rate
limiting e code splitting no frontend. Não há justificativa técnica para uma
reescrita total.

O trabalho recomendado é uma sequência de correções e refatorações localizadas,
começando por consistência financeira e estabilidade. O principal ganho de
velocidade deverá vir da redução de I/O redundante, queries crescentes e esperas
por serviços externos — não de micro-otimizações do código de cálculo.

### Maiores riscos

1. Alguns caminhos monetários ainda usam multiplicação direta de `Number`, fora
   das operações seguras de `mathUtils.js`.
2. O timeout de transação usa `Promise.race`, mas não cancela a função que continua
   executando após o abort da sessão.
3. Histórico de transações e snapshots pode crescer com índices/payloads
   inadequados; jobs não possuem exclusão cluster-wide.

### Maiores oportunidades

1. Eliminar invalidações globais e chamadas de carteira em páginas que não usam
   dados de carteira.
2. Corrigir índices, paginar/downsample de históricos e servir cotações com
   stale-while-revalidate.
3. Decompor `scoringEngine`, `walletController` e `WalletContext` com testes de
   paridade, sem mudar os resultados financeiros.

### Avaliação

| Área | Nota | Justificativa |
|---|---:|---|
| Arquitetura | 7,0 | Boa separação macro; engines e controllers concentram responsabilidades demais. |
| Backend | 7,2 | Resiliência forte; há rotas dependentes de rede e falhas silenciosas. |
| Frontend | 6,8 | Code splitting presente; contexts e invalidações causam I/O e renders redundantes. |
| Banco de dados | 6,5 | Schemas razoáveis; faltam índices alinhados a históricos e consultas limitadas. |
| Segurança | 8,0 | Helmet, CSP, JWT, MFA, rate limiting e sanitização; há log parcial de API key. |
| Observabilidade | 6,0 | Sentry, Winston, correlation ID e JobRun; faltam métricas p50/p95/p99 e event-loop lag. |
| Testes | 9,0 | 2.821 testes aprovados e gates de cobertura para engines centrais. |
| Escalabilidade | 6,2 | Adequado ao volume atual; jobs e históricos exigem hardening para escala horizontal. |

Nenhum achado P0 foi confirmado.

---

## 2. Evidências e validações executadas

| Verificação | Resultado |
|---|---|
| TypeScript frontend | Aprovado |
| ESLint frontend/backend | Aprovado; 2 avisos não bloqueantes |
| Testes frontend | 65 arquivos, 855 testes aprovados |
| Testes backend | 179 arquivos, 1.977 testes aprovados após a Fase 0 |
| Total de testes | 2.832 aprovados |
| Build Vite de produção | Aprovado; validação mais recente em 10,15 s |
| Precache PWA | 103 entradas, 2,37 MiB |
| Chunk comum `index` | 417,65 KB raw / 130,65 KB gzip |
| Chunk Recharts | 350,14 KB raw / 98,28 KB gzip |
| CSS | 176,79 KB raw / 28,39 KB gzip |
| Landing emitida | 234,10 KB raw / 70,96 KB gzip |

### Execução da Fase 0 — 01/09/2026

Instrumentação adicionada. A coleta leve fica ativa por padrão e pode ser
desligada explicitamente com `PERF_METRICS_ENABLED=false`:

- registro bounded em memória, com amostragem e limites de séries/amostras;
- p50/p95/p99 de HTTP, Axios, Yahoo Finance, comandos Mongo e etapas do pipeline;
- RSS, heap, memória externa, uptime e event-loop delay;
- contadores de hit/miss/fallback dos caches de usuário/plano e cotação;
- snapshot somente para admin em `GET /api/admin/performance-metrics`;
- painel compacto em **Admin → Saúde**, com rota HTTP mais lenta, taxa de erro,
  memória, event-loop e cache; detalhes técnicos ficam recolhidos;
- command monitoring Mongo separado e opt-in por `PERF_MONGO_COMMANDS_ENABLED`;
- scripts read-only `benchmark:http`, `benchmark:mongo` e `benchmark:web`;
- normalização de rota e proibição de query strings, documentos, filtros, tokens,
  cookies ou PII nas métricas.

O painel deixa explícito quando a coleta está desativada ou indisponível e não
interrompe os demais controles da aba Saúde. As leituras continuam em memória e
reiniciam junto com o servidor; nesta fase não foi criada persistência histórica.
O componente foi validado visualmente em desktop e em viewport estreito, onde os
cinco medidores se reorganizam em duas colunas.

#### Baseline HTTP pública

`GET https://verticeinvest.com.br/api/health`, 3 warmups + 30 requests
sequenciais:

| Média | p50 | p95 | p99 | Erros | Payload médio |
|---:|---:|---:|---:|---:|---:|
| 201,87 ms | 191,87 ms | 308,82 ms | 416,65 ms | 0/30 | 110 bytes |

O health mede rede/TLS/proxy + aplicação, mas não representa as rotas autenticadas
ou a carga do MongoDB.

#### Baseline Web Vitals pública

Landing pública, Chromium headless desktop, cinco contextos frios independentes:

| Métrica | p50 | p95 |
|---|---:|---:|
| TTFB | 284,9 ms | 544,3 ms |
| DOMContentLoaded | 1.356,0 ms | 1.863,4 ms |
| Load | 1.474,8 ms | 1.919,7 ms |
| FCP | 888 ms | 1.176 ms |
| LCP | 1.428 ms | 1.956 ms |
| INP sintético | 56 ms | 64 ms |
| Recursos | 15 | 15 |
| Transferência | 535,78 KiB | 535,78 KiB |

Comparação local do mesmo build, três execuções: FCP p50 152 ms, LCP p50
244 ms e INP sintético p50 40 ms. O contraste confirma que rede, entrega e cache
participam materialmente do tempo percebido. Esta amostra headless não substitui
RUM de usuários reais.

#### Baseline MongoDB

`explain("executionStats")` read-only, página de 20 itens, usando uma carteira já
existente sem imprimir seus dados:

| Query | Retornados | Keys | Docs | Plano relevante |
|---|---:|---:|---:|---|
| Cashflow por wallet | 20 | 26 | 26 | `IXSCAN → FETCH → SORT` |
| Snapshots ascendentes | 20 | 20 | 20 | `IXSCAN → FETCH → LIMIT` |
| Transações por ticker | 2 | 2 | 2 | `IXSCAN → FETCH → SORT` |

O volume amostrado é pequeno, portanto os tempos de 0–3 ms não demonstram um
gargalo atual. Entretanto, a presença confirmada de `SORT` valida o achado A03 e
justifica comparar os novos índices na Fase 3 com massa extensa.

#### Limitações restantes

- Dashboard, wallet e research autenticados precisam de um token de benchmark e
  devem ser medidos depois do deploy da instrumentação;
- pipeline completo não foi disparado em produção, pois grava relatórios e logs;
- cache hit rate, event-loop e chamadas externas terão baseline real somente após
  uma janela representativa com a feature flag ligada;
- número de renders ainda deve ser coletado com React Profiler em sessão real;
- o launcher global do `npm` segue quebrado no host; foram usados os binários locais.

---

## 3. Mapa dos fluxos críticos

### Pesquisa e ranking

`POST /research/full-pipeline` → `aiResearchService` → `scoringEngine` →
`portfolioEngine` → delta contra o relatório anterior → `MarketAnalysis` →
`GET /research/latest` → página Research.

CPU concentra-se no scoring e no draft; MongoDB participa da carga do universo,
baseline e persistência. As seis classes são calculadas sequencialmente antes do
Brasil 10.

### Dashboard

Autenticação → `ProtectedAppLayout` → `WalletProvider` → `/wallets`, `/wallet`,
`/wallet/history` → `useDashboardData` → macro, dividendos, sinais e três
relatórios de research.

Uma abertura pode realizar até nove chamadas HTTP de dados. Uma atualização de
perfil no foco da janela invalida todas as queries ativas.

### Carteira e transações

Frontend → autenticação → resolução de carteira → controller → transação MongoDB
→ `AssetTransaction` + recálculo de `UserAsset` → invalidações React Query.

### Cotações

Scheduler ou requisição → `marketDataService` → Yahoo Finance → fallbacks
Google/Brapi → cache `MarketAsset`. Alguns fluxos interativos ainda esperam o
refresh externo terminar.

### Snapshots

Cron diário → carteiras sequenciais → ativos/cotações/transações → Modified
Dietz/TWRR → `WalletSnapshot`.

### Autenticação

Login/MFA → access token → refresh token persistido → interceptor 401 → renovação
e liberação da fila de requests. O middleware possui cache e downgrade automático
de plano.

---

## 4. Achados priorizados

| ID | Achado | Evidência principal | Criticidade | Esforço | Confiança | Antes → depois |
|---|---|---|---|---|---|---|
| A01 | Matemática monetária direta | `server/controllers/walletController.js:884-885`; `portfolioImportService.js:313-322`; `schedulerService.js:225` | P1 | S | Alta | `quantity * price` → `safeQuantity` + `safeMult` + `safeCurrency` |
| A02 | Timeout não cancela transação | `server/utils/dbTransaction.js:41-55` | P1 | M | Alta | `Promise.race` com função viva → lifecycle transacional cancelável/limitado no Mongo |
| A03 | Índices não cobrem os históricos | `server/models/AssetTransaction.js:58-62`; `walletController.js:1196,1344` | P1 | S | Alta | sort amplo/em memória → índices por wallet, ticker, date e createdAt |
| A04 | Histórico de snapshots ilimitado | `server/controllers/walletController.js:665-672,854-855` | P2 | M | Alta | O(dias) → janela limitada/downsample |
| A05 | Invalidação global ao atualizar perfil | `client/src/contexts/AuthContext.tsx:68-109` | P2 | S | Alta | todas as queries stale → somente perfil e feature gates afetados |
| A06 | `WalletProvider` em toda área autenticada | `client/src/App.tsx:74-84`; `WalletContext.tsx:240-276` | P2 | M | Alta | 3 chamadas em páginas sem carteira → 0 |
| A07 | Research refaz fetch ao trocar visualização | `client/src/pages/Research.tsx:82-135` | P2 | S | Alta | 1 request por toggle → 0, com React Query |
| A08 | Erro do ranking vira lista vazia | `server/services/aiResearchService.js:643-645,792` | P1 | M | Alta | classe falha parece vazia/concluída → erro tipado e batch parcial/falho |
| A09 | Jobs sem lease distribuído | `server/services/schedulerService.js:68-102` | P1 | L | Alta sobre ausência | 1 execução por instância → no máximo 1 no cluster |
| A10 | Scheduler inicializado antes do DB | `server/app.js:60`; `server/index.js:62-83` | P2 | S | Alta | timers durante import → inicialização após DB/listen |
| A11 | `scoringEngine` excessivamente complexo | `server/services/engines/scoringEngine.js` | P2 | L | Alta | funções CC 153/190 → módulos puros com CC < 20 |
| A12 | Hidratação Mongoose além do necessário | `server/services/marketDataService.js:641-679` | P2 | S | Alta | documentos amplos → projection + `lean()` + resumos |
| A13 | Draft ordena candidatos até 9 vezes | `server/services/engines/portfolioEngine.js:101-115` | P3 | M | Alta | O(9N log N) → O(3N log N) |
| A14 | Busca linear no scanner | `server/services/engines/signalEngine.js:416-419` | P3 | XS | Alta | O(S×N) → O(S) com `Set.has` |
| A15 | Prefixo da API key no log | `server/index.js:98` | P2 | XS | Alta | quatro caracteres expostos → apenas status configurada/não configurada |
| A16 | Sentry fixo em 100% | `client/src/index.tsx:26-28` | P2 | XS | Alta | sampling 1.0 e domínio placeholder → sampling por ambiente e domínio real |

---

## 5. Complexidade estrutural

Complexidades ciclomáticas levantadas com ESLint configurado temporariamente com
limite 15, sem alterar a configuração do projeto:

| Módulo/função | Complexidade observada | Problema | Alvo sugerido |
|---|---:|---|---:|
| `calculateStructuralScores` | 190 | Qualidade, valuation, risco e classes acoplados | <20 por unidade |
| `scoreStockProfiles` | 153 | Pesos, gates e auditoria juntos | <20 |
| `scoreFiiProfiles` | 73 | Alta densidade de regras condicionais | <20 |
| `recalculatePosition` | 75 | FIFO, custo e posição no mesmo fluxo | <20 por etapa |
| `processWalletAsset` | 61 | Cotação, cálculo e DTO misturados | <15 |
| `WalletProvider` | 48 | Queries, seleção e mutações num provider | <15 por contexto |
| `Research` | 38 | Permissão, rede, tabs e render no componente | <15 |
| `runScanner` | 37 | Carga, indicadores, persistência e limpeza | <20 |

A refatoração desses módulos deve ser orientada por paridade. Para o scoring,
todos os resultados de score, perfil, BUY/WAIT, auditoria, ordem e desempate devem
permanecer idênticos antes e depois.

---

## 6. Plano de execução

### Fase 0 — Instrumentação e baseline

**Objetivo:** medir antes de otimizar.

- p50/p95/p99 das rotas críticas;
- planos de execução das queries MongoDB;
- cache hit/miss/stale;
- duração de APIs externas;
- duração de jobs e pipeline por classe;
- event-loop lag, CPU, RSS, heap e GC;
- FCP, LCP, INP, chunks e renders React.

**Aceite:** baseline reproduzível registrado e nenhuma regra funcional alterada.

### Fase 1 — Correções críticas

1. A01: matemática financeira segura.
2. A02: lifecycle/timeout das transações.
3. A08: propagação correta de falhas do ranking.
4. A15: remoção do prefixo da API key.
5. A10: inicialização segura do scheduler.

**Aceite:** testes financeiros, transacionais e de pipeline aprovados; nenhum
ranking válido ou saldo esperado alterado sem justificativa e teste.

### Fase 2 — Quick wins

1. A05: invalidação seletiva.
2. A07: Research usando React Query.
3. A14: `Set.has` no scanner.
4. A12: `lean()` e projections.
5. Paralelizar `find` e `countDocuments` onde seguro.
6. Configurar sampling do Sentry por ambiente.

**Aceite:** redução de requests/renders comprovada e testes completos aprovados.

### Fase 3 — Banco e backend

1. A03: índices e `explain` antes/depois.
2. A04: paginação/downsample dos snapshots.
3. stale-while-revalidate para cotações em leituras interativas.
4. A09: lease distribuído para jobs.
5. concorrência limitada/checkpoint nos snapshots.

**Aceite:** queries sem sort em memória, payload limitado, ausência de jobs
duplicados e melhora de p95 comprovada.

### Fase 4 — Frontend

1. A06: escopo do `WalletProvider`.
2. dividir dados, ações e seleção de carteira em contexts menores;
3. memoizar valores/callbacks somente após medir renders;
4. revisar chunks comuns, Recharts e precache do PWA;
5. limpar warnings de testes React/Recharts.

**Aceite:** páginas sem carteira fazem zero chamadas de carteira; menos renders e
redução mensurável do carregamento inicial.

### Fase 5 — Arquitetura e escalabilidade

1. A11: decomposição incremental do scoring;
2. decomposição de `walletController` e `financialService`;
3. pipeline de ranking em worker/fila com concorrência limitada;
4. pré-ordenação do draft;
5. snapshots escaláveis por lotes e checkpoints.

**Aceite:** testes golden demonstram paridade, complexidade cai e o event loop
permanece responsivo durante pipeline/jobs.

---

## 7. Plano de benchmarks

### Massa de dados

- carteiras com 10, 100, 1.000 e 10.000 transações;
- 30, 365, 1.825 e 3.650 snapshots;
- universos com 100, 500 e 1.000 ativos;
- cache quente, frio e stale;
- APIs externas normais, lentas e indisponíveis;
- uma e duas instâncias do backend.

### Métricas obrigatórias

- rotas: p50, p95, p99, throughput e taxa de erro;
- MongoDB: `executionTimeMillis`, `totalDocsExamined`, `totalKeysExamined` e
  presença de `SORT`;
- pipeline: duração total e por classe/etapa;
- Node: event-loop delay, CPU, RSS, heap e GC;
- frontend: FCP, LCP, INP, transferência inicial e commits React;
- integrações: chamadas, duração, timeout, fallback e cache hit rate;
- jobs: duração, atraso, overlap e aquisição de lease.

Não definir meta absoluta em milissegundos antes da baseline no ambiente real.
Usar primeiro metas relativas e orçamentos acordados após a Fase 0.

---

## 8. Decisão final

1. **Refatoração necessária:** estrutural localizada, sem reescrita total.
2. **Maior gargalo provável:** I/O redundante e leituras dependentes de queries
   crescentes ou serviços externos.
3. **Maior risco:** consistência financeira e lifecycle de transações.
4. **Cinco primeiras mudanças:** matemática segura, transações, falhas do
   pipeline, remoção do log parcial de segredo e baseline/índices.
5. **Não vale o custo agora:** substituir MongoDB ou React Query, adotar GraphQL
   globalmente, reescrever as engines ou virtualizar listas pequenas.

Resultado realista:

- Fase 0 cria evidência, mas não promete ganho;
- Fase 1 reduz risco financeiro e operacional;
- Fase 2 pode eliminar 30–60% do tráfego redundante nos eventos afetados;
- Fase 3 pode gerar ganho alto em históricos extensos, sujeito ao benchmark;
- Fase 4 deve gerar melhoria moderada em bundle, renders e percepção;
- Fase 5 aumenta previsibilidade e capacidade de escala.

---

## 9. Arquivos prováveis da implementação futura

- `server/controllers/walletController.js`
- `server/services/financialService.js`
- `server/services/portfolioImportService.js`
- `server/utils/dbTransaction.js`
- `server/models/AssetTransaction.js`
- `server/services/aiResearchService.js`
- `server/services/schedulerService.js`
- `server/services/marketDataService.js`
- `server/services/engines/scoringEngine.js`
- `server/services/engines/portfolioEngine.js`
- `server/services/engines/signalEngine.js`
- `server/app.js`
- `server/index.js`
- `client/src/App.tsx`
- `client/src/index.tsx`
- `client/src/contexts/AuthContext.tsx`
- `client/src/contexts/WalletContext.tsx`
- `client/src/pages/Research.tsx`
- testes correspondentes a cada módulo

---

## 10. Prompt recomendado para iniciar a Fase 1

A Fase 0 está implementada. O ciclo seguinte trata somente correção e estabilidade.

```text
Leia integralmente AGENTS.md e o documento
AUDITORIA-ESTRUTURAL-PERFORMANCE-2026-09-01.md.

Execute somente a Fase 1 — Correções críticas, em mudanças pequenas e auditáveis:

1. Substituir operações monetárias diretas identificadas em walletController,
   portfolioImportService e schedulerService por safeQuantity, safeMult,
   safeAdd/Sub/Div e safeCurrency de mathUtils.js, conforme a natureza do valor.
2. Corrigir runTransaction em server/utils/dbTransaction.js para que um timeout
   não encerre a sessão enquanto fn(session) continua executando. Preservar erro
   original, rollback e atomicidade.
3. Fazer aiResearchService distinguir universo realmente vazio de falha do
   cálculo. Uma classe que lançou erro não pode ser persistida como ranking vazio
   nem produzir batch COMPLETED/COMPLETED_WITH_WARNINGS enganoso.
4. Remover o prefixo da API_KEY dos logs; registrar apenas configurada/não configurada.
5. Inicializar o scheduler somente depois da conexão Mongo e do servidor estarem
   prontos, preservando os guards existentes e os modos EXTERNAL_SCHEDULER.

Restrições:
- não alterar threshold global 70, scores, pesos, ordenação, perfis, retenção,
  publicação, planos ou feature gating;
- não executar publicação, sync, migração ou escrita em produção;
- não iniciar a Fase 2;
- preservar ES Modules e matemática financeira segura;
- não remover a instrumentação da Fase 0.

Antes de editar, confirme as evidências atuais, arquivos, risco e rollback de
cada correção. Implemente uma correção por vez e acrescente testes de regressão,
incluindo decimais adversos, timeout com operação ainda pendente, falha parcial
de uma classe e boot com Mongo lento.

Ao final, execute ESLint, TypeScript, todos os testes do backend e frontend e o
build de produção. Entregue antes/depois, resultados, riscos residuais, arquivos
alterados e o próximo prompt para iniciar a Fase 2.
```
