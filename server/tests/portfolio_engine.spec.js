/**
 * T2 — Testes unitários do portfolioEngine.
 * Cobre: penalidade de concentração setorial (pura/determinística) e o cap de
 * cripto no draft competitivo, além de casos de borda (entrada vazia).
 */
import { describe, it, expect } from 'vitest';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

const makeScored = (overrides = {}) => ({
    ticker: 'AAAA3',
    type: 'STOCK',
    sector: 'Bancos',
    score: 80,
    riskProfile: 'DEFENSIVE',
    thesis: 'Top Pick',
    metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
    ...overrides,
});

describe('portfolioEngine.applyConcentrationPenalty', () => {
    it('retorna vazio para portfólio vazio', () => {
        expect(portfolioEngine.applyConcentrationPenalty([])).toEqual([]);
    });

    it('penaliza 3º (-5) e 4º+ (-15) ativos do mesmo macro-setor', () => {
        // 4 ativos mesmo setor, mesmo perfil, score 80.
        const portfolio = ['A3', 'B3', 'C3', 'D3'].map((t) =>
            makeScored({ ticker: t, sector: 'Bancos', score: 80 })
        );

        const result = portfolioEngine.applyConcentrationPenalty(portfolio);

        expect(result[0].score).toBe(80); // 1º — sem penalidade
        expect(result[1].score).toBe(80); // 2º — sem penalidade
        expect(result[2].score).toBe(75); // 3º — -5
        expect(result[3].score).toBe(65); // 4º — -15
        expect(result[2].thesis).toContain('Penalidade');
    });

    it('rebaixa ação para WAIT quando a penalidade derruba o score abaixo de 70', () => {
        // 4 ativos com score 78: o 4º leva -15 → 63 → WAIT.
        const portfolio = ['A3', 'B3', 'C3', 'D3'].map((t) =>
            makeScored({ ticker: t, sector: 'Bancos', score: 78, action: 'BUY' })
        );

        const result = portfolioEngine.applyConcentrationPenalty(portfolio);

        expect(result[3].score).toBe(63);
        expect(result[3].action).toBe('WAIT');
    });

    it('grava a penalidade de concentração no auditLog (categoria Risco, sempre visível)', () => {
        const portfolio = ['A3', 'B3', 'C3'].map((t) =>
            makeScored({ ticker: t, sector: 'Bancos', score: 80 })
        );
        const result = portfolioEngine.applyConcentrationPenalty(portfolio);

        // 1º e 2º não penalizados → sem entrada de penalidade no audit
        expect((result[0].auditLog || []).some((a) => a.factor === 'Penalidade de Concentração')).toBe(false);
        // 3º penalizado (-5) → entrada negativa em categoria universal 'Risco'
        const pen = (result[2].auditLog || []).find((a) => a.factor === 'Penalidade de Concentração');
        expect(pen).toBeTruthy();
        expect(pen.points).toBe(-5);
        expect(pen.type).toBe('penalty');
        expect(pen.category).toBe('Risco');
    });

    it('preserva o auditLog pré-existente ao anexar a penalidade', () => {
        const base = [{ factor: 'Base de Qualidade', points: 0, type: 'base', category: 'Qualidade' }];
        const portfolio = ['A3', 'B3', 'C3', 'D3'].map((t) =>
            makeScored({ ticker: t, sector: 'Bancos', score: 80, auditLog: [...base] })
        );
        const result = portfolioEngine.applyConcentrationPenalty(portfolio);
        const fourth = result[3]; // -15
        expect(fourth.auditLog[0].factor).toBe('Base de Qualidade');
        expect(fourth.auditLog.some((a) => a.factor === 'Penalidade de Concentração' && a.points === -15)).toBe(true);
    });

    it('isola contadores por perfil de risco (não contamina entre perfis)', () => {
        const portfolio = [
            makeScored({ ticker: 'A3', sector: 'Bancos', riskProfile: 'DEFENSIVE', score: 80 }),
            makeScored({ ticker: 'B3', sector: 'Bancos', riskProfile: 'DEFENSIVE', score: 80 }),
            makeScored({ ticker: 'C3', sector: 'Bancos', riskProfile: 'MODERATE', score: 80 }),
        ];

        const result = portfolioEngine.applyConcentrationPenalty(portfolio);
        // O 'C3' é o 1º do seu perfil (MODERATE) → sem penalidade, mesmo sendo o 3º Bancos no total.
        const c3 = result.find((a) => a.ticker === 'C3');
        expect(c3.score).toBe(80);
    });
});

describe('portfolioEngine.performCompetitiveDraft', () => {
    it('retorna vazio para entrada vazia', () => {
        expect(portfolioEngine.performCompetitiveDraft([])).toEqual([]);
    });

    it('respeita o cap de cripto por perfil (máx. 3)', () => {
        // 5 criptos com score alto só no perfil BOLD (isola o ciclo BOLD).
        const cryptos = ['BTC', 'ETH', 'SOL', 'ADA', 'XRP'].map((t) => ({
            ticker: t,
            type: 'CRYPTO',
            sector: 'Cripto',
            scores: { DEFENSIVE: 0, MODERATE: 0, BOLD: 60 },
            metrics: { structural: { quality: 50, valuation: 50, risk: 50 } },
        }));

        const result = portfolioEngine.performCompetitiveDraft(cryptos);
        const draftedCryptos = result.filter((a) => a.type === 'CRYPTO');

        expect(draftedCryptos.length).toBe(3);
        expect(draftedCryptos.every((a) => a.riskProfile === 'BOLD')).toBe(true);
    });

    // Diversificação fina de FII: o cap de concentração do draft é por SEGMENTO
    // (shopping ≠ logística ≠ papel…), não por macro-setor. Antes, todos os FIIs de
    // tijolo colapsavam em REAL_ESTATE e a carteira travava em ~3 nomes.
    const makeFii = (ticker, sector, d) => ({
        ticker, type: 'FII', sector,
        scores: { DEFENSIVE: d, MODERATE: 0, BOLD: 0 },
        metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
    });

    it('FIIs de segmentos distintos NÃO competem pelo mesmo cap (diversifica)', () => {
        // 6 FIIs, todos D=85, segmentos diferentes — todos cabem (cap é por segmento).
        const fiis = [
            makeFii('AAAA11', 'Shoppings', 85),
            makeFii('BBBB11', 'Logística', 85),
            makeFii('CCCC11', 'Papel', 85),
            makeFii('DDDD11', 'Fiagro', 85),
            makeFii('EEEE11', 'Híbrido', 85),
            makeFii('FFFF11', 'Lajes Corporativas', 85),
        ];
        const result = portfolioEngine.performCompetitiveDraft(fiis);
        const def = result.filter(r => r.riskProfile === 'DEFENSIVE');
        expect(def.length).toBe(6); // antes: limitado a 3 (todos viravam REAL_ESTATE)
    });

    it('FIIs do MESMO segmento respeitam o cap de 3 no perfil DEFENSIVE', () => {
        const fiis = ['P1', 'P2', 'P3', 'P4'].map((t, i) => makeFii(`PAP${t}11`, 'Papel', 85 - i));
        const trace = [];
        const result = portfolioEngine.performCompetitiveDraft(fiis, { trace });
        const def = result.filter(r => r.riskProfile === 'DEFENSIVE');
        expect(def.length).toBe(3); // 4º Papel barrado pelo cap do segmento

        // O trace (instrumentação) registra o bloqueio com a chave de concentração fina.
        const blocked = trace.find(e => e.outcome === 'BLOCKED_SECTOR_CAP');
        expect(blocked).toBeTruthy();
        expect(blocked.key).toBe('FII_PAPEL');
    });

    it('marca BUY para score >= 70 e WAIT abaixo disso', () => {
        const assets = [
            {
                ticker: 'BUY3',
                type: 'STOCK',
                sector: 'Bancos',
                scores: { DEFENSIVE: 75, MODERATE: 0, BOLD: 0 },
                metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
            },
            {
                ticker: 'WAIT3',
                type: 'STOCK',
                sector: 'Seguros',
                scores: { DEFENSIVE: 60, MODERATE: 0, BOLD: 0 },
                metrics: { structural: { quality: 50, valuation: 50, risk: 50 } },
            },
        ];

        const result = portfolioEngine.performCompetitiveDraft(assets);
        const buy = result.find((a) => a.ticker === 'BUY3');
        const wait = result.find((a) => a.ticker === 'WAIT3');

        expect(buy.action).toBe('BUY');
        expect(wait.action).toBe('WAIT');
    });
});
