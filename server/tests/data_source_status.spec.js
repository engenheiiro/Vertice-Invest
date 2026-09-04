import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildSourceStatuses,
    summarizeSources,
    SOURCE_STATUS,
} from '../utils/dataSourceStatus.js';
import { trackSource, getSourceStats, resetSourceStats, SOURCE_CATALOG } from '../utils/sourceHealth.js';

// O painel de fontes nasceu de uma pergunta que não tinha resposta na tela em
// 04/09/2026: "de onde a gente puxa dado, e o que está funcionando agora?".
// Duas evidências independentes precisam conviver aqui — conectividade (a chamada
// voltou?) e frescor (o dado chegou ao banco?) — porque cada uma, sozinha, mente
// numa direção diferente.

const NOW = new Date('2026-09-04T20:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);

const factsBase = () => ({
    now: NOW,
    macro: {
        currenciesSources: { usd: 'Yahoo', btc: 'Yahoo' },
        currenciesUpdatedAt: hoursAgo(0.2),
        ratesSources: { selic: 'BCB', ipca: 'BCB' },
        ratesUpdatedAt: hoursAgo(0.2),
        updatedAt: hoursAgo(0.1),
    },
    fundamentals: { timestamp: hoursAgo(6) },
    treasury: { latestDate: hoursAgo(20) },
});

const byId = (rows, id) => rows.find((r) => r.id === id);

describe('sourceHealth — registro de chamadas', () => {
    beforeEach(() => resetSourceStats());

    it('conta sucesso, exceção e resposta vazia como desfechos DIFERENTES', async () => {
        await trackSource('coinbase', async () => ({ ok: true }));
        await expect(trackSource('coinbase', async () => { throw new Error('ETIMEDOUT'); })).rejects.toThrow();
        await trackSource('coinbase', async () => null, { isEmpty: (r) => !r });

        const stat = byId(getSourceStats(), 'coinbase');
        expect(stat.ok).toBe(1);
        expect(stat.failures).toBe(2);          // exceção + vazio
        expect(stat.attempts).toBe(3);
        expect(stat.lastError).toBeTruthy();
    });

    // Muita integração nossa captura o próprio erro e devolve null para o chamador
    // seguir com o fallback. Sem `isEmpty`, essas fontes apareceriam 100% saudáveis
    // exatamente quando não estão entregando nada.
    it('resposta vazia sem exceção ainda conta como falha', async () => {
        await trackSource('brapi', async () => ({ data: { results: [] } }), {
            isEmpty: (r) => !(r?.data?.results?.length > 0),
        });
        expect(byId(getSourceStats(), 'brapi').failures).toBe(1);
    });

    it('a exceção é RELANÇADA — o registro observa, não engole', async () => {
        await expect(trackSource('tesouro', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    });

    it('toda fonte do catálogo aparece, mesmo sem nenhuma chamada', () => {
        const ids = getSourceStats().map((s) => s.id);
        expect(ids).toEqual(Object.keys(SOURCE_CATALOG));
        expect(byId(getSourceStats(), 'ibge').attempts).toBe(0);
    });
});

describe('buildSourceStatuses — veredito por fonte', () => {
    beforeEach(() => resetSourceStats());

    const stats = (over) => getSourceStats().map((s) => (s.id === over.id ? { ...s, ...over } : s));

    it('sem chamadas vira DESCONHECIDO, nunca falha', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'ibge').status).toBe(SOURCE_STATUS.UNKNOWN);
    });

    // Um deploy zera o contador. Se silêncio virasse vermelho, o painel nasceria
    // em pânico a cada publicação — o jeito mais rápido de ensinar alguém a
    // ignorar um monitor.
    it('fonte que roda uma vez por dia explica o silêncio em vez de alarmar', () => {
        const facts = factsBase();
        facts.fundamentals = { timestamp: null }; // sem entrega gravada
        const rows = buildSourceStatuses(facts, getSourceStats());
        expect(byId(rows, 'fundamentus').detail).toContain('uma vez por dia');
    });

    // Depois de um deploy, a fonte tem entrega gravada no banco e zero chamadas no
    // processo novo. Dizer só "sem chamadas" ao lado de "há 12 min" fazia a linha
    // se contradizer na tela.
    it('entrega anterior ao reinício não vira "sem chamadas" seco', () => {
        const facts = factsBase();
        facts.macro.currenciesSources = { usd: 'PTAX/BCB', btc: 'Coinbase' };
        const rows = buildSourceStatuses(facts, getSourceStats());

        const coinbase = byId(rows, 'coinbase');
        expect(coinbase.attempts).toBe(0);
        expect(coinbase.lastDeliveryAt).toEqual(facts.macro.currenciesUpdatedAt);
        expect(coinbase.detail).toContain('antes do último reinício');
    });

    it('metade das chamadas falhando derruba uma fonte crítica', () => {
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'yahoo.quotes', attempts: 10, ok: 4, failures: 6, failureRate: 0.6,
        }));
        expect(byId(rows, 'yahoo.quotes').status).toBe(SOURCE_STATUS.CRITICAL);
        expect(byId(rows, 'yahoo.quotes').detail).toContain('60%');
    });

    it('a mesma taxa numa fonte de reserva é só ALERTA — há quem cubra por ela', () => {
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'coinbase', attempts: 10, ok: 4, failures: 6, failureRate: 0.6,
        }));
        expect(byId(rows, 'coinbase').status).toBe(SOURCE_STATUS.WARN);
    });

    it('uma falha isolada não pinta a fonte de amarelo', () => {
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'yahoo.quotes', attempts: 20, ok: 19, failures: 1, failureRate: 0.05,
        }));
        expect(byId(rows, 'yahoo.quotes').status).toBe(SOURCE_STATUS.OK);
    });

    it('poucas tentativas, nenhuma boa: acusa mesmo sem tendência estatística', () => {
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'yahoo.currencies', attempts: 2, ok: 0, failures: 2, failureRate: 1,
        }));
        expect(byId(rows, 'yahoo.currencies').status).toBe(SOURCE_STATUS.WARN);
        expect(byId(rows, 'yahoo.currencies').detail).toContain('Nenhuma');
    });

    // O caso exato de 04/09/2026: o Yahoo servia cotações e índices normalmente e
    // falhava só no câmbio, no mesmo processo. Uma linha por responsabilidade é o
    // que torna isso visível.
    it('separa as responsabilidades do MESMO provedor', () => {
        let rows = getSourceStats().map((s) => (
            s.id === 'yahoo.currencies'
                ? { ...s, attempts: 8, ok: 0, failures: 8, failureRate: 1 }
                : (s.id === 'yahoo.quotes' ? { ...s, attempts: 40, ok: 40, failures: 0, failureRate: 0 } : s)
        ));
        rows = buildSourceStatuses(factsBase(), rows);
        expect(byId(rows, 'yahoo.quotes').status).toBe(SOURCE_STATUS.OK);
        expect(byId(rows, 'yahoo.currencies').status).not.toBe(SOURCE_STATUS.OK);
    });

    it('a entrega registrada no banco vira a data de referência da fonte', () => {
        const facts = factsBase();
        facts.macro.currenciesSources = { usd: 'PTAX/BCB', btc: 'Coinbase' };
        const rows = buildSourceStatuses(facts, getSourceStats());

        expect(byId(rows, 'ptax').lastDeliveryAt).toEqual(facts.macro.currenciesUpdatedAt);
        expect(byId(rows, 'coinbase').lastDeliveryAt).toEqual(facts.macro.currenciesUpdatedAt);
        // O Yahoo não é a origem de nenhuma das moedas nesse cenário.
        expect(byId(rows, 'yahoo.currencies').lastDeliveryAt).toBeNull();
    });
});

describe('summarizeSources — a frase do topo', () => {
    beforeEach(() => resetSourceStats());

    it('conta e NOMEIA as fontes degradadas', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats().map((s) => (
            s.id === 'yahoo.quotes' ? { ...s, attempts: 10, ok: 1, failures: 9, failureRate: 0.9 } : s
        )));
        const resumo = summarizeSources(rows);

        expect(resumo.degraded).toBe(1);
        expect(resumo.degradedLabels).toEqual(['Yahoo Finance — cotações']);
        expect(resumo.worst).toBe(SOURCE_STATUS.CRITICAL);
        expect(resumo.total).toBe(Object.keys(SOURCE_CATALOG).length);
    });

    it('sem degradação, o pior estado é OK mesmo com fontes ainda desconhecidas', () => {
        const resumo = summarizeSources(buildSourceStatuses(factsBase(), getSourceStats()));
        expect(resumo.worst).toBe(SOURCE_STATUS.OK);
        expect(resumo.unknown).toBeGreaterThan(0);
    });
});
