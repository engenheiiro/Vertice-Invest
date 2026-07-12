# BACKLOG — Vértice Invest (só o que falta)

> **Fonte única de verdade do trabalho pendente.** Itens já entregues foram
> removidos — o histórico do que foi feito vive no git e no [`CHANGELOG.md`](../CHANGELOG.md).
> Atualizado em: **2026-07-11**.

Antes de pegar um item, confirme que ele ainda está pendente (o CHANGELOG e o
`git log` são a referência do que já shipou).

---

## Como ler (legenda)

**Complexidade** — quanto trabalho dá:

- `[BAIXA]`  algumas horas, poucos arquivos, baixo risco.
- `[MEDIA]`  de meio dia a 1 dia, exige cuidado/teste.
- `[ALTA]`   vários dias, mexe em muita coisa ou lógica delicada.

**Qual IA usar** (para gastar token só onde precisa):

- `[SONNET]` tarefa mecânica, com padrão claro (testes seguindo modelo,
  aria-label, dependência, doc, config). A maioria. Padrão.
- `[OPUS]`   lógica complexa, dinheiro/finanças, arquitetura, segurança
  crítica, bug difícil. Só quando errar custa caro.

Regra de bolso: "siga este padrão e repita" → Sonnet. "pense, decida e não
pode errar" → Opus.

---

## 0. Pendências operacionais em PRODUÇÃO (rodar scripts)

Não são código novo — são operações de banco que faltam aplicar em produção.
Sempre `mongodump` + `--dry` antes. **Atenção: dev e prod compartilham o mesmo
cluster/banco Atlas — qualquer migração afeta dados reais na hora.**

- [ ] **Migração de múltiplas carteiras** (rodar 1x, nesta ordem):
  1. `npm run migrate:wallets -- --dry` → conferir → `npm run migrate:wallets`
  2. `npm run repair:orphan-wallets -- --dry` → conferir → `npm run repair:orphan-wallets`
     (só depois de (1) concluir). Ambos idempotentes/resumíveis.
- [ ] **Flag `isReserve`** (renda fixa/reserva):
  `npm run migrate:reserve-flag -- --dry` → `npm run migrate:reserve-flag`
  (marca `CASH → isReserve=true`). Reclassificação dirigida opcional:
  `-- --reclassify=RESERVA-XXX` (ativo fica sem taxa de RF — ajustar pela UI).
- [ ] **`sync` do universo US** para reparar `beta = 1.0` remanescentes (ver
  [ranking_credibility_guards]).
- [ ] **`clean:dividends`** em produção (dedup de proventos por
  `(ticker, ex-date, type)`).
- [ ] **`rebuild:history`** em produção (correção do vazamento de proventos no
  TWRR — dia-ex já não vira prejuízo).

---

## 1. Débito técnico da auditoria (nits F11–F13)

Ver [`../RESULTADO-AUDITORIA.md`](../RESULTADO-AUDITORIA.md). F1–F10 já shiparam
(`c01dbc8`, `34828b5`). Restam:

- [ ] **F11 — RSI de Wilder.** `signalEngine.calculateRSI` usa média simples
  dos primeiros 15 preços em vez da suavização de Wilder. Consistente
  internamente, mas diverge do padrão de mercado. `[MEDIA] [OPUS]`
- [ ] **F12 — remover `confirmPayment` morto.** `POST /subscription/confirm`
  (`subscriptionController.js:249`, rota em `subscriptionRoutes.js:17`) retorna
  `success:true` sem conceder plano. Remover ou marcar claramente como no-op.
  `[BAIXA] [SONNET]`
- [ ] **F13 — merge de `taxLots`.** Ao passar de 500 lotes, colapsa os 100 mais
  antigos em 1 lote médio — distorce a ordem FIFO exata para apuração de IR em
  tickers muito ativos. Elevar limite ou preservar lotes. `[MEDIA] [OPUS]`

---

## 2. Acessibilidade

- [ ] **4.9 — Teste com leitor de tela real.** Passar NVDA/VoiceOver nas telas
  principais e corrigir. `[MEDIA] [OPUS]`

---

## 3. Performance

- [ ] **5.1 — `useCallback`/`React.memo` nos componentes pesados restantes.**
  Os gráficos (AllocationChart, EvolutionChart) já estão memoizados. Falta
  `AddAssetModal.tsx` (re-desenha a cada tecla) e `AssetList.tsx` (re-desenha a
  cada update do pai). `[MEDIA] [OPUS]`

---

## 4. Engines financeiras e funcionalidades

O coração do produto (scoring, carteira, sinais) está robusto e testado — aqui
são **evoluções**, não correções.

- [ ] **7.1 — Novos indicadores no `signalEngine` (MACD, Estocástico).** Hoje só
  RSI. `[ALTA] [OPUS]`
- [ ] **7.4 — Múltiplos timeframes nos sinais.** Hoje o período é fixo (RSI 14,
  janela 60 dias). Analisar diário/semanal. `[ALTA] [OPUS]`
- [ ] **7.10 — Exportar Research em PDF.** O botão "Exportar PDF" existe no
  ResearchViewer sem handler. `pdf-lib` já está no server (certificados da
  Academy; o PDF do relatório de IR — `GET /wallet/tax-report/:year/pdf` — já
  usa). Falta a rota de geração do research + ligar o botão. `[MEDIA] [SONNET]`

---

## 5. DevOps / Infraestrutura

- [ ] **8.6 — Documentar backup do MongoDB.** Procedimento `mongodump`/`restore`
  escrito e testado (o `.gitignore` já ignora as pastas de dump). `[MEDIA] [OPUS]`
- [ ] **8.7 — Plano de recuperação de desastre (DR).** "O que fazer se cair
  tudo", passo a passo. `[MEDIA] [OPUS]`
- [ ] **8.9 — Cache de build no CI.** Hoje só há cache de npm no setup-node;
  falta `actions/cache` de build. `[BAIXA] [SONNET]`

> _8.8 (changelog automático) — **concluído**: scripts `changelog`/`changelog:first`
> + `CHANGELOG.md` gerado._

---

## 6. Observabilidade / Monitoramento

Já há Sentry + logs Winston + correlation ID + `/api/health` + rastreamento de
snapshots diários. Faltam métricas e alertas externos.

- [ ] **9.2 — Monitor de uptime** (UptimeRobot free, avisa por e-mail). `[BAIXA] [SONNET]`
- [ ] **9.3 — Métricas de latência/erro** (Prometheus + Grafana, self-hosted). `[ALTA] [OPUS]`
- [ ] **9.4 — Dashboard de saúde dos dados** (já há rotas admin de diagnóstico;
  montar painel visual). `[MEDIA] [SONNET]`
- [ ] **9.5 — Alertas no Sentry por volume de erro.** `[BAIXA] [SONNET]`
- [ ] **9.6 — Logs de rotas lentas por threshold** (marcar/alertar só requests
  acima de X ms). `[MEDIA] [OPUS]`
- [ ] **9.8 — Métrica de uso por feature/plano** (já há `UsageLog`; falta
  endpoint admin de relatório agregado). `[MEDIA] [SONNET]`
- [ ] **9.9 — Alerta de circuit breaker aberto** (já há `logger.warn`; falta
  alerta outbound quando uma fonte externa é desligada). `[BAIXA] [OPUS]`
- [ ] **9.10 — Status page pública.** `[MEDIA] [SONNET]`

---

## 7. Qualidade de código / TypeScript / Documentação

- [ ] **10.1 — Eliminar `any` no código de produção** (a maioria dos ~174 está
  em testes/mocks; focar em services/contexts/componentes). `[MEDIA] [OPUS]`
- [ ] **10.3 — Error boundary por página** (já há um global; isolar por rota
  para um erro não derrubar o app todo). `[MEDIA] [SONNET]`
- [ ] **10.4 — Rollback de estado em erro de carteira** (hoje não há optimistic
  update nem rollback no `WalletContext`). `[MEDIA] [OPUS]`
- [ ] **10.5 — Retry com backoff nas chamadas de API do frontend** (hoje só
  `retry: 1` no React Query, sem backoff exponencial). `[MEDIA] [SONNET]`
- [ ] **10.6 — Padronizar JSDoc nos serviços-chave** (aiResearchService,
  marketDataService, scoringEngine, signalEngine, schedulerService). `[BAIXA] [SONNET]`
- [ ] **10.10 — TODO/FIXME viram tarefas rastreáveis** (~15 no código). `[BAIXA] [SONNET]`

---

## 8. Roadmap de rankings (referência)

Melhorias de calibração dos rankings/perfis estão detalhadas em
[`analise-rankings-2026-06.txt`](analise-rankings-2026-06.txt) §2.10 (roadmap
priorizado). Vários itens dessa análise já shiparam (guardas de credibilidade,
eixo de governança, backtest por perfil) — reconferir contra o CHANGELOG antes
de pegar. Calibração de magnitudes da Fase 3 (track record) foi deixada
**dormente** até haver profundidade de série (~dez/2026).

---

## Recentemente concluído (para não reabrir)

- **Plano de correções Jul/2026 (A1–C4 + extras):** foto de perfil, privacy
  toggle, Research tabular-nums/abas, BTC em US$, Cofre de Dividendos, cache/SW
  self-host, múltiplas carteiras, flag `isReserve`, Tesouro/`maturityDate`,
  reversão de metas com histerese, carteira pública. Shipou em `162f1c8` +
  `839110a`.
- **Auditoria F1–F10:** gating de research no backend, idempotência de webhook
  (índice único em `gatewayId`), snapshot de RF indexada, batch de cotações,
  rotação de refresh token, limiter de change-password, Swagger fora de prod,
  etc. Shipou em `c01dbc8` + `34828b5`.
- **Botão admin de snapshot forçado:** `POST /wallet/admin/snapshot/force` +
  botão no AdminPainelTab. Concluído.
- **Changelog automático (8.8):** scripts + `CHANGELOG.md`.

---

## Como validar cada onda (ponta a ponta)

1. Backend: `npm run test:server` (ou `test:all`) verde.
2. Frontend: `npm run test:client` verde.
3. Lint/tipos: `npm run lint` e `npm run typecheck` sem erros.
4. App real: `npm run dev` → login → carteira → adicionar ativo → research → logout.
5. CI: abrir PR e confirmar pipeline (lint → typecheck → test → build) verde.
6. A11y/Perf: Lighthouse/axe nas telas principais, comparar antes/depois.

> Tudo usa apenas ferramentas gratuitas/open-source ou tiers gratuitos (Docker,
> Prometheus, Grafana, axe-core, Lighthouse, Sentry free, UptimeRobot). Sem
> soluções pagas quando há equivalente grátis (ex.: nada de Redis).
