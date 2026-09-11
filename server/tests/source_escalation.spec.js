import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    recordEscalation,
    getEscalation,
    getEscalations,
    getSourceStats,
    resetSourceStats,
} from '../utils/sourceHealth.js';
import { buildEscalationView, buildSourceStatuses } from '../utils/dataSourceStatus.js';

/**
 * O LEDGER POR ATIVO nasceu da lacuna que sobrou do painel de fontes: ele dizia
 * "a Brapi está instável — 80 chamadas, 24 sem dado" e parava aí. Quais ativos
 * chegaram até ela, ninguém sabia. E os dois diagnósticos por trás daquele número
 * pedem ações opostas: 24 ativos diferentes falhando é fonte degradada; o mesmo
 * papel morto tentado 24 vezes é ticker para aposentar.
 */

const cadeiaCompleta = (subject, resolvedBy, extra = {}) => recordEscalation({
    chain: 'quotes',
    subject,
    tried: ['yahoo.quotes', 'google.finance', 'brapi'],
    resolvedBy,
    reason: 'O Yahoo não trouxe o preço deste ativo',
    ...extra,
});

describe('ledger de escaladas', () => {
    beforeEach(() => resetSourceStats());

    it('guarda o caminho completo, incluindo a fonte principal que falhou', () => {
        cadeiaCompleta('PETR4', 'brapi');
        const [ev] = getEscalations();
        expect(ev.tried).toEqual(['yahoo.quotes', 'google.finance', 'brapi']);
        expect(ev.resolvedBy).toBe('brapi');
    });

    // Sem isto, um ticker morto tentado a cada 15 minutos empurraria todo o resto
    // para fora do teto em duas horas: a lista viraria a mesma linha repetida.
    it('repetição atualiza a MESMA linha e conta as ocorrências', () => {
        cadeiaCompleta('EURP11', null);
        cadeiaCompleta('EURP11', null);
        cadeiaCompleta('EURP11', null);
        expect(getEscalations()).toHaveLength(1);
        expect(getEscalations()[0].count).toBe(3);
    });

    it('escalada é registro de ATIVO, não de chamada — não mexe nos contadores da fonte', () => {
        cadeiaCompleta('PETR4', 'brapi');
        expect(getSourceStats().find((s) => s.id === 'brapi').attempts).toBe(0);
    });

    /**
     * PULAR NÃO É FALHAR — o terceiro estado do elo.
     *
     * Com dois estados ("entregou" e, por eliminação, "falhou"), toda rotina que
     * desce direto para a reserva porque a régua de staleness mandou poupar a
     * principal acusava a principal de uma falha que nunca houve: em 10/09/2026
     * o painel riscou "Yahoo histórico" em 523 linhas de chamadas que não saíram.
     */
    it('guarda quais elos NÃO foram consultados', () => {
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            skipped: ['yahoo.history'], resolvedBy: 'b3',
        });
        const [ev] = getEscalations();
        expect(ev.tried).toEqual(['yahoo.history', 'b3']);
        expect(ev.skipped).toEqual(['yahoo.history']);
    });

    // Elo fora do caminho não teria onde aparecer na tela, e viraria desconto
    // fantasma nas contagens do card.
    it('descarta "não consultada" que nem estava no caminho', () => {
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            skipped: ['brapi'], resolvedBy: 'b3',
        });
        expect(getEscalations()[0].skipped).toEqual([]);
    });

    // A leitura existe para quem SOBRESCREVE a linha de outra rotina e precisa
    // saber se as duas falam do mesmo pregão antes de apagar o que ela mediu.
    it('devolve a linha do assunto, com o pregão de que ela fala', () => {
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            resolvedBy: null, session: '2026-09-09',
        });
        expect(getEscalation('candle', 'ITSA4')).toMatchObject({ session: '2026-09-09', resolvedBy: null });
        expect(getEscalation('candle', 'PETR4')).toBeNull();
    });

    it('ignora evento sem cadeia ou sem assunto', () => {
        recordEscalation({ chain: 'quotes', subject: '', tried: ['yahoo.quotes'] });
        recordEscalation({ chain: '', subject: 'PETR4', tried: ['yahoo.quotes'] });
        expect(getEscalations()).toHaveLength(0);
    });
});

describe('cruzamento do ledger com as fontes', () => {
    const stats = () => [
        { id: 'yahoo.quotes', short: 'Yahoo', chain: 'quotes', schedule: { kind: 'minutes', at: [0] } },
        { id: 'google.finance', short: 'Google', chain: 'quotes', schedule: { kind: 'onFailure' } },
        { id: 'brapi', short: 'Brapi', chain: 'quotes', schedule: { kind: 'onFailure' } },
        { id: 'coinbase', short: 'Coinbase', chain: 'fx', schedule: { kind: 'onFailure' } },
    ];

    beforeEach(() => resetSourceStats());

    it('conta, por fonte, quem chegou / quem ela salvou / quem passou direto', () => {
        cadeiaCompleta('PETR4', 'brapi');
        recordEscalation({ chain: 'quotes', subject: 'NGRD3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance' });
        cadeiaCompleta('EURP11', null);

        const { bySource } = buildEscalationView(getEscalations(), stats());

        // A principal aparece em todas as escaladas: é o que permite ao card do
        // Yahoo dizer em quantos ativos ELE não entregou.
        //
        // `orphaned` é o subconjunto de `missed` que NINGUÉM salvou, e é o que
        // separa "esta fonte falhou onde a seguinte deu conta" de "o ativo não
        // negocia mais". Só EURP11 é órfão aqui — PETR4 saiu pela Brapi e NGRD3
        // pelo Google, então nesses dois a falha é mesmo da fonte.
        expect(bySource.get('yahoo.quotes')).toEqual({ reached: 3, rescued: 0, missed: 3, orphaned: 1, orphanedExpected: 0 });
        expect(bySource.get('google.finance')).toEqual({ reached: 3, rescued: 1, missed: 2, orphaned: 1, orphanedExpected: 0 });
        expect(bySource.get('brapi')).toEqual({ reached: 2, rescued: 1, missed: 1, orphaned: 1, orphanedExpected: 0 });
    });

    // O contrário do teste acima: a fonte que a rotina decidiu não consultar não
    // foi alcançada, não perdeu nada e não ficou com órfão. Sem esta subtração, o
    // card do Yahoo histórico exibia 523 `missed` de chamadas que não existiram.
    it('fonte não consultada fica FORA das contas do card', () => {
        recordEscalation({
            chain: 'quotes', subject: 'PETR4', tried: ['yahoo.quotes', 'google.finance'],
            skipped: ['yahoo.quotes'], resolvedBy: 'google.finance',
        });

        const { bySource } = buildEscalationView(getEscalations(), stats());

        expect(bySource.get('yahoo.quotes')).toBeUndefined();
        expect(bySource.get('google.finance')).toMatchObject({ reached: 1, rescued: 1, missed: 0 });
    });

    it('resume a cadeia com o "sem preço" contado à parte', () => {
        cadeiaCompleta('PETR4', 'brapi');
        cadeiaCompleta('EURP11', null);
        recordEscalation({ chain: 'quotes', subject: 'B3SA3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance', expected: true });

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.total).toBe(3);
        expect(chains.quotes.unresolved).toBe(1);
        expect(chains.quotes.expected).toBe(1);
        // Ordem da cadeia, com o "ninguém" no fim — a leitura natural da frase.
        expect(chains.quotes.byResolver.map((r) => r.id)).toEqual(['google.finance', 'brapi', null]);
    });

    /**
     * VERMELHO É O QUE SOBRA DEPOIS DE TIRAR A AUSÊNCIA INEVITÁVEL.
     *
     * Papel que não negociou não tem fechamento em fonte alguma — nem agora nem
     * depois. Contá-lo junto com quem ficou sem dado por falha de fonte foi o que
     * pintou 49 ilíquidos de vermelho em 08/09/2026, num dia em que o arquivo da
     * B3 estava publicado e completo.
     */
    it('separa a ausência que ninguém poderia ter resolvido', () => {
        cadeiaCompleta('EURP11', null);
        cadeiaCompleta('COCE3', null, { expected: true });
        cadeiaCompleta('PATI4', null, { expected: true });
        cadeiaCompleta('PETR4', 'brapi');

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.unresolved).toBe(3);
        expect(chains.quotes.unresolvedExpected).toBe(2);
    });

    // Escalada esperada que foi RESOLVIDA não entra: a subtração é sobre o balde
    // do vermelho, e ali só existe quem ficou sem dado.
    it('esperado que a reserva salvou não conta como ausência esperada', () => {
        cadeiaCompleta('B3SA3', 'google.finance', { expected: true });
        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.expected).toBe(1);
        expect(chains.quotes.unresolvedExpected).toBe(0);
    });

    // Com dois pesos, 49 papéis sem pregão empurravam para fora da amostra
    // justamente o ativo que ficou sem fechamento por falha de fonte.
    it('ordena sem-fonte, depois ausência esperada, depois resolvido', () => {
        cadeiaCompleta('RESOLVIDO3', 'google.finance');
        cadeiaCompleta('ESPERADO3', null, { expected: true });
        cadeiaCompleta('SEMFONTE3', null);

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.items.map((i) => i.subject))
            .toEqual(['SEMFONTE3', 'ESPERADO3', 'RESOLVIDO3']);
    });

    // A lista tem teto de transporte; o que sobra tem que ser o menos importante.
    it('lista quem ficou sem preço PRIMEIRO', () => {
        cadeiaCompleta('AAAA3', 'google.finance');
        cadeiaCompleta('BBBB3', 'google.finance');
        cadeiaCompleta('ZZZZ11', null);

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.items[0].subject).toBe('ZZZZ11');
    });

    // Zero afirma que nada escalou; ausência admite que não medimos. Uma cadeia
    // sem instrumentação não tem direito à primeira afirmação. Hoje as quatro do
    // catálogo são medidas — o contrato abaixo vale para a PRÓXIMA que entrar, e
    // é o que impede que ela chegue à tela dizendo "nada escalou" sem ter olhado.
    it('só cria resumo para cadeia com ledger', () => {
        recordEscalation({ chain: 'nao-instrumentada', subject: 'X', tried: ['fonte.nova'], resolvedBy: null });
        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains['nao-instrumentada']).toBeUndefined();
        expect(chains.quotes).toBeDefined();
        expect(chains.quotes.total).toBe(0);
    });

    it('fonte de cadeia sem ledger vem com escalated null, nunca zerado', () => {
        const facts = { now: new Date(), macro: {}, fundamentals: {} };
        const semLedger = [...stats(), { id: 'fonte.nova', short: 'Nova', chain: 'nao-instrumentada', schedule: { kind: 'onFailure' } }];
        const linhas = buildSourceStatuses(facts, semLedger, getEscalations());
        expect(linhas.find((l) => l.id === 'fonte.nova').escalated).toBeNull();
        expect(linhas.find((l) => l.id === 'brapi').escalated).toEqual({ reached: 0, rescued: 0, missed: 0 });
    });

    /**
     * O RELÓGIO DA CADEIA.
     *
     * A linha do painel afirmava "43 ativos precisaram de reserva" sem tempo
     * nenhum, ao lado de cards que dizem "recebendo · agora" — e o ledger não
     * expira por idade, então uma escalada da manhã continuava na tela à noite
     * com cara de estar acontecendo.
     *
     * `items[0].at` não serve para isso: a lista é ordenada por "sem resolver
     * primeiro", então o primeiro item pode ser justamente o mais antigo.
     */
    it('carrega o instante da escalada mais recente, não o do primeiro da lista', () => {
        const antigo = new Date('2026-09-06T10:00:00.000Z');
        const recente = new Date('2026-09-06T18:00:00.000Z');
        vi.setSystemTime(antigo);
        cadeiaCompleta('ZZZZ11', null);
        vi.setSystemTime(recente);
        cadeiaCompleta('PETR4', 'brapi');
        vi.useRealTimers();

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.items[0].subject).toBe('ZZZZ11');
        expect(new Date(chains.quotes.lastAt).toISOString()).toBe(recente.toISOString());
    });

    // As palavras são da cadeia, não da tela: o painel nasceu falando de "ativo"
    // e "preço", e a mesma frase diria "2 ativos sem preço" para o dólar e o
    // Bitcoin. Quem sabe o nome das coisas é quem as mede.
    it('cada cadeia leva o próprio vocabulário para a tela', () => {
        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.vocabulary.noun).toBe('ativo');
        expect(chains.fx.vocabulary.noun).toBe('moeda');
        expect(chains.fx.vocabulary.missingBadge).toBe('sem cotação');
        expect(chains.rates.vocabulary.noun).toBe('indicador');
        expect(chains.candle.vocabulary.missingBadge).toBe('sem fechamento');
    });

    /**
     * TETO POR CADEIA.
     *
     * Com quatro cadeias no mesmo registro, um dia em que o Yahoo publica a série
     * de centenas de papéis sem o fechamento empurraria as duas linhas do câmbio
     * para fora — e a pergunta que o ledger do câmbio existe para responder
     * sumiria justamente no dia ruim.
     */
    it('cadeia cheia não expulsa o vizinho', () => {
        recordEscalation({ chain: 'fx', subject: 'USD', tried: ['yahoo.currencies', 'ptax'], resolvedBy: 'ptax' });
        for (let i = 0; i < 700; i += 1) {
            recordEscalation({ chain: 'candle', subject: `TICK${i}`, tried: ['yahoo.history', 'b3'], resolvedBy: 'b3' });
        }
        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.fx.total).toBe(1);
        expect(chains.candle.total).toBe(600);
    });
});
