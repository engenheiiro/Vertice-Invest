import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildChainMap,
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
    // Fonte AGENDADA sem chamadas: cinza com previsão, não alarme.
    it('fonte agendada que ainda não rodou diz quando volta', () => {
        const facts = factsBase();
        facts.fundamentals = { timestamp: null }; // sem entrega gravada
        const fundamentus = byId(buildSourceStatuses(facts, getSourceStats()), 'fundamentus');

        expect(fundamentus.status).toBe(SOURCE_STATUS.UNKNOWN);
        expect(fundamentus.trigger).toBe('scheduled');
        expect(fundamentus.detail).toContain('Ainda não teve a vez');
        expect(fundamentus.cadence).toBe('Todo dia às 09:00 e 18:30');
        expect(fundamentus.nextRun).toMatch(/(hoje|amanhã) às (09:00|18:30)/);
    });

    // Fonte de RESERVA sem chamadas: é boa notícia, não pendência. Ela só entra
    // quando a anterior falha — silêncio ali significa que a cadeia deu conta.
    it('fonte de reserva sem chamadas explica que isso é o esperado', () => {
        const coinbase = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'coinbase');

        expect(coinbase.status).toBe(SOURCE_STATUS.UNKNOWN);
        expect(coinbase.trigger).toBe('onFailure');
        expect(coinbase.nextRun).toBeNull();   // não tem hora marcada
        expect(coinbase.detail).toContain('é o esperado');
        expect(coinbase.cadence).toContain('quando a fonte anterior');
    });

    it('a fonte agendada carrega a periodicidade em português', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'bcb.series').cadence).toBe('A cada 15 minutos');
        expect(byId(rows, 'bcb.series').nextRun).toMatch(/^(em \d+ min|em instantes)$/);
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

    // Rodou UMA vez e não trouxe nada: sai do cinza na hora. Era o pedido
    // explícito — "se rodar e não receber, deve ficar laranja ou vermelho".
    it('uma única chamada sem dado já tira a fonte do cinza', () => {
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'tesouro', attempts: 1, ok: 0, failures: 1, failureRate: 1,
        }));
        // `tesouro` é essencial → vermelho, não amarelo.
        expect(byId(rows, 'tesouro').status).toBe(SOURCE_STATUS.CRITICAL);
        expect(byId(rows, 'tesouro').detail).toContain('uma vez e não trouxe dado');
    });

    // Histórico bom não pode esconder uma queda acontecendo agora. Uma fonte
    // diária levaria semanas para a MÉDIA acusar o que a última chamada já diz.
    it('última chamada falhando derruba do verde, mesmo com média boa', () => {
        const agora = new Date(NOW);
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'yahoo.quotes',
            attempts: 30,
            ok: 29,
            failures: 1,
            failureRate: 1 / 30,
            lastOkAt: new Date(agora.getTime() - 3600000),
            lastFailAt: agora,
        }));
        expect(byId(rows, 'yahoo.quotes').status).toBe(SOURCE_STATUS.WARN);
        expect(byId(rows, 'yahoo.quotes').detail).toContain('última chamada falhou');
    });

    it('falha antiga seguida de sucesso volta ao verde', () => {
        const agora = new Date(NOW);
        const rows = buildSourceStatuses(factsBase(), stats({
            id: 'yahoo.quotes',
            attempts: 30,
            ok: 29,
            failures: 1,
            failureRate: 1 / 30,
            lastFailAt: new Date(agora.getTime() - 3600000),
            lastOkAt: agora,
        }));
        expect(byId(rows, 'yahoo.quotes').status).toBe(SOURCE_STATUS.OK);
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

// "Essa fonte caiu — e agora?" é a pergunta seguinte à do painel, e a resposta
// não estava em lugar nenhum.
describe('cadeia de cobertura', () => {
    beforeEach(() => resetSourceStats());

    it('a principal lista quem assume, na ordem de tentativa', () => {
        const yahoo = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'yahoo.currencies');
        expect(yahoo.covers).toBeNull();
        expect(yahoo.backups).toEqual(['AwesomeAPI', 'Coinbase', 'PTAX — Banco Central']);
    });

    it('a reserva diz quem ela cobre e quem vem depois dela', () => {
        const coinbase = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'coinbase');
        expect(coinbase.covers).toBe('Yahoo Finance — câmbio');
        expect(coinbase.backups).toEqual(['PTAX — Banco Central']);
    });

    it('a última da cadeia não tem mais ninguém atrás', () => {
        const ptax = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax');
        expect(ptax.backups).toEqual([]);
        expect(ptax.covers).toBe('Yahoo Finance — câmbio');
    });

    // O que mais importa saber: onde NÃO há rede de proteção. Bloco não é cadeia —
    // o Fundamentus não substitui o Tesouro só por estarem no mesmo agrupamento.
    it('fonte sem cadeia é ponto único de falha, e isso fica explícito', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        for (const id of ['tesouro', 'fundamentus', 'yahoo.indices']) {
            expect(byId(rows, id).backups).toEqual([]);
            expect(byId(rows, id).covers).toBeNull();
        }
    });

    // A série diária DEIXOU de ser ponto único em 04/09/2026: o arquivo da B3
    // passou a cobrir o universo de pesquisa, não só a carteira. O painel só pode
    // afirmar isso porque o código realmente faz — ver `reinforceWithB3`.
    //
    // As barras horárias entraram em 05/09/2026 como TERCEIRO elo, e a ordem
    // importa: o arquivo da B3 é fechamento oficial, a barra horária é
    // aproximação. Inverter os dois no catálogo faria o painel prometer
    // precisão que a segunda reserva não tem.
    it('o histórico diário tem a B3 e as barras horárias como reserva', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'yahoo.history').backups).toEqual([
            'B3 — arquivo diário',
            'Yahoo Finance — barras horárias',
        ]);
        expect(byId(rows, 'b3').covers).toBe('Yahoo Finance — histórico');
        expect(byId(rows, 'b3').chainPosition).toBe(2);
        expect(byId(rows, 'yahoo.hourly').chainPosition).toBe(3);
    });

    // O catálogo afirmava que a Brapi vinha antes do Google. `recoverQuote` faz o
    // contrário, e um painel que inverte a ordem de tentativa manda investigar a
    // fonte errada no dia da falha.
    // O candle do Yahoo entrou como 2º elo em 04/09/2026: mesmo provedor, outro
    // endpoint, e os dois não falham juntos — sair para scraping antes de tentar
    // isso era pagar mais caro por uma resposta pior.
    it('a cadeia de cotações segue a ordem do código: candle, Google, Brapi', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'yahoo.quotes').backups).toEqual(['Yahoo Finance — candle', 'Google Finance', 'Brapi']);
        expect(byId(rows, 'yahoo.chart').chainPosition).toBe(2);
        expect(byId(rows, 'google.finance').chainPosition).toBe(3);
        expect(byId(rows, 'brapi').chainPosition).toBe(4);
    });

    it('cadeias diferentes não se misturam', () => {
        const bcb = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'bcb.series');
        expect(bcb.backups).toEqual(['BrasilAPI', 'IBGE']);
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

/**
 * A ordem da cadeia precisa vir do DADO, e não da vizinhança na tela. Um bloco do
 * painel junta responsabilidades independentes — a B3 fica ao lado da Google
 * Finance sem ser o 4º elo das cotações —, então numerar por posição visual
 * afirmaria uma cobertura que não existe.
 */
describe('buildChainMap — posição declarada, não inferida da tela', () => {
    const fonte = (id, chain, kind = 'onFailure') => ({
        id, label: id.toUpperCase(), chain, schedule: chain ? { kind } : null,
    });

    it('numera cada elo pela ordem do catálogo, 1-based', () => {
        const mapa = buildChainMap([
            fonte('a', 'fx', 'minutes'),
            fonte('b', 'fx'),
            fonte('c', 'fx'),
        ]);
        expect(mapa.get('a').chainPosition).toBe(1);
        expect(mapa.get('b').chainPosition).toBe(2);
        expect(mapa.get('c').chainPosition).toBe(3);
        expect(mapa.get('c').chainSize).toBe(3);
    });

    it('publica o id da cadeia, para a tela agrupar sem adivinhar', () => {
        const mapa = buildChainMap([fonte('a', 'fx', 'minutes'), fonte('b', 'quotes', 'minutes')]);
        expect(mapa.get('a').chain).toBe('fx');
        expect(mapa.get('b').chain).toBe('quotes');
    });

    // O caso que motivou tudo: fonte sem cadeia não entra no mapa, e por isso não
    // ganha número nem seta. Silêncio aqui vira "ponto único de falha" na tela.
    it('fonte independente fica de fora do mapa, sem posição', () => {
        const mapa = buildChainMap([fonte('a', 'quotes', 'minutes'), fonte('b3', null)]);
        expect(mapa.has('b3')).toBe(false);
    });

    it('buildSourceStatuses carrega chain/posição para cada fonte', () => {
        const linhas = buildSourceStatuses(
            { now: new Date('2026-09-04T12:00:00Z'), macro: {} },
            [
                { ...fonte('a', 'fx', 'minutes'), attempts: 0, ok: 0, failures: 0, failureRate: null, critical: false },
                { ...fonte('b3', null), attempts: 0, ok: 0, failures: 0, failureRate: null, critical: false },
            ],
        );
        expect(linhas[0]).toMatchObject({ chain: 'fx', chainPosition: 1, chainSize: 1 });
        expect(linhas[1]).toMatchObject({ chain: null, chainPosition: null, chainSize: null });
    });
});
