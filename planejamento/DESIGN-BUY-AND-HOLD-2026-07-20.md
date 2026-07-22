# Design — Ranking "Buy-and-Hold"

Data: 2026-07-20 — America/Sao_Paulo
Status: **Fase 1 (backend, shadow) implementada e testada** — config + engine + 17 testes verdes + script de auditoria read-only. Nada publica. Fases 2 (consistência plena) e 3 (frontend + publicação) pendentes.
Autor da sessão: assistente, sob decisão do usuário.

> Nome do produto (exibição): **Buy-and-Hold**. Internamente a estratégia recebe uma chave própria (`BUY_AND_HOLD`) **distinta** da estratégia legada `BUY_HOLD` (o ranking de 3 perfis atual), para não colidir nem alterar o que já está publicado. Ver §3.

---

## 1. Motivação

O ranking atual (`STOCK` / `BUY_HOLD`, calibração V3) é um **screen de valor com aplicabilidade setorial**, não um screen de **buy-and-hold seguro (âncora)**. Evidências que motivaram esta frente:

- **BUY/WAIT é relativo ao perfil, não uma medida de segurança.** O perfil Arrojado pesa `entry` (valuation) em 50%; cíclicas baratas cruzam 70 no Arrojado com facilidade. Comparar "BUY do Arrojado" com "WAIT do Defensivo" compara eixos diferentes.
- **O score defensivo é dominado por _estar barato_.** Exemplo real (snapshot 2026-07-20):
  - `ABCB4` (Banco ABC Brasil, mid-cap R$6,1 bi) → **81 Defensivo**, quase todo pelo eixo Entry (98 = P/L 6, P/VP 0,86, DY 10,8%); durabilidade só 50.
  - `PSSA3` (Porto Seguro, large-cap R$35,6 bi, ROE 23,7%, combined ratio 88,7%, qualidade 80) → **~54 Defensivo WAIT**, apenas por estar cara (preço R$55,14 vs alvo R$40,12).
  - Ou seja: **banco mid-cap barato ganha de seguradora líder de qualidade.** Errado para o propósito "âncora".
- **Portão de elegibilidade defensiva tem porta dos fundos:** `setor seguro OU (DY ≥ 6% + P/L ≤ 10)` deixa entrar cíclica/mid-cap barata como "defensiva".
- **Não existe eixo de consistência através do ciclo** (dividendo pago todo ano, estabilidade de lucro, drawdown) — o "resiliente e consistente" pedido.

Caso de referência que o produto precisa acertar:
> "Vale mais comprar um PSSA3 WAIT no Defensivo ou um BRAV3 BUY do Arrojado?"
> Resposta correta: **PSSA3 é âncora (aguarde preço); BRAV3 nem deveria estar na lista de âncora.** BRAV3 (petroleira E&P, ROE 2%, produção -1%, vol 37%, alvo do modelo R$7,37 vs preço R$19,57) não é buy-and-hold seguro sob nenhum critério.

---

## 2. Princípios do produto

1. **Segurança é portão, não score.** Quem não passa no portão de âncora **nunca** aparece como BUY, por mais barato que esteja.
2. **Durabilidade e resiliência mandam; valuation é freio, não motor.** Estar barato nunca _adiciona_ score de âncora; estar caro _subtrai_.
3. **Consistência através do ciclo é eixo de primeira classe** (dividendo, estabilidade de lucro, drawdown).
4. **Ação com semântica clara:** `BUY` = âncora segura **e** com preço justo; `WAIT` = âncora segura, **aguarde preço**. Fora do portão = **ausente**, não WAIT.
5. **Não afrouxar o modelo existente.** Nova estratégia isolada, nasce draft, não publica sem autorização. Threshold 70 e ordenação soberana preservados.

---

## 3. Identidade da estratégia

- Nome de exibição: **Buy-and-Hold**
- `assetClass`: `STOCK`
- `strategy`: `BUY_AND_HOLD` (novo; **distinto** da estratégia legada `BUY_HOLD` de 3 perfis, que permanece intocada)
- `algorithmVersion`: `BH_V1`
- Publicação: nasce como draft (`isRankingPublished=false`), via infraestrutura de `ResearchBatch`/`PublishedResearchPointer` já existente. Sem ativar ponteiro sem autorização.

---

## 4. Portão de âncora (hard gate, antes do score)

Candidato precisa passar em **TODOS**. Falhou qualquer um → **ausente** da lista (registrado na Auditoria Completa com razão).

### 4.1 Setor curado (allowlist de macro-setores)
Elegíveis: `Elétricas` (transmissão / geração contratada), `Saneamento`, `Telecom`, `Seguros` (qualidade), `Bancos` (somente tier-1), `Consumo Básico`/`Utilities`.
- Fonte de setor: `sectorOverrides.js` + `sectorTaxonomy.js`.
- Explicitamente **fora**: Petróleo/E&P, Construção Civil, Mineração/Siderurgia, Agro, Varejo discricionário, Aéreas, Educação, Tech de crescimento, e afins cíclicos.

### 4.2 Allowlist / denylist por ticker (curadoria fina, editável via configService)
- `allowTickers`: nomes explicitamente aprovados como buy-and-hold mesmo em setor limítrofe.
- `denyTickers`: nomes explicitamente barrados (governança, controle, histórico ruim) mesmo que passem no quant. Ex.: candidatos com controle estatal problemático (ver eixo governança).

### 4.3 Filtros quantitativos
| Filtro | Regra default (tunável) |
|---|---|
| Market cap | ≥ R$ 10 bi |
| Beta | ≤ 1,0 |
| Liquidez média | ≥ R$ 10 M/dia |
| Alavancagem (operacional) | netDebt/EBITDA ≤ 3,0 |
| Capital (banco) | capitalRatio ≥ 12% e tier-1 |
| Solvência (seguradora) | solvencyRatio ≥ 130% e combinedRatio ≤ 100% |
| ROE através do ciclo | ≥ 10% (média disponível) |
| Track record de dividendo | pago em **todos** os últimos N anos (default N=5) |

- **Matar a porta dos fundos:** elegibilidade exige (4.1 ∧ 4.3), sem atalho por DY/PL.
- **Track record insuficiente (história rasa):** não auto-aprova nem auto-reprova; marca `dividendStreakVerified=false` e aplica teto de confiança (ver §6). Depende de `AssetHistory` (Fase 3 track record).

> Efeito no caso real: `ABCB4` (mid-cap R$6,1 bi, tier-1=false) **falha** o portão (cap < 10 bi e não tier-1) → sai da lista de âncora. Exatamente o resultado desejado.

---

## 5. Eixos de score (só para quem passa no portão)

Escala 0–100 cada. Reusar helpers `higherBetter`/`lowerBetter`/`averageObserved` do `stockSectorAxisEngine.js` e os arquétipos setoriais existentes.

### 5.1 Durability (qualidade e persistência do negócio)
- Nível e estabilidade de ROE, qualidade de margem, bônus por receita regulada/contratada, moat proxy (share, escala).
- Por arquétipo: banco usa `roeTtm`/`operatingCostRatio`; seguradora usa `combinedRatio`/`recurringEarningsGrowth`; operacional usa `structural.quality`.

### 5.2 Resilience (resiliência financeira + risco de controle)
- Alavancagem/capital, beta/volatilidade, tipo de controle (penalidade estatal — ver memória `governance-axis`).

### 5.3 Consistency (através do ciclo) — NOVO
- Streak de dividendo pago, volatilidade de ROE/EPS, drawdown máximo histórico, positividade de FCF.
- Alimentado por `AssetHistory`/série temporal da Fase 3. **Onde a série é rasa → confiança reduzida, valor não fabricado.**

### 5.4 Entry (valuation) — **freio, não peso positivo**
- Dentro do valor justo → penalidade 0.
- Caro → penalidade graduada (ex.: preço > alvo·(1+tol) reduz o composto).
- **Nunca adiciona pontos.**

### 5.5 Composição
```
composite = 0.45*durability + 0.30*resilience + 0.25*consistency
final     = clamp( composite - entryPenalty , 0, confidenceCap )
```
- **Sem blend com baseline legado** (o 80/20 reintroduz viés de valuation).
- `confidenceCap`: <60 → 70; 60–79 → 85; ≥80 → 100 (igual convenção vigente).
- **Fase 1** pode subir consistency para peso menor (ex.: dur 0,50 / resil 0,35 / consist 0,15) enquanto `AssetHistory` amadurece; **Fase 2** eleva consistency quando a série tiver profundidade (~dez/2026, ver memória `phase3-track-record`).

---

## 6. Semântica de ação

- Só quem passou no portão entra na lista.
- `BUY`  ⇔ `final ≥ 70` **e** entry não-caro (`entryPenalty` abaixo de limiar).
- `WAIT` ⇔ passou no portão mas `final < 70` **ou** caro.
- Fora do portão ⇒ **ausente** (só na Auditoria Completa admin, com razão).

Efeito nos casos de referência:
| Ticker | Portão | Resultado esperado |
|---|---|---|
| `PSSA3` | passa (seguradora qualidade, large, beta 0,73) | composite alto, **WAIT** por estar cara ("aguarde preço") |
| `BRAV3` | **falha** (setor Petróleo) | **ausente** da lista de âncora |
| `ABCB4` | **falha** (mid-cap < 10 bi, não tier-1) | **ausente** (ou WAIT-unverified se afrouxarmos cap) |
| `TAEE11` | passa (transmissão contratada) | candidato natural a **BUY** se preço justo |
| `CMIG4` | avaliar (elétrica, mas controle estatal) | testa o eixo governança + denylist |

---

## 7. Wiring (arquivos)

Novos:
- `server/config/buyAndHold.js` — allowlist/denylist de setor e ticker + thresholds (estrutura editável via `configService`).
- `server/services/engines/buyAndHoldEngine.js` — portão + eixos + ação. Reusa helpers do `stockSectorAxisEngine.js`.
- `server/tests/buy_and_hold_gate.spec.js`, `server/tests/buy_and_hold_engine.spec.js` — fixtures PSSA3/BRAV3/ABCB4/TAEE11/CMIG4 com resultados esperados de §6.
- `server/scripts/auditBuyAndHoldShadowRanking.js` — auditoria read-only (espelho do `auditStockCalibrationShadowRanking.js`).

Alterados (aditivo, sem tocar no fluxo legado `BUY_HOLD`):
- `server/services/aiResearchService.js` — pass adicional gerando `MarketAnalysis` `strategy=BUY_AND_HOLD` como draft.
- `server/controllers/researchController.js` + `server/routes/researchRoutes.js` — leitura pública `GET /research/latest?strategy=BUY_AND_HOLD`. Auditoria admin reusa `/research/details/:id`.
- Frontend (fase posterior): aba/seção "Buy-and-Hold" em `client/src/pages/Research.tsx` + `TopPicksCard`.

---

## 8. Faseamento

- **Fase 1 (backend, shadow):** config + `buyAndHoldEngine` (portão + durability/resilience/entry-penalty) + testes + script de auditoria read-only. Consistency com peso baixo/plumbing. Nada publica.
- **Fase 2:** eixo Consistency com peso pleno quando `AssetHistory` tiver profundidade; calibrar por backtest prospectivo (ver memória `backtest-profiles-classes` / `phase3-track-record`).
- **Fase 3 (admin-only, em andamento):** visualização shadow em Operações (AdminPanel), cálculo on-demand read-only. **NÃO** gera via sync:prod, **NÃO** persiste MarketAnalysis, **NÃO** publica. Endpoint `GET /research/buy-and-hold/shadow` (researchHeavyLimiter + requireAdmin) → `buyAndHoldService.generateBuyAndHoldRanking()`. Card `BuyAndHoldShadowCard` na aba Operações. Publicação versionada para usuário final = etapa futura sob autorização explícita.

### Nota sobre sync:prod
O `sync:prod` (→ `aiResearchService.runBatchAnalysis`) **não** gera o ranking Buy-and-Hold — ele é intencionalmente desacoplado do pipeline de publicação. A aba Operações calcula on-demand a partir dos dados que o sync já atualizou (MarketAsset/AssetHistory/macro). Para gerar/persistir no sync (com histórico e delta), é uma decisão futura.

---

## 9. Guardas (invioláveis reafirmados)

- Threshold 70 e ordenação soberana (`b.score - a.score`) mantidos.
- Não reintroduzir penalidade de concentração pós-draft que reescreva fundamento de STOCK.
- Não salvar `NaN` no Mongo (usar `normalizeStockScoringOutputForPersistence`).
- Não publicar draft sem revisão. Não ativar ponteiro/flag manualmente no Mongo.
- Não afrouxar nem mutar o ranking `BUY_HOLD` publicado.

---

## 10. Thresholds default a confirmar com o usuário

Os números do §4.3 são pontos de partida (cap ≥ R$10 bi, beta ≤ 1,0, liquidez ≥ R$10 M, N=5 anos de dividendo, netDebt/EBITDA ≤ 3). Todos tunáveis; confirmar antes de congelar em teste.
