/**
 * Retenção de ASSENTO do ranking semanal (`BUY_HOLD`) — utils/weeklyRetention.js.
 *
 * O teste que importa mais que todos os outros é o primeiro: um incumbente
 * retido com score abaixo de 70 FICA na lista e sai rotulado AGUARDAR. É ele que
 * protege `score >= 70 ⇔ COMPRAR` de ser flexibilizado por engano no dia em que
 * alguém copiar o padrão da lista âncora (onde um BUY com 65 é legítimo).
 */
import { describe, it, expect } from 'vitest';
import {
  applyWeeklyRetention,
  applyBrasil10Retention,
  RETENTION_OUTCOMES,
} from '../utils/weeklyRetention.js';
import { validateRankingContract, finalizeRanking } from '../utils/rankingContract.js';
import { WEEKLY_HYSTERESIS, weeklyRetentionBudget, isWeeklyRetentionEnabled } from '../config/weeklyHysteresis.js';

const HOLD = WEEKLY_HYSTERESIS.holdScore; // 62

/** Ativo processado (entrada do universo), com os três scores de perfil. */
const asset = (ticker, { def = 50, mod = 50, bold = 50, sector = 'Bancos', type = 'STOCK', eligible = true } = {}) => ({
  ticker,
  name: ticker,
  type,
  sector,
  scores: { DEFENSIVE: def, MODERATE: mod, BOLD: bold },
  isDefensiveEligible: eligible,
  metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
  auditLog: [],
});

/** Item de ranking já draftado (o que o draft entrega ao passo de retenção). */
const seat = (ticker, score, riskProfile = 'DEFENSIVE', extra = {}) => ({
  ticker,
  name: ticker,
  type: extra.type || 'STOCK',
  sector: extra.sector || 'Bancos',
  score,
  riskProfile,
  action: score >= 70 ? 'BUY' : 'WAIT',
  tier: 'GOLD',
  metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
  ...extra,
});

const published = items => items.map((item, idx) => ({ ...item, position: idx + 1 }));

/**
 * Monta o par (current, previous) de uma apuração:
 *  - `keep`    assentos que também estavam na publicação anterior → INCUMBENTES,
 *              e por isso nunca deslocáveis;
 *  - `fresh`   recém-chegados desta apuração → não-incumbentes, deslocáveis;
 *  - `missing` incumbentes que sumiram da lista → os candidatos à retenção.
 * O teto de retenções é 30% de `keep + fresh`, então o tamanho do perfil importa:
 * 4 assentos dão 1 retenção, 10 dão 3.
 */
const scenario = ({ keep = [], fresh = [], missing = [] }) => ({
  current: [...keep, ...fresh],
  previous: published([...keep, ...missing]),
});

/** N assentos recém-chegados, cada um no seu balde, do maior score para o menor. */
const fresh = (n, profile, startScore) => Array.from({ length: n }, (_, i) => (
  seat(`NOVO${profile[0]}${i}3`, startScore - i, profile, { sector: `Setor ${i}` })
));

describe('config — teto de retenções', () => {
  it('30% dos assentos, sempre para baixo: 9 de 30, 3 de 10', () => {
    expect(weeklyRetentionBudget(30)).toBe(9);
    expect(weeklyRetentionBudget(10)).toBe(3);
    expect(weeklyRetentionBudget(0)).toBe(0);
  });

  it('liga só nas três classes de giro dominado por assento', () => {
    expect(isWeeklyRetentionEnabled('BRASIL_10', 'BUY_HOLD')).toBe(true);
    expect(isWeeklyRetentionEnabled('STOCK', 'BUY_HOLD')).toBe(true);
    expect(isWeeklyRetentionEnabled('FII', 'BUY_HOLD')).toBe(true);
    expect(isWeeklyRetentionEnabled('STOCK_US', 'BUY_HOLD')).toBe(false);
    expect(isWeeklyRetentionEnabled('CRYPTO', 'BUY_HOLD')).toBe(false);
    expect(isWeeklyRetentionEnabled('ETF', 'BUY_HOLD')).toBe(false);
    expect(isWeeklyRetentionEnabled('REIT', 'BUY_HOLD')).toBe(false);
  });

  it('não liga fora do semanal — a lista âncora tem histerese própria', () => {
    // O que separava a retenção do semanal da lista âncora era uma convenção não
    // escrita ("calculateRanking só é chamado com BUY_HOLD"). Agora é um guard.
    expect(isWeeklyRetentionEnabled('STOCK', 'BUY_AND_HOLD')).toBe(false);
    expect(isWeeklyRetentionEnabled('FII', 'BUY_AND_HOLD')).toBe(false);
    expect(isWeeklyRetentionEnabled('BRASIL_10', 'BUY_AND_HOLD')).toBe(false);
  });

  it('sem estratégia, fail-closed: quem esquecer de passá-la não retém nada', () => {
    expect(isWeeklyRetentionEnabled('STOCK')).toBe(false);
    expect(isWeeklyRetentionEnabled('BRASIL_10', undefined)).toBe(false);
  });

  it('a retenção está agindo (shadow desligado desde 23/08/2026)', () => {
    expect(WEEKLY_HYSTERESIS.shadow).toBe(false);
  });
});

describe('A REGRA INVIOLÁVEL — a histerese age no assento, nunca na ação', () => {
  it('incumbente com 65 fica na lista e sai rotulado AGUARDAR', () => {
    const { current, previous } = scenario({
      keep: [
        seat('INCA3', 85, 'DEFENSIVE', { sector: 'Energia Elétrica' }),
        seat('INCB3', 80, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('INCC3', 75, 'DEFENSIVE', { sector: 'Varejo' }),
      ],
      // O assento deslocável está ABAIXO do limiar de propósito: trocar um
      // COMPRAR por um AGUARDAR é o que a guarda da catraca recusa, e não é
      // disso que este teste trata.
      fresh: [seat('NOVO3', 66, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('INCUM3', 74)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('INCUM3', { def: 65, mod: 40, bold: 30 })],
    });

    const kept = result.ranking.find(i => i.ticker === 'INCUM3');
    expect(kept).toBeDefined();
    expect(kept.score).toBe(65);
    expect(kept.action).toBe('WAIT'); // ← o coração do card
    expect(result.retained).toHaveLength(1);
    expect(result.retained[0].action).toBe('WAIT');
    expect(result.ranking).toHaveLength(4); // o número de assentos não muda
  });

  it('nunca produz COMPRAR com score < 70, nem depois do finalizeRanking', () => {
    const { current, previous } = scenario({
      keep: Array.from({ length: 7 }, (_, i) => seat(`K${i}3`, 90 - i, 'DEFENSIVE', { sector: `Setor ${i}` })),
      fresh: fresh(3, 'DEFENSIVE', 66),
      missing: [seat('A3', 80), seat('B3', 79)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [
        asset('A3', { def: 69, mod: 30, bold: 30, sector: 'Varejo' }),
        asset('B3', { def: 63, mod: 30, bold: 30, sector: 'Saúde' }),
      ],
    });
    expect(result.retained.map(r => r.ticker)).toEqual(['A3', 'B3']);

    const finalized = finalizeRanking(result.ranking, null, { strategy: 'BUY_HOLD' });
    expect(validateRankingContract(finalized, { strategy: 'BUY_HOLD' })).toEqual({ ok: true, errors: [] });
    expect(finalized.filter(i => i.action === 'BUY' && i.score < 70)).toEqual([]);
  });

  it('a retenção não reescreve a ação de quem já estava na lista', () => {
    const current = [seat('X3', 88, 'DEFENSIVE'), seat('Y3', 55, 'DEFENSIVE', { sector: 'Varejo' })];
    const result = applyWeeklyRetention({
      current,
      previous: published(current),
      processedAssets: [],
    });
    expect(result.ranking.map(i => [i.ticker, i.action])).toEqual([['X3', 'BUY'], ['Y3', 'WAIT']]);
    expect(result.retained).toHaveLength(0);
  });
});

describe('quem sai, sai com motivo escrito', () => {
  const base = missing => scenario({
    keep: [
      seat('KA3', 85, 'DEFENSIVE', { sector: 'Energia Elétrica' }),
      seat('KB3', 80, 'DEFENSIVE', { sector: 'Saúde' }),
      seat('KC3', 75, 'DEFENSIVE', { sector: 'Varejo' }),
    ],
    fresh: [seat('NOVO3', 71, 'DEFENSIVE', { sector: 'Tecnologia' })],
    missing,
  });

  it('incumbente com 61 sai (abaixo do piso de 62), com o motivo', () => {
    const { current, previous } = base([seat('CAI3', 75)]);
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('CAI3', { def: 61, mod: 61, bold: 61 })],
    });
    expect(result.retained).toHaveLength(0);
    const exit = result.exits.find(e => e.ticker === 'CAI3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.BELOW_HOLD);
    expect(exit.reason).toBe(`Saiu da lista: score caiu para 61, abaixo do mínimo para manter a vaga (${HOLD})`);
  });

  it('incumbente que sumiu do universo sai dizendo isso', () => {
    const { current, previous } = base([seat('SUMIU3', 88)]);
    const result = applyWeeklyRetention({ current, previous, processedAssets: [] });
    const exit = result.exits.find(e => e.ticker === 'SUMIU3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.LEFT_UNIVERSE);
    expect(exit.reason).toMatch(/não apareceu entre os ativos avaliados/);
  });

  it('quem perde a elegibilidade do único perfil disponível sai mesmo com score 90', () => {
    // `profiles` restrito ao Defensivo é o caso de um ranking mono-perfil: sem
    // Moderado para onde cair, perder o portão é saída de verdade.
    const { current, previous } = base([seat('BARRADO3', 90)]);
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('BARRADO3', { def: 90, mod: 90, bold: 90, eligible: false })],
      options: { profiles: ['DEFENSIVE'] },
    });
    expect(result.retained).toHaveLength(0);
    const exit = result.exits.find(e => e.ticker === 'BARRADO3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.INELIGIBLE);
    expect(exit.reason).toBe('Saiu da lista: deixou de atender aos critérios do perfil Defensivo');
  });
});

describe('identidade entre apurações — ticker, nunca (ticker, perfil)', () => {
  it('quem trocou de Defensivo para Moderado e continua na lista não gera saída nem retenção', () => {
    // O caso ABCB4: o teto de financeiros no Defensivo encheu e ele foi empurrado
    // para o perfil seguinte. Isso é permanência, não saída + entrada.
    const current = [seat('ABCB4', 64, 'MODERATE'), seat('ITUB4', 84, 'DEFENSIVE')];
    const previous = published([seat('ITUB4', 84, 'DEFENSIVE'), seat('ABCB4', 77, 'DEFENSIVE')]);
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('ABCB4', { def: 64, mod: 64 }), asset('ITUB4', { def: 84 })],
    });
    expect(result.exits).toEqual([]);
    expect(result.retained).toEqual([]);
    expect(result.ranking.map(i => i.ticker).sort()).toEqual(['ABCB4', 'ITUB4']);
  });

  it('normaliza .SA e pontuação ao casar o baseline', () => {
    const { current, previous } = scenario({
      keep: [
        seat('KA3', 85, 'DEFENSIVE', { sector: 'Energia Elétrica' }),
        seat('KB3', 80, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('KC3', 75, 'DEFENSIVE', { sector: 'Varejo' }),
      ],
      fresh: [seat('NOVO3', 66, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('PETR4.SA', 75)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('PETR4', { def: 68, mod: 30, bold: 30, sector: 'Petróleo' })],
    });
    expect(result.retained.map(r => r.ticker)).toEqual(['PETR4']);
  });

  it('retenção que muda de perfil aparece como retenção, com o perfil anterior registrado', () => {
    const { current, previous } = scenario({
      keep: [
        seat('KA3', 85, 'MODERATE', { sector: 'Energia Elétrica' }),
        seat('KB3', 80, 'MODERATE', { sector: 'Saúde' }),
        seat('KC3', 75, 'MODERATE', { sector: 'Varejo' }),
      ],
      fresh: [seat('NOVO3', 66, 'MODERATE', { sector: 'Tecnologia' })],
      missing: [seat('MUDOU3', 77, 'DEFENSIVE')],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      // Perdeu o portão Defensivo, mas segue acima do piso no Moderado: o
      // assinante segura o ticker, não o perfil.
      processedAssets: [asset('MUDOU3', { def: 40, mod: 68, bold: 30, eligible: false })],
    });
    expect(result.retained).toHaveLength(1);
    expect(result.retained[0]).toMatchObject({
      ticker: 'MUDOU3', profile: 'MODERATE', previousProfile: 'DEFENSIVE',
    });
    expect(result.exits).toEqual([]);
  });
});

describe('quem é deslocado, e quem nunca é', () => {
  it('readmitir desloca o menor score NÃO-incumbente do perfil', () => {
    const { current, previous } = scenario({
      keep: [seat('ALTO3', 90, 'DEFENSIVE', { sector: 'Energia Elétrica' })],
      fresh: [
        seat('MEIO3', 60, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('OUTRO3', 65, 'DEFENSIVE', { sector: 'Varejo' }),
        seat('FRACO3', 45, 'DEFENSIVE', { sector: 'Tecnologia' }),
      ],
      missing: [seat('VOLTA3', 80)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('VOLTA3', { def: 70, mod: 30, bold: 30 })],
    });
    expect(result.ranking.map(i => i.ticker).sort()).toEqual(['ALTO3', 'MEIO3', 'OUTRO3', 'VOLTA3']);
    expect(result.retained[0].displaced).toEqual({ ticker: 'FRACO3', score: 45 });
  });

  it('nunca desloca outro incumbente — se todos os assentos são de incumbentes, ninguém entra', () => {
    const { current, previous } = scenario({
      keep: [
        seat('I1', 80, 'DEFENSIVE', { sector: 'Energia Elétrica' }),
        seat('I2', 40, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('I3', 70, 'DEFENSIVE', { sector: 'Varejo' }),
        seat('I4', 65, 'DEFENSIVE', { sector: 'Tecnologia' }),
      ],
      missing: [seat('FORA3', 75)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('FORA3', { def: 75, mod: 30, bold: 30 })],
    });
    expect(result.retained).toHaveLength(0);
    expect(result.ranking.map(i => i.ticker).sort()).toEqual(['I1', 'I2', 'I3', 'I4']);
    const exit = result.exits.find(e => e.ticker === 'FORA3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT);
    expect(exit.reason).toMatch(/não havia vaga no perfil Defensivo sem tirar outro ativo que já estava na lista/);
  });

  it('quando o teto morde, quem fica é o incumbente mais forte', () => {
    // 10 assentos → teto 3. Quatro candidatos elegíveis; entram os três maiores.
    const { current, previous } = scenario({
      keep: Array.from({ length: 6 }, (_, i) => seat(`K${i}3`, 90 - i, 'DEFENSIVE', { sector: `Setor ${i}` })),
      fresh: fresh(4, 'DEFENSIVE', 69),
      missing: [seat('C90', 90), seat('C80', 80), seat('C70', 70), seat('C65', 65)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [
        asset('C65', { def: 65, sector: 'Bancos' }),
        asset('C90', { def: 68, sector: 'Petróleo' }),
        asset('C70', { def: 66, sector: 'Mineração' }),
        asset('C80', { def: 67, sector: 'Seguros' }),
      ],
    });
    expect(result.counts.maxRetentions).toBe(3);
    expect(result.counts.budgetExhausted).toBe(true);
    expect(result.retained.map(r => r.ticker)).toEqual(['C90', 'C80', 'C70']);
    const exit = result.exits.find(e => e.ticker === 'C65');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.BUDGET_EXHAUSTED);
    expect(exit.reason).toBe('Saiu da lista: nesta apuração outros ativos de score maior ficaram à frente para manter a vaga');
    expect(result.ranking).toHaveLength(10); // o número de assentos não muda
  });
});

describe('a retenção respeita o balde de concentração', () => {
  it('não readmite acima do teto do balde, e diz qual balde barrou', () => {
    // Três bancos já sentados no Defensivo (teto do balde = 3) e a vítima está em
    // outro balde: readmitir um 4º banco montaria a concentração que o próprio
    // draft recusaria montar.
    const { current, previous } = scenario({
      keep: [
        seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B3', 76, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('K1', 50, 'DEFENSIVE', { sector: 'Saúde' }),
      ],
      fresh: [seat('FRESCO3', 40, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('B4', 74, 'DEFENSIVE', { sector: 'Bancos' })],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('B4', { def: 70, mod: 30, bold: 30, sector: 'Bancos' })],
    });
    expect(result.retained).toHaveLength(0);
    const exit = result.exits.find(e => e.ticker === 'B4');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.SECTOR_CAP);
    expect(exit.reason).toMatch(/o perfil Defensivo já está no limite de ativos de /);
  });

  it('a saída da vítima do MESMO balde é o que libera o espaço', () => {
    const { current, previous } = scenario({
      keep: [
        seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('K1', 60, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('K2', 55, 'DEFENSIVE', { sector: 'Varejo' }),
      ],
      fresh: [seat('B3', 41, 'DEFENSIVE', { sector: 'Bancos' })],
      missing: [seat('B4', 74, 'DEFENSIVE', { sector: 'Bancos' })],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('B4', { def: 70, mod: 30, bold: 30, sector: 'Bancos' })],
    });
    expect(result.retained.map(r => r.ticker)).toEqual(['B4']);
    expect(result.retained[0].displaced.ticker).toBe('B3');
  });

  it('o readmitido paga a mesma penalidade de concentração que o draft cobraria', () => {
    // 3º banco do balde → -5 pela régua única de utils/concentrationPenalty.js.
    // Sem isso, um retido com 71 publicaria COMPRAR enquanto o 3º banco sorteado
    // pelo draft publicaria 66/AGUARDAR: mesma lista, duas réguas.
    const { current, previous } = scenario({
      keep: [
        seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('K1', 60, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('K2', 55, 'DEFENSIVE', { sector: 'Varejo' }),
      ],
      fresh: [seat('FRESCO3', 30, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('B3', 74, 'DEFENSIVE', { sector: 'Bancos' })],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('B3', { def: 71, mod: 30, bold: 30, sector: 'Bancos' })],
    });
    expect(result.retained[0]).toMatchObject({ rawScore: 71, penalty: 5, score: 66, action: 'WAIT' });
  });
});


describe('A CATRACA — a retenção não pode expulsar o estreante que está em COMPRAR', () => {
  /**
   * Regressão NOMINAL do caso medido em 23/08/2026, no Arrojado de ações:
   * COGN3 caiu de 73 para 67, foi retido, e para abrir a vaga deslocou CSED3,
   * que entrava com 72 e COMPRAR. As duas são de Educação — mesmo balde. A regra
   * do 70 ficou intacta (COGN3 publicou AGUARDAR), mas a lista ficou pior pela
   * régua dela mesma: saiu um 72/COMPRAR, entrou um 67/AGUARDAR.
   *
   * Os nove assentos abaixo são os medidos, e SEIS deles pontuam menos que
   * CSED3 — todos protegidos por serem de incumbentes. CSED3 era o único
   * deslocável: foi expulso por ser novo, não por ser pior.
   */
  const arrojadoDeHoje = () => scenario({
    keep: [
      seat('MILS3', 55, 'BOLD', { sector: 'Bens Industriais' }),
      seat('SHUL4', 57, 'BOLD', { sector: 'Máquinas e Equipamentos' }),
      seat('VLID3', 58, 'BOLD', { sector: 'Tecnologia' }),
      seat('FIQE3', 61, 'BOLD', { sector: 'Telecomunicações' }),
      seat('BRSR6', 65, 'BOLD', { sector: 'Bancos' }),
      seat('RECV3', 68, 'BOLD', { sector: 'Petróleo' }),
      seat('AZZA3', 74, 'BOLD', { sector: 'Comércio' }),
      seat('DIRR3', 80, 'BOLD', { sector: 'Construção Civil' }),
      seat('EZTC3', 80, 'BOLD', { sector: 'Exploração de Imóveis' }),
    ],
    fresh: [seat('CSED3', 72, 'BOLD', { sector: 'Educação' })],
    missing: [seat('COGN3', 73, 'BOLD', { sector: 'Educação' })],
  });

  // A régua de ações: o draft decide por cap e não penaliza concentração.
  const comoAcoes = { applyConcentrationPenalty: false };
  const cognCaindo = () => [asset('COGN3', { def: 30, mod: 45, bold: 67, sector: 'Educação' })];

  it('COGN3 (67) não desloca CSED3 (72, COMPRAR) — o caso medido', () => {
    const { current, previous } = arrojadoDeHoje();
    const result = applyWeeklyRetention({
      current, previous, processedAssets: cognCaindo(), options: comoAcoes,
    });

    expect(result.retained).toEqual([]);
    expect(result.ranking.map(i => i.ticker)).toContain('CSED3');
    expect(result.ranking.map(i => i.ticker)).not.toContain('COGN3');
    expect(result.ranking).toHaveLength(10);

    const exit = result.exits.find(e => e.ticker === 'COGN3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.WOULD_DROP_BUY);
    expect(exit.reason).toBe('Saiu da lista: manter a vaga custaria a de CSED3, que está em COMPRAR');
  });

  it('nenhuma troca reduz o número de COMPRAR da lista', () => {
    const { current, previous } = arrojadoDeHoje();
    const antes = current.filter(i => i.score >= 70).length;
    const result = applyWeeklyRetention({
      current, previous, processedAssets: cognCaindo(), options: comoAcoes,
    });
    const depois = finalizeRanking(result.ranking, null, { strategy: 'BUY_HOLD' })
      .filter(i => i.action === 'BUY').length;
    expect(depois).toBe(antes);
  });

  it('a guarda é ESTREITA: um COMPRAR ainda pode deslocar outro COMPRAR melhor', () => {
    // A alternativa descartada ("nunca deslocar assento com score maior") teria
    // barrado esta troca também — e é ela que faz a retenção valer a pena, porque
    // um incumbente sai do draft justamente quando fica abaixo do corte, e aí
    // todo assento não-incumbente pontua acima dele.
    const { current, previous } = scenario({
      keep: [seat('ALTO3', 90, 'DEFENSIVE', { sector: 'Energia Elétrica' })],
      fresh: [
        seat('NOVOA3', 80, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('NOVOB3', 75, 'DEFENSIVE', { sector: 'Varejo' }),
        seat('NOVOC3', 72, 'DEFENSIVE', { sector: 'Tecnologia' }),
      ],
      missing: [seat('VOLTA3', 78)],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('VOLTA3', { def: 71, mod: 30, bold: 30 })],
    });
    expect(result.retained.map(r => r.ticker)).toEqual(['VOLTA3']);
    expect(result.retained[0].displaced).toEqual({ ticker: 'NOVOC3', score: 72 });
  });

  it('a guarda olha o score DEPOIS da penalidade, não o cru', () => {
    // 71 cru vira 66 pela dedução do 3º ativo do balde: é o score publicado que
    // decide se a troca reduz o número de COMPRAR, não o de antes da régua.
    const { current, previous } = scenario({
      keep: [
        seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('K1', 60, 'DEFENSIVE', { sector: 'Saúde' }),
        seat('K2', 55, 'DEFENSIVE', { sector: 'Varejo' }),
      ],
      fresh: [seat('FRESCO3', 71, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('B3', 74, 'DEFENSIVE', { sector: 'Bancos' })],
    });
    const result = applyWeeklyRetention({
      current,
      previous,
      processedAssets: [asset('B3', { def: 71, mod: 30, bold: 30, sector: 'Bancos' })],
    });
    expect(result.retained).toEqual([]);
    expect(result.exits.find(e => e.ticker === 'B3').outcome)
      .toBe(RETENTION_OUTCOMES.WOULD_DROP_BUY);
  });

});

describe('a régua de concentração é a da CLASSE, não a da retenção', () => {
  const bancoNoBalde = () => scenario({
    keep: [
      seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
      seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
      seat('K1', 60, 'DEFENSIVE', { sector: 'Saúde' }),
      seat('K2', 55, 'DEFENSIVE', { sector: 'Varejo' }),
    ],
    fresh: [seat('FRESCO3', 30, 'DEFENSIVE', { sector: 'Tecnologia' })],
    missing: [seat('B3', 74, 'DEFENSIVE', { sector: 'Bancos' })],
  });
  const banco = () => [asset('B3', { def: 71, mod: 30, bold: 30, sector: 'Bancos' })];

  it('readmitido de AÇÕES não paga penalidade — o draft de ações também não cobra', () => {
    // stockCalibrationShadowEngine: "em STOCK o cap decide quem entra;
    // concentração não reescreve a avaliação fundamental depois da seleção".
    // Cobrar -5 aqui viraria 71 em 66 — COMPRAR em AGUARDAR pelo caminho que o
    // motor da classe recusa usar.
    const result = applyWeeklyRetention({
      ...bancoNoBalde(),
      processedAssets: banco(),
      options: { applyConcentrationPenalty: false },
    });
    expect(result.retained[0]).toMatchObject({ rawScore: 71, penalty: 0, score: 71, action: 'BUY' });
    expect(result.retained[0].displaced.ticker).toBe('FRESCO3');
  });

  it('readmitido de FII paga — o draft de FII cobra', () => {
    const result = applyWeeklyRetention({ ...bancoNoBalde(), processedAssets: banco() });
    expect(result.retained[0]).toMatchObject({ rawScore: 71, penalty: 5, score: 66, action: 'WAIT' });
  });

  it('o teto do balde acompanha o da classe: 4 no Defensivo de ações, 3 no default', () => {
    const quatroBancos = () => scenario({
      keep: [
        seat('B1', 80, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B2', 78, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('B3', 76, 'DEFENSIVE', { sector: 'Bancos' }),
        seat('K1', 50, 'DEFENSIVE', { sector: 'Saúde' }),
      ],
      fresh: [seat('FRESCO3', 40, 'DEFENSIVE', { sector: 'Tecnologia' })],
      missing: [seat('B4', 74, 'DEFENSIVE', { sector: 'Bancos' })],
    });
    const processedAssets = [asset('B4', { def: 70, mod: 30, bold: 30, sector: 'Bancos' })];

    const comDefault = applyWeeklyRetention({ ...quatroBancos(), processedAssets });
    expect(comDefault.exits.find(e => e.ticker === 'B4').outcome)
      .toBe(RETENTION_OUTCOMES.SECTOR_CAP);

    const comoAcoes = applyWeeklyRetention({
      ...quatroBancos(),
      processedAssets,
      options: { applyConcentrationPenalty: false, sectorCapByProfile: { DEFENSIVE: 4 } },
    });
    expect(comoAcoes.retained.map(r => r.ticker)).toEqual(['B4']);
    expect(comoAcoes.retained[0].score).toBe(70);
  });
});

describe('bootstrap e classes desligadas', () => {
  it('primeira apuração (sem baseline) não retém ninguém', () => {
    const current = [seat('A3', 80), seat('B3', 70)];
    const result = applyWeeklyRetention({ current, previous: null, processedAssets: [asset('C3', { def: 90 })] });
    expect(result.bootstrap).toBe(true);
    expect(result.retained).toEqual([]);
    expect(result.exits).toEqual([]);
    expect(result.ranking).toBe(current);
  });

  it('ranking vazio passa intacto', () => {
    const result = applyWeeklyRetention({ current: [], previous: published([seat('A3', 80)]), processedAssets: [] });
    expect(result.ranking).toEqual([]);
    expect(result.counts.retained).toBe(0);
  });
});

describe('Brasil 10 — retenção própria, 5 + 5 e perfil único', () => {
  const stockUniverse = [
    asset('S1', { def: 90 }), asset('S2', { def: 88 }), asset('S3', { def: 86 }),
    asset('S4', { def: 84 }), asset('S5', { def: 82 }), asset('SOLD', { def: 70 }),
  ];
  const fiiUniverse = [
    asset('F1', { def: 95, type: 'FII', sector: 'Papel' }),
    asset('F2', { def: 93, type: 'FII', sector: 'Logística' }),
    asset('F3', { def: 91, type: 'FII', sector: 'Shopping' }),
    asset('F4', { def: 89, type: 'FII', sector: 'Renda Urbana' }),
    asset('F5', { def: 87, type: 'FII', sector: 'Fiagro' }),
  ];
  const halves = () => [
    { selected: stockUniverse.slice(0, 5).map(a => seat(a.ticker, a.scores.DEFENSIVE)), universe: stockUniverse },
    {
      selected: fiiUniverse.map(a => seat(a.ticker, a.scores.DEFENSIVE, 'DEFENSIVE', { type: 'FII', sector: a.sector })),
      universe: fiiUniverse,
    },
  ];
  // Baseline com 10 nomes: os 5 FIIs, S1..S4 e SOLD — deixando S5 como o único
  // não-incumbente da metade de ações, e portanto o único deslocável.
  const baseline = () => published([
    ...halves()[1].selected, seat('SOLD', 77), ...halves()[0].selected.slice(0, 4),
  ]);

  it('retém o incumbente acima do piso, sem desbalancear as metades', () => {
    const result = applyBrasil10Retention({ halves: halves(), previous: baseline() });
    expect(result.counts.maxRetentions).toBe(3); // 30% de 10 assentos
    expect(result.retained.map(r => r.ticker)).toEqual(['SOLD']);
    expect(result.halves[0].selected).toHaveLength(5);
    expect(result.halves[1].selected).toHaveLength(5);
    expect(result.halves[0].selected.map(i => i.ticker)).toContain('SOLD');
    expect(result.retained[0].displaced.ticker).toBe('S5');
  });

  it('a lista final continua sendo 5 ações + 5 FIIs, com action derivada do score', () => {
    const result = applyBrasil10Retention({ halves: halves(), previous: baseline() });
    const merged = result.halves.flatMap(h => h.selected);
    expect(merged.filter(i => i.type === 'FII')).toHaveLength(5);
    expect(merged.filter(i => i.type !== 'FII')).toHaveLength(5);
    expect(merged.every(i => i.riskProfile === 'DEFENSIVE')).toBe(true);
    expect(merged.every(i => i.action === (i.score >= 70 ? 'BUY' : 'WAIT'))).toBe(true);
  });

  it('incumbente Defensivo retido abaixo de 70 fica na lista como AGUARDAR', () => {
    const h = halves();
    // O único assento deslocável da metade de ações precisa estar ABAIXO do
    // limiar: com ele em COMPRAR, a guarda da catraca recusaria a troca — que é
    // outro teste, logo adiante.
    h[0].selected = [...h[0].selected.slice(0, 4), seat('FRACO3', 66)];
    h[0].universe = [
      ...stockUniverse.slice(0, 4), asset('FRACO3', { def: 66 }), asset('SEGURA3', { def: 65 }),
    ];
    const previous = published([
      ...h[1].selected, seat('SEGURA3', 74), ...h[0].selected.slice(0, 4),
    ]);
    const result = applyBrasil10Retention({ halves: h, previous });
    const kept = result.halves[0].selected.find(i => i.ticker === 'SEGURA3');
    expect(kept).toBeDefined();
    expect(kept.score).toBe(65);
    expect(kept.action).toBe('WAIT');
  });

  it('no Brasil 10 a guarda vale igual — e a metade continua com cinco', () => {
    const h = halves();
    // S5 (82, COMPRAR) é o único deslocável da metade de ações; o incumbente
    // ausente volta com 65. Trocar um COMPRAR por um AGUARDAR numa lista de dez
    // pesa ainda mais que num perfil de trinta.
    h[0].universe = [...stockUniverse.slice(0, 5), asset('SEGURA3', { def: 65 })];
    const previous = published([
      ...h[1].selected, seat('SEGURA3', 74), ...h[0].selected.slice(0, 4),
    ]);
    const result = applyBrasil10Retention({ halves: h, previous });
    expect(result.retained).toEqual([]);
    expect(result.halves[0].selected).toHaveLength(5);
    expect(result.halves[0].selected.map(i => i.ticker)).toContain('S5');
    const exit = result.exits.find(e => e.ticker === 'SEGURA3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.WOULD_DROP_BUY);
    expect(exit.reason).toBe('Saiu da lista: manter a vaga custaria a de S5, que está em COMPRAR');
  });

  it('perder o gate Defensivo é saída imediata, mesmo com score 90', () => {
    const h = halves();
    h[0].universe = [...stockUniverse.slice(0, 5), asset('BARRADO3', { def: 90, eligible: false })];
    const previous = published([
      ...h[1].selected, seat('BARRADO3', 92), ...h[0].selected.slice(0, 4),
    ]);
    const result = applyBrasil10Retention({ halves: h, previous });
    expect(result.retained).toEqual([]);
    const exit = result.exits.find(e => e.ticker === 'BARRADO3');
    expect(exit.outcome).toBe(RETENTION_OUTCOMES.INELIGIBLE);
    expect(exit.reason).toBe('Saiu da lista: deixou de atender aos critérios do perfil Defensivo');
  });

  it('um FII incumbente nunca disputa assento da metade de ações', () => {
    const h = halves();
    // FIISUMIU só existe no universo de FII, e a metade de FII está inteira de
    // incumbentes: não há vaga deslocável, e ele não invade a metade das ações.
    h[1].universe = [...fiiUniverse, asset('FIISUMIU11', { def: 80, type: 'FII', sector: 'Papel' })];
    const previous = published([
      ...h[1].selected, seat('FIISUMIU11', 82, 'DEFENSIVE', { type: 'FII' }), ...h[0].selected,
    ]);
    const result = applyBrasil10Retention({ halves: h, previous });
    expect(result.retained).toEqual([]);
    expect(result.halves[0].selected.map(i => i.ticker)).not.toContain('FIISUMIU11');
    expect(result.exits.find(e => e.ticker === 'FIISUMIU11').outcome)
      .toBe(RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT);
  });

  it('primeira apuração não retém ninguém', () => {
    const result = applyBrasil10Retention({ halves: halves(), previous: null });
    expect(result.bootstrap).toBe(true);
    expect(result.retained).toEqual([]);
    expect(result.halves.flatMap(h => h.selected)).toHaveLength(10);
  });
});
