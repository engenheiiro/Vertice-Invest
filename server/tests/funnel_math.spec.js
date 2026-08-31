/**
 * Funil comercial — regras puras.
 *
 * Estes números vão orientar decisão de preço e de canal. O erro caro aqui não
 * é o cálculo estar errado por um centavo: é uma taxa parecer despencar porque
 * o mês ainda não fechou, ou o MRR dar um pico porque a venda anual foi contada
 * inteira no mês da compra. As duas armadilhas têm teste próprio.
 */
import { describe, it, expect } from 'vitest';
import {
    CONVERSION_WINDOW_DAYS,
    DIRECT_SOURCE,
    buildAcquisition,
    buildCohorts,
    buildRetention,
    buildRevenue,
    matureAverages,
    monthKey,
    monthlyValueOf,
    rate,
} from '../utils/funnelMath.js';
import { PLAN_CATALOG } from '../config/subscription.js';

const NOW = new Date('2026-08-30T12:00:00Z');
const dia = (iso) => new Date(`${iso}T10:00:00Z`);

const conta = (id, dataIso, source) => ({ id, createdAt: dia(dataIso), source });

const mapa = (pares) => new Map(pares.map(([id, iso]) => [id, dia(iso)]));

describe('Chave de mês', () => {
    it('usa a mesma régua UTC do resto do sistema', () => {
        expect(monthKey(dia('2026-08-01'))).toBe('2026-08');
        expect(monthKey(new Date('2026-01-31T23:59:00Z'))).toBe('2026-01');
    });
});

describe('Taxa', () => {
    it('devolve null sem base, não zero', () => {
        // "Ninguém se cadastrou" e "ninguém converteu" pedem ações opostas:
        // arrumar distribuição contra arrumar oferta.
        expect(rate(0, 0)).toBeNull();
        expect(rate(0, 10)).toBe(0);
    });
});

describe('Coortes por mês de cadastro', () => {
    const users = [
        conta('a', '2026-05-02'),
        conta('b', '2026-05-20'),
        conta('c', '2026-06-10'),
        conta('d', '2026-08-25'),
    ];

    it('separa ativação de cadastro', () => {
        // Toda conta nasce com uma carteira vazia: o que separa é lançar ativo.
        const cohorts = buildCohorts({
            users,
            firstAssetByUser: mapa([['a', '2026-05-03']]),
            firstPaidByUser: new Map(),
            now: NOW,
        });

        const maio = cohorts.find((c) => c.monthKey === '2026-05');
        expect(maio.signups).toBe(2);
        expect(maio.activated).toBe(1);
        expect(maio.activationRate).toBe(0.5);
    });

    it('conta como conversão só quem pagou dentro da janela', () => {
        const cohorts = buildCohorts({
            users,
            firstAssetByUser: new Map(),
            // 'a' pagou no dia seguinte; 'b' pagou 3 meses depois.
            firstPaidByUser: mapa([['a', '2026-05-03'], ['b', '2026-08-20']]),
            now: NOW,
        });

        const maio = cohorts.find((c) => c.monthKey === '2026-05');
        expect(maio.paid30d).toBe(1);
        expect(maio.paidEver).toBe(2);
        expect(maio.conversionRate).toBe(0.5);
    });

    it('marca o mês corrente como imaturo', () => {
        // Agosto ainda nem fechou: a coorte não teve 30 dias para converter, e
        // comparar 0% dela com 5% de maio é comparar coisas diferentes.
        const cohorts = buildCohorts({
            users,
            firstAssetByUser: new Map(),
            firstPaidByUser: new Map(),
            now: NOW,
        });

        expect(cohorts.find((c) => c.monthKey === '2026-08').matureFor30d).toBe(false);
        expect(cohorts.find((c) => c.monthKey === '2026-05').matureFor30d).toBe(true);
    });

    it('só considera madura a coorte fechada há mais de 30 dias', () => {
        // Julho fechou em 01/08; em 30/08 são 29 dias — ainda falta um dia para
        // o cadastrado em 31/07 completar a janela.
        const cohorts = buildCohorts({
            users: [conta('x', '2026-07-31')],
            firstAssetByUser: new Map(),
            firstPaidByUser: new Map(),
            now: NOW,
        });

        expect(cohorts[0].matureFor30d).toBe(false);
        expect(CONVERSION_WINDOW_DAYS).toBe(30);
    });

    it('devolve as coortes em ordem cronológica', () => {
        const cohorts = buildCohorts({ users, firstAssetByUser: new Map(), firstPaidByUser: new Map(), now: NOW });
        expect(cohorts.map((c) => c.monthKey)).toEqual(['2026-05', '2026-06', '2026-08']);
    });
});

describe('Média das coortes', () => {
    const cohorts = buildCohorts({
        users: [conta('a', '2026-05-02'), conta('b', '2026-06-02'), conta('c', '2026-08-25')],
        firstAssetByUser: mapa([['a', '2026-05-03'], ['b', '2026-06-03']]),
        firstPaidByUser: mapa([['a', '2026-05-04']]),
        now: NOW,
    });

    it('ignora as coortes imaturas', () => {
        const media = matureAverages(cohorts);

        expect(media.cohorts).toBe(2);
        expect(media.signups).toBe(2);          // agosto ficou de fora
        expect(media.activationRate).toBe(1);
        expect(media.conversionRate).toBe(0.5);
    });

    it('devolve null quando nenhuma coorte fechou ainda', () => {
        const recem = buildCohorts({
            users: [conta('z', '2026-08-25')],
            firstAssetByUser: new Map(),
            firstPaidByUser: new Map(),
            now: NOW,
        });

        expect(matureAverages(recem).conversionRate).toBeNull();
    });
});

describe('Receita recorrente', () => {
    it('divide o anual por 12 em vez de contá-lo inteiro', () => {
        // Contar R$ 598,80 no mês da compra criaria um pico e 11 meses de deserto.
        expect(monthlyValueOf('PRO', 'ANNUAL')).toBeCloseTo(PLAN_CATALOG.PRO.annual / 12, 6);
        expect(monthlyValueOf('PRO', 'MONTHLY')).toBe(PLAN_CATALOG.PRO.monthly);
    });

    it('não quebra com plano desconhecido', () => {
        expect(monthlyValueOf('GUEST')).toBe(0);
        expect(monthlyValueOf(undefined)).toBe(0);
    });

    it('soma MRR e ARPU por plano', () => {
        const receita = buildRevenue([
            { plan: 'PRO', billingCycle: 'MONTHLY' },
            { plan: 'PRO', billingCycle: 'ANNUAL' },
            { plan: 'ESSENTIAL', billingCycle: 'MONTHLY' },
        ]);

        const esperado = PLAN_CATALOG.PRO.monthly + PLAN_CATALOG.PRO.annual / 12 + PLAN_CATALOG.ESSENTIAL.monthly;
        expect(receita.subscribers).toBe(3);
        expect(receita.mrr).toBeCloseTo(esperado, 2);
        expect(receita.byPlan.PRO.subscribers).toBe(2);
        expect(receita.arpu).toBeCloseTo(esperado / 3, 2);
    });

    it('sem assinante, ARPU é null e não divisão por zero', () => {
        const vazio = buildRevenue([]);
        expect(vazio.mrr).toBe(0);
        expect(vazio.arpu).toBeNull();
    });
});

describe('Retenção', () => {
    it('mede churn contra quem chegou ao vencimento, não contra a base toda', () => {
        // 2 saíram, 8 renovaram: 20% de churn sobre os 10 que venceram — e não
        // 2/200 sobre uma base cheia de gente que nem chegou perto de vencer.
        const r = buildRetention({ lost: 2, renewed: 8, activeNow: 200 });

        expect(r.dueInWindow).toBe(10);
        expect(r.churnRate).toBe(0.2);
        expect(r.significant).toBe(true);
    });

    it('marca base pequena como não confiável', () => {
        const r = buildRetention({ lost: 1, renewed: 2, activeNow: 5 });

        expect(r.churnRate).toBeCloseTo(1 / 3, 6);
        expect(r.significant).toBe(false);
    });

    it('sem vencimento na janela não inventa churn zero', () => {
        expect(buildRetention({ lost: 0, renewed: 0, activeNow: 3 }).churnRate).toBeNull();
    });
});

describe('Origem da conta', () => {
    it('agrupa quem chegou sem UTM como direto', () => {
        // O orgânico é o maior balde no começo; descartá-lo faria os poucos
        // cliques de campanha parecerem o funil inteiro.
        const linhas = buildAcquisition({
            users: [conta('a', '2026-05-01', 'youtube'), conta('b', '2026-05-02'), conta('c', '2026-05-03', '  ')],
            firstAssetByUser: new Map(),
            firstPaidByUser: new Map(),
        });

        expect(linhas.find((l) => l.source === DIRECT_SOURCE).signups).toBe(2);
        expect(linhas.find((l) => l.source === 'youtube').signups).toBe(1);
    });

    it('ordena pela origem que mais traz cadastro', () => {
        const linhas = buildAcquisition({
            users: [
                conta('a', '2026-05-01', 'youtube'),
                conta('b', '2026-05-02', 'youtube'),
                conta('c', '2026-05-03', 'google'),
            ],
            firstAssetByUser: mapa([['a', '2026-05-02']]),
            firstPaidByUser: mapa([['a', '2026-05-05']]),
        });

        expect(linhas[0].source).toBe('youtube');
        expect(linhas[0].conversionRate).toBe(0.5);
        expect(linhas[0].activationRate).toBe(0.5);
    });

    it('normaliza maiúsculas para não partir a mesma origem em duas linhas', () => {
        const linhas = buildAcquisition({
            users: [conta('a', '2026-05-01', 'YouTube'), conta('b', '2026-05-02', 'youtube')],
            firstAssetByUser: new Map(),
            firstPaidByUser: new Map(),
        });

        expect(linhas).toHaveLength(1);
        expect(linhas[0].signups).toBe(2);
    });
});
