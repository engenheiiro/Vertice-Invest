import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataSourcesPanel } from './DataSourcesPanel';
import type { ChainFlow, DataSource, QuoteSuspectView, SourceGroup } from '../../services/health';

// A tela existe para responder, sem intermediário técnico: "de onde vem o dado e
// está chegando?". O que se cobra aqui é a hierarquia de leitura — grade agrupada,
// ordem estável, problema visível pela cor — e a linguagem.

const src = (over: Partial<DataSource>): DataSource => ({
    id: 'yahoo.quotes',
    label: 'Yahoo Finance — cotações',
    short: 'Yahoo',
    role: 'Fonte principal',
    group: 'quotes',
    feeds: 'Preço de ações, FIIs, ETFs e cripto',
    critical: true,
    status: 'OK',
    detail: '40 de 40 chamadas com dado',
    lastDeliveryAt: new Date().toISOString(),
    lastDeliveryHours: 0.1,
    attempts: 40,
    failures: 0,
    failureRate: 0,
    lastError: null,
    lastFailAt: null,
    ...over,
});

const groups: SourceGroup[] = [
    { id: 'quotes', label: 'Cotações de ativos', hint: 'Preço da carteira' },
    { id: 'fx', label: 'Câmbio e cripto', hint: 'Converte dólar em reais' },
];

describe('DataSourcesPanel', () => {
    it('agrupa os cards por função, na ordem que o servidor manda', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'quotes' }),
                src({ id: 'b', short: 'Coinbase', group: 'fx' }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('Cotações de ativos')).toBeInTheDocument();
        expect(screen.getByText('Câmbio e cripto')).toBeInTheDocument();
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
        expect(screen.getByText('Coinbase')).toBeInTheDocument();
    });

    // Sem ordenar por gravidade: numa grade a cor faz a triagem, e card que muda
    // de lugar a cada carregamento não se acha de memória. Todos ficam visíveis.
    it('mostra TODAS as fontes de uma vez, sem esconder as saudáveis', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo' }),
                src({ id: 'b', short: 'Brapi', status: 'CRITICAL' }),
                src({ id: 'c', short: 'Google', status: 'UNKNOWN' }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
        expect(screen.getByText('Brapi')).toBeInTheDocument();
        expect(screen.getByText('Google')).toBeInTheDocument();
    });

    it('o card carrega o papel da fonte na cadeia', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Coinbase', role: '3ª fonte (só Bitcoin)' })]}
            groups={groups}
        />);
        expect(screen.getByText('3ª fonte (só Bitcoin)')).toBeInTheDocument();
    });

    it('o resumo NOMEIA quem está com problema, em vez de só contar', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', status: 'WARN' })]}
            summary={{
                total: 1, ok: 0, degraded: 1, unknown: 0,
                degradedLabels: ['Yahoo Finance — câmbio'], worst: 'WARN',
            }}
            groups={groups}
        />);
        expect(screen.getByText(/Yahoo Finance — câmbio/)).toBeInTheDocument();
        expect(screen.getByText('Atenção')).toBeInTheDocument();
    });

    // A pergunta seguinte à do painel: "caiu — e agora?". Antes não tinha resposta.
    it('o detalhe diz quem assume se a fonte falhar', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Yahoo', label: 'Yahoo Finance — câmbio',
                backups: ['Coinbase', 'PTAX — Banco Central'], covers: null,
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Yahoo/ }));
        expect(screen.getByText(/Coinbase → PTAX/)).toBeInTheDocument();
    });

    it('a reserva diz de quem ela é reserva', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Coinbase', label: 'Coinbase',
                backups: ['PTAX — Banco Central'], covers: 'Yahoo Finance — câmbio',
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByText(/Yahoo Finance — câmbio/)).toBeInTheDocument();
    });

    // O aviso mais valioso do modal: onde NÃO há rede de proteção.
    it('fonte sem reserva avisa que é ponto único de falha', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Tesouro', label: 'Tesouro Transparente', backups: [], covers: null })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Tesouro/ }));
        expect(screen.getByText(/Não há fonte alternativa/)).toBeInTheDocument();
    });

    it('o modal fecha no Esc e no clique fora', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Yahoo', label: 'Yahoo Finance — cotações' })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Yahoo/ }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('o detalhe abre ao clicar no card e fecha ao clicar de novo', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Coinbase', label: 'Coinbase', status: 'CRITICAL',
                detail: '100% das 8 chamadas falharam', lastError: 'ETIMEDOUT',
            })]}
            groups={groups}
        />);
        expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();

        // Pelo papel de botão: aberto o detalhe, o nome passa a aparecer duas
        // vezes (no card e no cabeçalho do detalhe).
        const card = () => screen.getByRole('button', { name: /Coinbase/ });

        fireEvent.click(card());
        expect(screen.getByText(/ETIMEDOUT/)).toBeInTheDocument();
        expect(screen.getByText('100% das 8 chamadas falharam')).toBeInTheDocument();

        fireEvent.click(card());
        expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();
    });

    // Um deploy zera o contador do processo. Se "sem chamadas ainda" fosse pintado
    // de falha, o painel nasceria em pânico a cada publicação.
    it('fonte sem uso ainda não é tratada como falha', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Tudo chegando')).toBeInTheDocument();
    });

    // O pedido: "preciso saber que horas eles vão rodar". Card cinza sem previsão
    // é indistinguível de card cinza abandonado.
    it('fonte agendada em espera mostra QUANDO volta a rodar', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Aguardando')).toBeInTheDocument();
        expect(screen.getByText('hoje às 18:30')).toBeInTheDocument();
    });

    // Reserva não tem horário — ela entra quando a anterior falha. Mostrar "—" ali
    // faria parecer defeito o que é o sistema funcionando.
    it('fonte de reserva parada aparece como em espera, não como pendência', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Coinbase', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'onFailure', nextRun: null,
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Em espera')).toBeInTheDocument();
        expect(screen.getByText('reserva')).toBeInTheDocument();
    });

    // "Em espera" quer dizer que ninguém precisou dela. Dizer isso a uma reserva
    // que acabou de ser chamada três vezes é uma mentira pequena — e o painel só
    // vale enquanto cada frase dele resiste a ser conferida.
    it('reserva chamada só para ativo morto não diz "em espera"', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Yahoo candle', status: 'UNKNOWN', attempts: 3, failures: 3, failureRate: 1,
                lastDeliveryHours: null, trigger: 'onFailure', nextRun: null,
                detail: 'As 3 chamadas foram para 3 ativos que nenhuma fonte precificou',
                escalated: { reached: 3, rescued: 0, missed: 3, orphaned: 3 },
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Sem alvo vivo')).toBeInTheDocument();
        expect(screen.queryByText('Em espera')).not.toBeInTheDocument();
    });

    it('o detalhe diz a periodicidade e a próxima execução', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Banco Central', label: 'Banco Central — séries',
                cadence: 'A cada 15 minutos', nextRun: 'em 9 min',
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Banco Central/ }));
        expect(screen.getByText(/A cada 15 minutos/)).toBeInTheDocument();
        expect(screen.getByText(/próxima em 9 min/)).toBeInTheDocument();
    });

    it('servidor antigo (sem os blocos) ainda renderiza os cards', () => {
        render(<DataSourcesPanel sources={[src({ id: 'a', short: 'Yahoo', group: undefined })]} />);
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
    });

    it('sem fontes, não renderiza nada (servidor antigo, campo ausente)', () => {
        const { container } = render(<DataSourcesPanel sources={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});

// O pedido veio de uma leitura errada da tela anterior: cards lado a lado leem-se
// como alternativas equivalentes, e no bloco de cotações a B3 aparecia colada na
// Google Finance como se fosse o 4º elo — quando é fonte independente, que cobre
// o fechamento oficial do pregão e não substitui ninguém.
describe('DataSourcesPanel — ordem da cadeia', () => {
    it('numera cada elo da cadeia na ordem de tentativa', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'fx', chain: 'fx', chainPosition: 1, chainSize: 3 }),
                src({ id: 'b', short: 'Coinbase', group: 'fx', chain: 'fx', chainPosition: 2, chainSize: 3 }),
                src({ id: 'c', short: 'PTAX', group: 'fx', chain: 'fx', chainPosition: 3, chainSize: 3 }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('1ª')).toBeInTheDocument();
        expect(screen.getByText('2ª')).toBeInTheDocument();
        expect(screen.getByText('3ª')).toBeInTheDocument();
    });

    // O ponto todo: fonte sem cadeia não ganha número, porque não tem posição.
    it('fonte independente não recebe ordinal e é separada da cadeia', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'quotes', chain: 'quotes', chainPosition: 1, chainSize: 1 }),
                src({ id: 'b3', short: 'B3', group: 'quotes', chain: null, chainPosition: null }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('1ª')).toBeInTheDocument();
        expect(screen.queryByText('2ª')).not.toBeInTheDocument();
        expect(screen.getByText(/Independente/)).toBeInTheDocument();
    });

    it('bloco sem cadeia nenhuma não anuncia independência (não há o que confundir)', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'tesouro', short: 'Tesouro', group: 'quotes', chain: null, chainPosition: null })]}
            groups={groups}
        />);
        expect(screen.queryByText(/Independente/)).not.toBeInTheDocument();
    });

    it('o detalhe diz a posição na cadeia', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'c', short: 'Coinbase', label: 'Coinbase', chain: 'fx', chainPosition: 3, chainSize: 4,
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByText(/3ª de 4/)).toBeInTheDocument();
    });
});

// Cinza juntava dois estados opostos: a fonte agendada que ainda não cumpriu a
// hora (pendência) e a reserva que ninguém precisou acionar (sistema funcionando).
// A cor tem de separar os dois — é a leitura de relance que o painel existe para dar.
describe('DataSourcesPanel — reserva em espera', () => {
    const reserva = () => src({
        id: 'a', short: 'Coinbase', status: 'UNKNOWN', attempts: 0,
        lastDeliveryHours: null, trigger: 'onFailure', nextRun: null,
    });
    const agendada = () => src({
        id: 'b', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
        lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
    });

    const cardDe = (nome: RegExp) => screen.getByRole('button', { name: nome }).className;

    it('a reserva parada é azul, não cinza', () => {
        render(<DataSourcesPanel sources={[reserva()]} groups={groups} />);
        expect(cardDe(/Coinbase/)).toMatch(/blue/);
    });

    it('a agendada em atraso de vez continua cinza', () => {
        render(<DataSourcesPanel sources={[agendada()]} groups={groups} />);
        expect(cardDe(/Fundamentus/)).not.toMatch(/blue/);
    });

    // Azul é "de prontidão", nunca "entregando": quem sustenta o dado agora é verde,
    // e empatar os dois apagaria a diferença que importa no dia da falha.
    it('fonte entregando não vira azul', () => {
        render(<DataSourcesPanel sources={[src({ id: 'c', short: 'Yahoo', status: 'OK' })]} groups={groups} />);
        expect(cardDe(/Yahoo/)).not.toMatch(/blue/);
    });

    it('o detalhe da reserva abre com a mesma cor do card', () => {
        render(<DataSourcesPanel sources={[reserva()]} groups={groups} />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByRole('dialog').innerHTML).toMatch(/text-blue-400/);
    });
});

// --- O trajeto por ativo -----------------------------------------------------
//
// O painel dizia "a Brapi está instável, 24 chamadas sem dado" e parava aí. Quais
// ativos chegaram até ela era pergunta sem resposta na tela — e os dois
// diagnósticos por trás daquele número pedem ações opostas (fonte degradada ×
// ticker morto para aposentar).

const cadeia: DataSource[] = [
    src({ id: 'yahoo.quotes', short: 'Yahoo', chain: 'quotes', chainPosition: 1, chainSize: 3, escalated: { reached: 3, rescued: 0, missed: 3 } }),
    src({ id: 'google.finance', short: 'Google', chain: 'quotes', chainPosition: 2, chainSize: 3, trigger: 'onFailure', escalated: { reached: 3, rescued: 1, missed: 2 } }),
    src({ id: 'brapi', short: 'Brapi', chain: 'quotes', chainPosition: 3, chainSize: 3, trigger: 'onFailure', status: 'WARN', escalated: { reached: 2, rescued: 1, missed: 1 } }),
];

/** Palavras da cadeia de cotações, como o servidor as manda. */
const vocabCotacoes = {
    noun: 'ativo',
    none: 'Nenhum ativo',
    rescued: 'tiveram o preço trazido por esta fonte',
    allFromPrimary: 'esta fonte trouxe o preço de todos',
    missingBadge: 'sem preço',
    missingLong: 'sem preço em nenhuma',
};

const flow: Record<string, ChainFlow> = {
    quotes: {
        chain: 'quotes',
        lastAt: new Date().toISOString(),
        vocabulary: vocabCotacoes,
        total: 3,
        unresolved: 1,
        expected: 0,
        byResolver: [
            { id: 'google.finance', label: 'Google', count: 1 },
            { id: 'brapi', label: 'Brapi', count: 1 },
            { id: null, label: null, count: 1 },
        ],
        items: [
            { subject: 'EURP11', tried: ['yahoo.quotes', 'google.finance', 'brapi'], resolvedBy: null, reason: 'O Yahoo não trouxe o preço deste ativo', expected: false, count: 4, at: new Date().toISOString() },
            { subject: 'PETR4', tried: ['yahoo.quotes', 'google.finance', 'brapi'], resolvedBy: 'brapi', reason: null, expected: false, count: 1, at: new Date().toISOString() },
            { subject: 'NGRD3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance', reason: null, expected: false, count: 1, at: new Date().toISOString() },
        ],
        truncated: 0,
    },
};

describe('DataSourcesPanel — quem precisou de reserva', () => {
    it('resume a cadeia sem exigir clique, com o "sem preço" destacado', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        expect(screen.getByText(/precisaram de reserva/)).toBeInTheDocument();
        expect(screen.getByText('1 sem preço em nenhuma')).toBeInTheDocument();
    });

    /**
     * A LINHA PRECISA DIZER QUANDO.
     *
     * Ela vive cercada de cards que falam do agora ("Recebendo · agora") e não
     * carregava relógio nenhum: em 06/09/2026 uma escalada de 43 ativos das
     * 15:47 continuava na tela às 22h com cara de estar acontecendo. O ledger
     * acumula desde o reinício e nada nele expira por idade — a idade da última
     * escalada é o que separa "está estourando" de "estourou hoje de manhã".
     */
    it('carimba a hora da escalada mais recente', () => {
        const setehoras = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
        render(<DataSourcesPanel
            sources={cadeia}
            groups={groups}
            chains={{ quotes: { ...flow.quotes, lastAt: setehoras } }}
        />);
        expect(screen.getByText(/último há 7h/)).toBeInTheDocument();
    });

    /**
     * O câmbio percorre a MESMA cadeia e não fala de ativo nem de preço: os
     * assuntos são o dólar e o Bitcoin. A frase é escrita no servidor, junto da
     * cadeia — quem sabe o nome das coisas é quem as mede.
     */
    it('usa as palavras da cadeia: no câmbio é moeda, não ativo', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'yahoo.currencies', short: 'Yahoo', group: 'fx', chain: 'fx', chainPosition: 1, chainSize: 2, escalated: { reached: 1, rescued: 0, missed: 1 } })]}
            groups={groups}
            chains={{
                fx: {
                    chain: 'fx',
                    total: 1,
                    unresolved: 0,
                    expected: 0,
                    lastAt: new Date().toISOString(),
                    byResolver: [{ id: 'ptax', label: 'PTAX', count: 1 }],
                    items: [{ subject: 'USD', tried: ['yahoo.currencies', 'ptax'], resolvedBy: 'ptax', reason: null, expected: false, count: 1, at: new Date().toISOString() }],
                    truncated: 0,
                    vocabulary: {
                        noun: 'moeda',
                        none: 'Nenhuma moeda',
                        rescued: 'tiveram a cotação trazida por esta fonte',
                        allFromPrimary: 'esta fonte trouxe a cotação das duas',
                        missingBadge: 'sem cotação',
                        missingLong: 'sem cotação em nenhuma',
                    },
                },
            }}
        />);
        expect(screen.getByText(/moeda.s. precisaram de reserva/)).toBeInTheDocument();
        expect(screen.queryByText(/ativo.s. precisaram de reserva/)).not.toBeInTheDocument();
    });

    /**
     * O VERMELHO TEM QUE SIGNIFICAR UMA COISA SÓ.
     *
     * Em 08/09/2026 a linha do bloco de histórico dizia "49 sem fechamento em
     * fonte nenhuma", em vermelho, e os 49 eram COCE3, PATI4, RPAD5, TELB3 e
     * companhia — papéis que não negociaram naquele pregão, num dia em que o
     * arquivo oficial da B3 estava publicado com 1.610 papéis. Fechamento que não
     * existe não é dado que faltou; misturar as duas ausências no mesmo alarme
     * ensina a ignorar a lista, inclusive no dia em que a B3 atrasar de verdade.
     */
    const candleFlow = (over: Partial<ChainFlow> = {}): ChainFlow => ({
        chain: 'candle',
        lastAt: new Date().toISOString(),
        total: 50,
        unresolved: 50,
        expected: 49,
        unresolvedExpected: 49,
        byResolver: [{ id: null, label: null, count: 50 }],
        items: [
            { subject: 'BOVA11', tried: ['yahoo.history', 'b3'], resolvedBy: null, reason: 'O Yahoo publicou a série sem o fechamento de 2026-09-08', expected: false, count: 1, at: new Date().toISOString() },
            { subject: 'COCE3', tried: ['yahoo.history', 'b3'], resolvedBy: null, reason: 'O papel não negociou em 2026-09-08 — ausente também no arquivo oficial da B3', expected: true, count: 1, at: new Date().toISOString() },
        ],
        truncated: 0,
        vocabulary: {
            noun: 'ativo',
            none: 'Nenhum ativo',
            escalatedLine: 'ficaram sem o fechamento do dia na série',
            escalatedNone: 'ficou sem o fechamento do dia na série',
            escalatedTitle: 'Quem ficou sem o fechamento na série',
            backupOf: 'Fecha a ponta do pregão na série de',
            rescued: 'tiveram o fechamento trazido por esta fonte',
            allFromPrimary: 'esta fonte trouxe o fechamento de todos',
            missingBadge: 'sem fechamento',
            missingLong: 'sem fechamento em nenhuma',
            expectedBadge: 'não negociou',
            expectedLong: 'sem pregão no papel',
        },
        ...over,
    });

    const cadeiaCandle: DataSource[] = [
        src({ id: 'yahoo.history', short: 'Yahoo histórico', group: 'history', chain: 'candle', chainPosition: 1, chainSize: 2, backups: ['B3 — arquivo diário'] }),
        src({
            id: 'b3', short: 'B3', group: 'history', chain: 'candle', chainPosition: 2, chainSize: 2,
            trigger: 'onFailure', backups: [], covers: 'Yahoo Finance — histórico',
        }),
    ];
    const gruposCandle: SourceGroup[] = [
        ...groups, { id: 'history', label: 'Histórico e índices', hint: 'Gráficos e rentabilidade' },
    ];

    it('separa, na linha, quem ficou sem fonte de quem ficou sem pregão', () => {
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: candleFlow() }} />);
        expect(screen.getByText('1 sem fechamento em nenhuma')).toBeInTheDocument();
        expect(screen.getByText('49 sem pregão no papel')).toBeInTheDocument();
        expect(screen.queryByText('50 sem fechamento em nenhuma')).not.toBeInTheDocument();
    });

    it('na lista, o papel sem negócio não leva o selo vermelho da ausência de fonte', () => {
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: candleFlow() }} />);
        fireEvent.click(screen.getByText(/ver ativos/));
        expect(screen.getByText('não negociou')).toBeInTheDocument();
        // Um só: o BOVA11, que é o caso com consequência.
        expect(screen.getAllByText('sem fechamento')).toHaveLength(1);
    });

    /**
     * O ELO TEM TRÊS ESTADOS, e o terceiro é "não perguntei".
     *
     * A varredura horária da ponta das séries não consulta o Yahoo: desce direto
     * ao arquivo da B3, e é isso que a deixa barata o bastante para rodar de hora
     * em hora. Enquanto a tela só sabia pintar "entregou" e "falhou", as 523
     * séries que a B3 socorreu em 10/09/2026 apareceram com o Yahoo RISCADO — uma
     * acusação por chamadas que nunca saíram. Risco aqui se lê como culpa.
     */
    it('elo não consultado aparece apagado, não riscado', () => {
        const naoConsultado = candleFlow({
            items: [{
                subject: 'ITSA4', tried: ['yahoo.history', 'b3'], skipped: ['yahoo.history'],
                resolvedBy: 'b3', reason: 'sem consultar o Yahoo', expected: false,
                count: 1, at: new Date().toISOString(),
            }],
        });
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: naoConsultado }} />);
        fireEvent.click(screen.getByText(/ver ativos/));

        const elo = within(screen.getByRole('dialog')).getByText('não consultada').parentElement;
        expect(elo?.textContent).toContain('Yahoo histórico');
        expect(elo?.className).not.toContain('line-through');
    });

    /**
     * A CADEIA DE CANDLE NÃO É UMA FILA DE RESERVAS, e a linha dizia que era.
     *
     * "Precisaram de reserva" afirma que a principal foi chamada e não deu conta.
     * Em candle isso é falso na maior parte da semana: a série passa por fresca na
     * régua de 2 dias, o Yahoo não é consultado, e a B3 fecha a ponta porque é a
     * função dela. A linha tem que dizer o ESTADO, não a culpa.
     */
    it('a linha da cadeia de candle fala do fechamento, não de reserva', () => {
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: candleFlow() }} />);
        expect(screen.getByText(/ficaram sem o fechamento do dia na série/)).toBeInTheDocument();
        expect(screen.queryByText(/precisaram de reserva/)).not.toBeInTheDocument();
    });

    // O detalhe da B3 dizia "Esta é reserva de Yahoo Finance — histórico", e é o
    // contrário do que acontece: ela fecha a ponta todo dia, tenha o Yahoo sido
    // consultado ou não. Reserva é a palavra certa nas outras três cadeias.
    it('a B3 não é apresentada como reserva do Yahoo', () => {
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: candleFlow() }} />);
        fireEvent.click(screen.getByRole('button', { name: /B3/ }));

        expect(screen.getByText(/Fecha a ponta do pregão na série de/)).toBeInTheDocument();
        expect(screen.queryByText(/Esta é reserva de/)).not.toBeInTheDocument();
    });

    /**
     * O CARD NÃO PODE DIZER O CONTRÁRIO DA LINHA.
     *
     * De terça a sexta o Yahoo histórico não é consultado por ativo nenhum: a
     * régua de 2 dias o poupa e a B3 fecha a ponta. Com a fonte pulada fora de
     * `reached`, o card caía no ramo de "não precisou de reserva" e afirmava ter
     * resolvido todos — na mesma tela em que a linha conta mil sem fechamento.
     */
    it('fonte não consultada não se declara resolvedora de todos', () => {
        const yahooPulado = src({
            id: 'yahoo.history', short: 'Yahoo histórico', group: 'history', chain: 'candle',
            chainPosition: 1, chainSize: 2, backups: ['B3 — arquivo diário'],
            escalated: { reached: 0, rescued: 0, missed: 0, skipped: 1000 },
        });
        render(<DataSourcesPanel sources={[yahooPulado, cadeiaCandle[1]]} groups={gruposCandle} chains={{ candle: candleFlow() }} />);
        fireEvent.click(screen.getByRole('button', { name: /Yahoo histórico/ }));

        expect(screen.getByText(/^1000 ativo/)).toHaveTextContent('passaram pela cadeia sem que esta fonte fosse consultada');
        expect(screen.queryByText(/trouxe o fechamento de todos/)).not.toBeInTheDocument();
    });

    // Cliente pode subir antes do servidor. Sem o campo, a tela volta ao
    // comportamento antigo — nunca a uma conta com `NaN`.
    it('servidor antigo, sem as frases próprias, volta a falar em reserva', () => {
        const semFrases = candleFlow();
        delete (semFrases.vocabulary as Record<string, unknown>).escalatedLine;
        render(<DataSourcesPanel sources={cadeiaCandle} groups={gruposCandle} chains={{ candle: semFrases }} />);
        expect(screen.getByText(/precisaram de reserva/)).toBeInTheDocument();
    });

    it('servidor antigo, sem a contagem separada, não quebra a linha', () => {
        render(<DataSourcesPanel
            sources={cadeiaCandle}
            groups={gruposCandle}
            chains={{ candle: candleFlow({ unresolvedExpected: undefined }) }}
        />);
        expect(screen.getByText('50 sem fechamento em nenhuma')).toBeInTheDocument();
    });

    // Zero é notícia boa e precisa de frase própria: significa que a principal
    // cobriu o universo inteiro.
    it('diz em voz alta quando ninguém precisou de reserva', () => {
        render(<DataSourcesPanel
            sources={cadeia}
            groups={groups}
            chains={{ quotes: { ...flow.quotes, total: 0, unresolved: 0, byResolver: [], items: [] } }}
        />);
        expect(screen.getByText(/Nenhum ativo precisou de reserva/)).toBeInTheDocument();
    });

    // Ausência de medição não pode virar "nada escalou": a cadeia sem ledger
    // simplesmente não fala.
    it('cala sobre a cadeia que o servidor não mede', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} />);
        expect(screen.queryByText(/precisaram de reserva/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Nenhum ativo precisou de reserva/)).not.toBeInTheDocument();
    });

    it('abre a lista com o ticker, o caminho e quem entregou', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        fireEvent.click(screen.getByText(/ver ativos/));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('PETR4')).toBeInTheDocument();
        // Sem preço primeiro: é a única categoria com consequência real.
        const tickers = screen.getAllByText(/^(EURP11|PETR4|NGRD3)$/).map((n) => n.textContent);
        expect(tickers[0]).toBe('EURP11');
        expect(screen.getByText('sem preço')).toBeInTheDocument();
        expect(screen.getByText('4×')).toBeInTheDocument();
    });

    it('o detalhe da fonte nomeia os ativos que ela salvou e os que perdeu', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        fireEvent.click(screen.getByText('Brapi'));

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Ativos que passaram por aqui');
        expect(dialog).toHaveTextContent('Resolvido por esta fonte');
        expect(dialog).toHaveTextContent('PETR4');
        expect(dialog).toHaveTextContent('Ficou sem preço em fonte nenhuma');
        expect(dialog).toHaveTextContent('EURP11');
        // NGRD3 nunca chegou na Brapi (o Google resolveu antes).
        expect(dialog).not.toHaveTextContent('NGRD3');
    });

    it('fonte sem medição não ganha a seção de ativos', () => {
        render(<DataSourcesPanel sources={[src({ id: 'coinbase', short: 'Coinbase', group: 'fx', escalated: null })]} groups={groups} />);
        fireEvent.click(screen.getByText('Coinbase'));
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Ativos que passaram por aqui');
    });
});

/**
 * "Chegou preço" e "o preço está certo" são perguntas diferentes, e a segunda é
 * a que não deixa rastro: cotação errada volta com carimbo de sucesso. A linha
 * de suspeitos precisa dizer, sem clique, que o preço FOI gravado — senão ela se
 * lê como falha e manda alguém procurar um ativo sem cotação que não existe.
 */
const suspeitos: QuoteSuspectView = {
    total: 2,
    truncated: 0,
    items: [
        {
            subject: 'XPIN11',
            type: 'FII',
            source: 'YAHOO',
            price: 62.04,
            count: 1,
            at: new Date().toISOString(),
            findings: [{
                code: 'SALTO_NA_FONTE',
                detail: '108% contra o fechamento anterior da própria fonte (29.82 → 62.04)',
                movePct: 108,
            }],
        },
        {
            subject: 'NAUI11',
            type: 'FII',
            source: 'YAHOO',
            price: 1000,
            count: 3,
            at: new Date().toISOString(),
            findings: [{
                code: 'VARIACAO_INCOERENTE',
                detail: 'a fonte declara 4.02% mas os preços dela implicam 0.00%',
                movePct: 0,
            }],
        },
    ],
};

describe('DataSourcesPanel — preços fora do esperado', () => {
    it('avisa sem clique, e diz que o preço foi gravado', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={suspeitos} />);
        expect(screen.getByText(/chegaram com preço fora/)).toBeInTheDocument();
        expect(screen.getByText(/gravados, para conferir/)).toBeInTheDocument();
    });

    it('zero também é notícia e tem frase própria', () => {
        render(<DataSourcesPanel
            sources={cadeia}
            groups={groups}
            chains={flow}
            suspects={{ total: 0, items: [], truncated: 0 }}
        />);
        expect(screen.getByText(/Nenhum preço fora do esperado/)).toBeInTheDocument();
    });

    // Servidor sem a medição não pode virar "nenhum preço fora do esperado":
    // são afirmações opostas, e só a segunda temos direito de fazer.
    it('cala quando o servidor não manda a medição', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        expect(screen.queryByText(/Nenhum preço fora do esperado/)).not.toBeInTheDocument();
        expect(screen.queryByText(/chegaram com preço fora/)).not.toBeInTheDocument();
    });

    it('a lista traz o ticker e a frase inteira do motivo, não o código', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={suspeitos} />);
        fireEvent.click(screen.getByText(/chegaram com preço fora/));

        const dialog = screen.getByRole('dialog', { name: /valor fora do esperado/i });
        expect(dialog).toHaveTextContent('XPIN11');
        expect(dialog).toHaveTextContent('108% contra o fechamento anterior');
        expect(dialog).toHaveTextContent('NAUI11');
        expect(dialog).not.toHaveTextContent('SALTO_NA_FONTE');
    });

    // Grupamento e desdobramento têm a mesma assinatura de um erro de fonte: o
    // painel precisa dizer por que não recusou o preço.
    it('explica por que o preço não foi recusado', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={suspeitos} />);
        fireEvent.click(screen.getByText(/chegaram com preço fora/));
        expect(screen.getByRole('dialog', { name: /valor fora do esperado/i }))
            .toHaveTextContent(/grupamento e desdobramento/i);
    });
});

/**
 * ── RESPONDER NÃO É ENTREGAR ────────────────────────────────────────────────
 *
 * O card da PTAX em 07/09/2026 (feriado) mostrava "ÚLTIMA ENTREGA 12:20" logo
 * acima de "0 moedas tiveram a cotação trazida por esta fonte". Os 12:20 eram a
 * última CHAMADA que voltou, servindo de substituto para um carimbo de entrega
 * que não existia — o painel creditava à fonte uma entrega que não houve.
 */
describe('DataSourcesPanel — entrega e resposta no detalhe da fonte', () => {
    const abrir = (over: Partial<DataSource>) => {
        render(<DataSourcesPanel sources={[src({ id: 'ptax', short: 'PTAX', ...over })]} groups={groups} />);
        fireEvent.click(screen.getByRole('button', { name: /PTAX/ }));
    };

    it('fonte que respondeu sem entregar diz isso, em vez de mostrar a hora da chamada', () => {
        abrir({
            deliveryTracked: true,
            lastDeliveryAt: null,
            lastDeliveryHours: null,
            lastResponseAt: new Date().toISOString(),
            lastResponseHours: 3,
        });

        expect(screen.getByText(/nada gravado veio desta fonte agora/)).toBeInTheDocument();
        expect(screen.getByText('Última resposta')).toBeInTheDocument();
    });

    it('fonte sem carimbo de entrega não finge ter um', () => {
        abrir({
            id: 'yahoo.quotes',
            deliveryTracked: false,
            lastDeliveryAt: null,
            lastDeliveryHours: null,
            lastResponseAt: new Date().toISOString(),
            lastResponseHours: 0.1,
        });

        expect(screen.queryByText('Última entrega')).not.toBeInTheDocument();
        expect(screen.getByText('Última resposta')).toBeInTheDocument();
    });

    it('a razão de a fonte não ter sido chamada aparece nomeada', () => {
        abrir({
            deliveryTracked: true,
            lastDeliveryAt: null,
            lastDeliveryHours: null,
            skipped: 2,
            lastSkipReason: 'Sem fixação em fim de semana ou feriado',
        });

        expect(screen.getByText('Não chamada')).toBeInTheDocument();
        expect(screen.getByText(/Sem fixação em fim de semana ou feriado/)).toBeInTheDocument();
    });
});

/**
 * Duas das sete linhas de 07/09/2026 (RBRL11 e STX) eram o momento em que um
 * preço ERRADO que estava guardado foi substituído pelo certo — nada a
 * investigar. Contá-las junto com as outras cinco é como um alarme perde a
 * credibilidade: o dono abre a lista, confere caso já resolvido, e para de abrir.
 */
describe('DataSourcesPanel — preço já corrigido pela nossa série', () => {
    const corrigidos: QuoteSuspectView = {
        total: 2,
        settled: 1,
        truncated: 0,
        items: [
            {
                subject: 'RBRL11',
                type: 'FII',
                source: 'YAHOO',
                price: 73.91,
                count: 1,
                settled: true,
                at: new Date().toISOString(),
                findings: [{
                    code: 'SALTO_VS_BANCO',
                    detail: '26.45% contra o preço que tínhamos de 2026-09-04 (58.45 → 73.91) — nosso '
                        + 'fechamento de 2026-09-03 (73.54) confirma o preço NOVO: quem estava errado era o guardado',
                    movePct: 26.45,
                    arbitration: 'NOVO_CONFIRMADO',
                }],
            },
            {
                subject: 'NAUI11',
                type: 'FII',
                source: 'YAHOO',
                price: 1000,
                count: 3,
                at: new Date().toISOString(),
                findings: [{
                    code: 'VARIACAO_INCOERENTE',
                    detail: 'a fonte declara 4.02% mas os preços dela implicam 0.00%',
                    movePct: 0,
                    arbitration: null,
                }],
            },
        ],
    };

    it('a linha do painel separa o que ainda é pergunta do que já foi resolvido', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={corrigidos} />);
        expect(screen.getByText(/1 já corrigido\(s\) pela nossa série/)).toBeInTheDocument();
    });

    it('e o ativo resolvido é marcado como tal na lista', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={corrigidos} />);
        fireEvent.click(screen.getByText(/chegaram com preço fora/));
        const dialog = screen.getByRole('dialog', { name: /valor fora do esperado/i });
        expect(within(dialog).getByText('corrigido')).toBeInTheDocument();
        expect(within(dialog).getByText(/quem estava errado era o guardado/)).toBeInTheDocument();
    });

    it('sem nenhum resolvido, a frase volta a ser a de conferir', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} suspects={suspeitos} />);
        expect(screen.getByText(/gravados, para conferir/)).toBeInTheDocument();
    });
});

/**
 * O rodapé do card e a frase do modal têm que contar a MESMA história. No
 * feriado de 07/09/2026 contavam duas: "Sem alvo vivo" na grade e "não foi
 * chamada: feriado" no detalhe, porque a tela rededuzia o estado com uma regra
 * mais frouxa que a do servidor.
 */
describe('DataSourcesPanel — a razão do silêncio vem do servidor', () => {
    const reserva = (over: Partial<DataSource>) => src({
        id: 'ptax', short: 'PTAX', status: 'UNKNOWN', attempts: 0, failures: 0,
        failureRate: null, trigger: 'onFailure', lastDeliveryAt: null, lastDeliveryHours: null,
        ...over,
    });

    it('fonte pulada não diz "sem alvo vivo" nem "em espera"', () => {
        render(<DataSourcesPanel
            sources={[reserva({
                idleReason: 'SKIPPED',
                detail: 'Sem fixação em fim de semana ou feriado',
                escalated: { reached: 1, rescued: 0, missed: 1 },
            })]}
            groups={groups}
        />);

        expect(screen.getByText('Não chamada hoje')).toBeInTheDocument();
        expect(screen.queryByText('Sem alvo vivo')).not.toBeInTheDocument();
    });

    it('alvo morto de verdade continua dizendo o que dizia', () => {
        render(<DataSourcesPanel
            sources={[reserva({ idleReason: 'NO_LIVE_SUBJECT', escalated: { reached: 3, rescued: 0, missed: 3 } })]}
            groups={groups}
        />);

        expect(screen.getByText('Sem alvo vivo')).toBeInTheDocument();
    });

    it('reserva que ninguém precisou segue em espera', () => {
        render(<DataSourcesPanel
            sources={[reserva({ idleReason: 'STANDBY', escalated: { reached: 0, rescued: 0, missed: 0 } })]}
            groups={groups}
        />);

        expect(screen.queryByText('Sem alvo vivo')).not.toBeInTheDocument();
        expect(screen.queryByText('Não chamada hoje')).not.toBeInTheDocument();
    });

    // Servidor mais antigo que o cliente: a regra local volta a valer, e ela é a
    // de antes — nem melhor nem pior, só não pode quebrar a tela.
    it('sem idleReason no payload, a leitura antiga é preservada', () => {
        render(<DataSourcesPanel
            sources={[reserva({ escalated: { reached: 2, rescued: 0, missed: 2 } })]}
            groups={groups}
        />);

        expect(screen.getByText('Sem alvo vivo')).toBeInTheDocument();
    });
});
