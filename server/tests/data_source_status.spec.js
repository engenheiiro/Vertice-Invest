import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildChainMap,
    buildSourceStatuses,
    summarizeSources,
    SOURCE_STATUS,
} from '../utils/dataSourceStatus.js';
import {
    trackSource, getSourceStats, resetSourceStats, recordSourceSkip, SOURCE_CATALOG,
} from '../utils/sourceHealth.js';

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

    // A taxa de falha de uma RESERVA mede a população que chega até ela, não a
    // fonte: só lhe perguntam o que a anterior já não conseguiu. Em 05/09/2026 o
    // candle do Yahoo apareceu como "INSTÁVEL · 100% das 3 chamadas falharam"
    // respondendo normalmente para o resto do mercado — as três chamadas tinham
    // sido para AVB, EQR e EA, que haviam saído da bolsa. Só o ledger por assunto
    // desempata, e é isso que estes dois testes travam.
    const escalada = (subject, resolvedBy) => ({
        chain: 'quotes', subject, tried: ['yahoo.quotes', 'yahoo.chart'], resolvedBy, count: 1, at: NOW,
    });

    it('reserva chamada só para ativo que ninguém precificou não é acusada', () => {
        const rows = buildSourceStatuses(
            factsBase(),
            stats({ id: 'yahoo.chart', attempts: 3, ok: 0, failures: 3, failureRate: 1 }),
            [escalada('AVB', null), escalada('EQR', null), escalada('EA', null)],
        );
        const chart = byId(rows, 'yahoo.chart');
        expect(chart.status).toBe(SOURCE_STATUS.UNKNOWN);
        expect(chart.detail).toContain('nenhuma fonte precificou');
        // Os números crus continuam à mão: o veredito muda, o fato não some.
        expect(chart.attempts).toBe(3);
        expect(chart.failureRate).toBe(1);
    });

    it('basta um ativo salvo pela fonte SEGUINTE para a suspeita voltar a ser dela', () => {
        const rows = buildSourceStatuses(
            factsBase(),
            stats({ id: 'yahoo.chart', attempts: 3, ok: 0, failures: 3, failureRate: 1 }),
            [escalada('AVB', null), escalada('EQR', null), escalada('PETR4', 'google.finance')],
        );
        expect(byId(rows, 'yahoo.chart').status).toBe(SOURCE_STATUS.WARN);
        expect(byId(rows, 'yahoo.chart').detail).toContain('100%');
    });

    // Só 'candle' exige que TODO órfão seja uma ausência esperada — porque só ali
    // `expected` significa "confirmadamente sem negócio" (SEM_NEGOCIO). Em 'quotes'
    // ele significa outra coisa (PREFER_GOOGLE_TICKERS), e por isso os dois testes
    // do AVB/EQR/EA acima continuam de pé sem passar `expected`.
    const escaladaCandle = (subject, resolvedBy, expected = false) => ({
        chain: 'candle', subject, tried: ['yahoo.history', 'b3'], resolvedBy, expected, count: 1, at: NOW,
    });

    it('B3 sem arquivo do pregão não é assunto morto — é falha real da cadeia', () => {
        const rows = buildSourceStatuses(
            factsBase(),
            stats({ id: 'b3', attempts: 3, ok: 0, failures: 3, failureRate: 1 }),
            [escaladaCandle('ITSA4', null), escaladaCandle('PETR4', null), escaladaCandle('VALE3', null)],
        );
        const b3 = byId(rows, 'b3');
        // SEM_ARQUIVO nunca marca `expected`: os três ficam órfãos e nenhum é
        // ausência esperada, então a régua de "assunto morto" não se aplica — o
        // card cai na taxa de falha normal, igual a qualquer outra fonte instável.
        expect(b3.status).not.toBe(SOURCE_STATUS.UNKNOWN);
        expect(b3.idleReason).not.toBe('NO_LIVE_SUBJECT');
    });

    it('B3 só com papel confirmadamente sem negócio continua "sem alvo vivo"', () => {
        const rows = buildSourceStatuses(
            factsBase(),
            stats({ id: 'b3', attempts: 2, ok: 0, failures: 2, failureRate: 1 }),
            [escaladaCandle('COCE3', null, true), escaladaCandle('PATI4', null, true)],
        );
        const b3 = byId(rows, 'b3');
        expect(b3.status).toBe(SOURCE_STATUS.UNKNOWN);
        expect(b3.idleReason).toBe('NO_LIVE_SUBJECT');
    });

    it('B3 com um SEM_ARQUIVO misturado a papéis sem negócio some da calmaria', () => {
        const rows = buildSourceStatuses(
            factsBase(),
            stats({ id: 'b3', attempts: 3, ok: 0, failures: 3, failureRate: 1 }),
            [escaladaCandle('COCE3', null, true), escaladaCandle('PATI4', null, true), escaladaCandle('ITSA4', null, false)],
        );
        // Um único órfão que não é ausência esperada já basta: a maioria expected
        // não pode diluir a falha real do meio.
        expect(byId(rows, 'b3').idleReason).not.toBe('NO_LIVE_SUBJECT');
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

/**
 * ── RESPONDER NÃO É ENTREGAR ────────────────────────────────────────────────
 *
 * O card da PTAX em 07/09/2026 (feriado) anunciava "ÚLTIMA ENTREGA 12:20" logo
 * abaixo de "0 moedas resolvidas por esta fonte". Aquele 12:20 era o `lastOkAt`
 * — a última chamada que voltou —, usado como substituto quando não havia
 * carimbo de entrega. O painel creditava à fonte uma entrega que não houve, que
 * é exatamente o oposto do que ele existe para fazer.
 */
describe('entrega e resposta são dois relógios', () => {
    beforeEach(() => resetSourceStats());

    it('fonte que respondeu mas não é a origem do dado NÃO ganha data de entrega', async () => {
        await trackSource('ptax', async () => ({ ok: true }));
        const facts = factsBase(); // o dólar gravado veio do Yahoo

        const ptax = byId(buildSourceStatuses(facts, getSourceStats()), 'ptax');

        expect(ptax.lastDeliveryAt).toBeNull();     // não entregou
        expect(ptax.lastResponseAt).not.toBeNull(); // mas respondeu
        expect(ptax.deliveryTracked).toBe(true);    // e o vazio aqui é uma afirmação
    });

    it('fonte sem carimbo de entrega admite que não mede, em vez de inventar', async () => {
        await trackSource('yahoo.history', async () => ({ ok: true }));

        const yahoo = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'yahoo.history');

        // Chave AUSENTE no mapa de entregas ≠ chave presente com valor vazio.
        expect(yahoo.deliveryTracked).toBe(false);
        expect(yahoo.lastDeliveryAt).toBeNull();
        expect(yahoo.lastResponseAt).not.toBeNull();
    });

    /**
     * A CADEIA DE COTAÇÃO GANHOU RELÓGIO DE ENTREGA EM 09/09/2026, e ela era a
     * única sem — na cadeia mais crítica que existe no produto.
     *
     * O card da fonte principal dizia "SEM RECEBER — 100% das 15 chamadas
     * falharam" enquanto 980 ativos carregavam preço escrito por ela minutos
     * antes. Nenhum dos dois mentia: o contador conta CHAMADAS (e o lote vinha
     * mesmo falhando por 429 no crumb), o banco guarda o RESULTADO. Faltava o
     * segundo, e sem ele o painel anunciava apagão numa cadeia que entregava.
     */
    it('a cadeia de cotação responde pelo que está gravado no ativo, não pela chamada', () => {
        const facts = factsBase();
        const agora = new Date('2026-09-09T18:20:08.000Z');
        facts.priceDelivery = {
            YAHOO: { at: agora, assets: 980 },
            YAHOO_CHART_FALLBACK: { at: new Date('2026-09-09T18:15:44.000Z'), assets: 182 },
        };

        const rows = buildSourceStatuses(facts, getSourceStats());

        expect(byId(rows, 'yahoo.quotes').lastDeliveryAt).toEqual(agora);
        expect(byId(rows, 'yahoo.chart').deliveryTracked).toBe(true);
        // Reserva que ninguém precisou tem entrega vazia — e o vazio é afirmação,
        // não ausência de medida: aqui ele significa "não salvou ninguém".
        expect(byId(rows, 'google.finance').lastDeliveryAt).toBeNull();
        expect(byId(rows, 'google.finance').deliveryTracked).toBe(true);
    });

    it('quando ela É a origem, os dois relógios convivem', () => {
        const facts = factsBase();
        facts.macro.currenciesSources = { usd: 'PTAX/BCB', btc: 'Coinbase' };

        const ptax = byId(buildSourceStatuses(facts, getSourceStats()), 'ptax');

        expect(ptax.lastDeliveryAt).toEqual(facts.macro.currenciesUpdatedAt);
        expect(ptax.deliveryTracked).toBe(true);
    });
});

/**
 * ── SILÊNCIO TEM DUAS CAUSAS, E ELAS PEDEM LEITURAS OPOSTAS ─────────────────
 *
 * A reserva não chamada porque a anterior deu conta é boa notícia. A fonte não
 * chamada porque hoje ela não teria o dado é informação. Sem registro, as duas
 * ficam idênticas na tela — e a PTAX, sendo `onFailure`, herdava a frase errada.
 */
describe('fonte que NÃO foi chamada por decisão nossa', () => {
    beforeEach(() => resetSourceStats());

    it('a razão do salto aparece no lugar do "a anterior deu conta"', () => {
        recordSourceSkip('ptax', 'Sem fixação em fim de semana ou feriado — o Banco Central não publica hoje');

        const ptax = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax');

        expect(ptax.status).toBe(SOURCE_STATUS.UNKNOWN);
        expect(ptax.detail).toMatch(/feriado/i);
        expect(ptax.skipped).toBe(1);
    });

    it('pular não conta como tentativa, e não suja a taxa de falha', () => {
        recordSourceSkip('ptax', 'feriado');
        recordSourceSkip('ptax', 'feriado');

        const ptax = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax');

        expect(ptax.attempts).toBe(0);
        expect(ptax.failures).toBe(0);
        expect(ptax.failureRate).toBeNull();
    });

    it('sem salto nenhum, a reserva volta a dizer que a anterior deu conta', () => {
        const ptax = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax');
        expect(ptax.detail).toMatch(/fonte anterior/i);
    });

    it('assim que ela é chamada de verdade, quem fala é a chamada', async () => {
        recordSourceSkip('ptax', 'feriado');
        await trackSource('ptax', async () => ({ ok: true }));

        const ptax = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax');

        expect(ptax.attempts).toBe(1);
        expect(ptax.detail).not.toMatch(/feriado/i);
        expect(ptax.skipped).toBe(1); // o registro continua visível no detalhe
    });
});

// "Essa fonte caiu — e agora?" é a pergunta seguinte à do painel, e a resposta
// não estava em lugar nenhum.
describe('cadeia de cobertura', () => {
    beforeEach(() => resetSourceStats());

    it('a principal lista quem assume, na ordem de tentativa', () => {
        const yahoo = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'yahoo.currencies');
        expect(yahoo.covers).toBeNull();
        expect(yahoo.backups).toEqual([
            'Coinbase',
            'PTAX — Banco Central',
            'Coinbase — taxas de câmbio',
        ]);
    });

    it('a reserva diz quem ela cobre e quem vem depois dela', () => {
        const coinbase = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'coinbase');
        expect(coinbase.covers).toBe('Yahoo Finance — câmbio');
        expect(coinbase.backups).toEqual(['PTAX — Banco Central', 'Coinbase — taxas de câmbio']);
    });

    it('a última da cadeia não tem mais ninguém atrás', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'coinbase.rates').backups).toEqual([]);
        expect(byId(rows, 'coinbase.rates').covers).toBe('Yahoo Finance — câmbio');
        // E a PTAX deixou de ser a última em 05/09/2026: ela cobre só o dólar, e
        // só depois das 13h — a manhã sem Yahoo não tinha ninguém.
        expect(byId(rows, 'ptax').chainPosition).toBe(3);
        expect(byId(rows, 'coinbase.rates').chainPosition).toBe(4);
    });

    // O que mais importa saber: onde NÃO há rede de proteção. Bloco não é cadeia —
    // o Fundamentus não substitui o Tesouro só por estarem no mesmo agrupamento.
    it('fonte sem cadeia é ponto único de falha, e isso fica explícito', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        for (const id of ['tesouro', 'fundamentus']) {
            expect(byId(rows, id).backups).toEqual([]);
            expect(byId(rows, id).covers).toBeNull();
        }
    });

    // Os índices SAÍRAM dessa lista em 09/09/2026, e o motivo é o mesmo 429 no
    // crumb que derrubou cotação e câmbio no mesmo minuto: os dois tinham para
    // onde ir, os índices não. O candle do próprio Yahoo (v8, sem crumb) entrou
    // atrás — e o painel só pode afirmar isso porque `getGlobalIndices` faz.
    it('os índices deixaram de ser ponto único de falha', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats());
        expect(byId(rows, 'yahoo.indices').backups).toEqual(['Yahoo Finance — índices (candle)']);
        expect(byId(rows, 'yahoo.indices.chart').covers).toBe('Yahoo Finance — índices');
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

/**
 * ── O RÓTULO DO CARD SAI DA MESMA DECISÃO QUE A FRASE ───────────────────────
 *
 * No feriado de 07/09/2026 o card da PTAX dizia "Sem alvo vivo" enquanto o
 * modal, com a frase do servidor, dizia "não foi chamada: feriado". A tela tinha
 * uma cópia MAIS FROUXA da regra: checava só `reached > 0`, e a regra de verdade
 * exige também que ninguém tenha resolvido aquele assunto. O dólar tinha passado
 * pela PTAX e sido resolvido pela Coinbase logo depois — alvo bem vivo.
 */
describe('a razão do silêncio é decidida no servidor', () => {
    beforeEach(() => resetSourceStats());

    const escalada = (subject, resolvedBy, tried) => ({
        chain: 'fx', subject, tried, resolvedBy, at: new Date(),
    });

    it('fonte pulada é SKIPPED, mesmo com assunto tendo passado por ela', () => {
        recordSourceSkip('ptax', 'Sem fixação em fim de semana ou feriado');

        const rows = buildSourceStatuses(factsBase(), getSourceStats(), [
            // O dólar passou pela PTAX e foi salvo pelo elo seguinte.
            escalada('USD', 'coinbase.rates', ['yahoo.currencies', 'ptax', 'coinbase.rates']),
        ]);

        expect(byId(rows, 'ptax').idleReason).toBe('SKIPPED');
    });

    it('assunto que a cadeia resolveu NUNCA é alvo morto', () => {
        const rows = buildSourceStatuses(factsBase(), getSourceStats(), [
            escalada('USD', 'coinbase.rates', ['yahoo.currencies', 'ptax', 'coinbase.rates']),
        ]);

        expect(byId(rows, 'ptax').idleReason).not.toBe('NO_LIVE_SUBJECT');
    });

    it('reserva que ninguém precisou é STANDBY', () => {
        expect(byId(buildSourceStatuses(factsBase(), getSourceStats()), 'ptax').idleReason).toBe('STANDBY');
    });

    it('fonte julgada pelas próprias chamadas não tem razão de silêncio', async () => {
        await trackSource('yahoo.quotes', async () => ({ ok: true }));
        expect(byId(buildSourceStatuses(factsBase(), getSourceStats()), 'yahoo.quotes').idleReason).toBeNull();
    });
});

/**
 * A FONTE MANUAL FICA CINZA PELO MOTIVO CERTO.
 *
 * `fundamentus.dividends` só roda quando alguém clica no Admin — ela bloqueia o IP
 * de produção. Cinza ali é o normal. O que não pode é o painel explicar esse cinza
 * com a frase da reserva ("a fonte anterior deu conta"), porque nenhuma cadeia foi
 * percorrida: ninguém disparou.
 */
describe('fonte manual: cinza normal, explicação certa', () => {
    beforeEach(() => resetSourceStats());

    it('é STANDBY, e não "ainda não teve a vez dela"', () => {
        const row = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'fundamentus.dividends');
        expect(row.idleReason).toBe('STANDBY');
        expect(row.status).toBe('UNKNOWN');
    });

    it('a explicação fala em disparo, não em fonte anterior', () => {
        const row = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'fundamentus.dividends');
        expect(row.detail).toMatch(/ninguém disparou/i);
        expect(row.detail).not.toMatch(/fonte anterior/i);
    });

    it('não promete horário de próximo disparo', () => {
        const row = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'fundamentus.dividends');
        expect(row.nextRun).toBeNull();
        expect(row.trigger).toBe('onFailure');
    });

    it('a B3 de proventos, essa sim, é agendada', () => {
        const row = byId(buildSourceStatuses(factsBase(), getSourceStats()), 'b3.dividends');
        expect(row.trigger).toBe('scheduled');
        expect(row.nextRun).toBeTruthy();
    });
});
