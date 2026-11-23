import { describe, it, expect, vi, afterAll } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { DataSourcesPanel } from './DataSourcesPanel';
import type { ChainEscalation, ChainFlow, DataSource } from '../../services/health';

// Caracterização do detalhe da fonte (e do rodapé do card que ele repete): trava
// o que a tela mostra HOJE em cada ramo, para a refatoração não mudar nada.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T14:00:00-03:00'));
afterAll(() => { vi.useRealTimers(); });

const src = (over: Partial<DataSource>): DataSource => ({
    id: 'x', label: 'Fonte X', short: 'X', role: 'Fonte principal', group: 'g', feeds: 'Preço de ações',
    critical: true, status: 'OK', detail: 'frase do servidor', lastDeliveryAt: '2026-11-18T16:30:00.000Z',
    lastDeliveryHours: 0.5, attempts: 10, failures: 0, failureRate: 0, lastError: null, lastFailAt: null, ...over,
});
const esc = (over: Partial<ChainEscalation>): ChainEscalation => ({
    subject: 'AAA3', tried: ['x'], resolvedBy: null, reason: null, expected: false, count: 1,
    at: '2026-11-18T15:00:00.000Z', ...over,
});
const vocab: ChainFlow['vocabulary'] = {
    noun: 'ativo', none: 'Nenhum ativo', rescued: 'foram salvos aqui', allFromPrimary: 'a principal deu conta',
    missingBadge: 'sem preço', missingLong: 'sem preço em nenhuma',
};
const flow = (over: Partial<ChainFlow>): ChainFlow => ({
    chain: 'quotes', total: 3, unresolved: 1, expected: 0, byResolver: [], items: [], truncated: 0,
    lastAt: null, vocabulary: vocab, ...over,
});
const items = [
    esc({ subject: 'SALVO3', tried: ['x'], resolvedBy: 'x' }),
    esc({ subject: 'SEGUIU3', tried: ['x', 'y'], resolvedBy: 'y' }),
    esc({ subject: 'ORFAO3', tried: ['x', 'y'], resolvedBy: null }),
    esc({ subject: 'PULADO3', tried: ['x', 'y'], skipped: ['x'], resolvedBy: 'y' }),
    esc({ subject: 'ALHEIO3', tried: ['y'], resolvedBy: 'y' }),
];
const chained = { chain: 'quotes', chainPosition: 2, chainSize: 3 };

const cardFooter = (over: Partial<DataSource>) => {
    cleanup();
    const { container } = render(<DataSourcesPanel sources={[src(over)]} />);
    const card = container.querySelector('button[aria-pressed]');
    return card?.textContent ?? '';
};
const openDetail = (over: Partial<DataSource>, f?: ChainFlow) => {
    cleanup();
    render(<DataSourcesPanel sources={[src(over)]} chains={f ? { quotes: f } : undefined} />);
    fireEvent.click(screen.getByRole('button', { pressed: false }));
    return within(screen.getByRole('dialog'));
};
const dialogText = (over: Partial<DataSource>, f?: ChainFlow) => {
    openDetail(over, f);
    return screen.getByRole('dialog').textContent ?? '';
};

describe('rodapé do card por estado', () => {
    it.each([
        ['OK', 'Recebendo'],
        ['WARN', 'Instável'],
        ['CRITICAL', 'Sem receber'],
    ] as const)('%s mostra o rótulo do estado e a idade da entrega', (status, label) => {
        expect(cardFooter({ status })).toContain(`${label}30 min`);
    });

    it('sem entrega cai na última resposta, e sem as duas mostra traço', () => {
        expect(cardFooter({ status: 'WARN', lastDeliveryHours: null, lastResponseHours: 3 })).toContain('Instável3h');
        expect(cardFooter({ status: 'WARN', lastDeliveryHours: null })).toContain('Instável—');
    });

    it('UNKNOWN agendada mostra a próxima execução, ou traço sem ela', () => {
        expect(cardFooter({ status: 'UNKNOWN', nextRun: 'em 9 min' })).toContain('Aguardandoem 9 min');
        expect(cardFooter({ status: 'UNKNOWN' })).toContain('Aguardando—');
    });

    it('reserva parada diz "Em espera"', () => {
        expect(cardFooter({ status: 'UNKNOWN', trigger: 'onFailure' })).toContain('Em esperareserva');
    });

    it('idleReason SKIPPED vence qualquer outra leitura', () => {
        expect(cardFooter({ status: 'UNKNOWN', trigger: 'onFailure', idleReason: 'SKIPPED' }))
            .toContain('Não chamada hojepor decisão nossa');
    });

    it('idleReason NO_LIVE_SUBJECT diz "Sem alvo vivo" mesmo em fonte agendada', () => {
        expect(cardFooter({ status: 'UNKNOWN', idleReason: 'NO_LIVE_SUBJECT', trigger: 'scheduled' }))
            .toContain('Sem alvo vivoreserva');
    });

    it('sem idleReason, reserva que foi alcançada cai no fallback "Sem alvo vivo"', () => {
        expect(cardFooter({ status: 'UNKNOWN', trigger: 'onFailure', escalated: { reached: 2, rescued: 0, missed: 2 } }))
            .toContain('Sem alvo vivoreserva');
    });

    it('com idleReason presente, o servidor manda: reserva alcançada continua "Em espera"', () => {
        expect(cardFooter({
            status: 'UNKNOWN', trigger: 'onFailure', idleReason: 'STANDBY', escalated: { reached: 2, rescued: 0, missed: 2 },
        })).toContain('Em esperareserva');
    });

    it.each(['NOT_YET', 'DELIVERED_BEFORE_RESTART'] as const)('idleReason %s em agendada fica "Aguardando"', (idleReason) => {
        expect(cardFooter({ status: 'UNKNOWN', idleReason, nextRun: 'hoje às 18:30' })).toContain('Aguardandohoje às 18:30');
    });

    it('status não-UNKNOWN ignora idleReason', () => {
        expect(cardFooter({ status: 'CRITICAL', idleReason: 'SKIPPED' })).toContain('Sem receber30 min');
    });
});

describe('detalhe da fonte: cabeçalho e faixa', () => {
    it('faixa repete o rótulo do rodapé e a frase do servidor', () => {
        const d = openDetail({ status: 'UNKNOWN', idleReason: 'SKIPPED' });
        expect(d.getByText('Não chamada hoje')).toBeInTheDocument();
        expect(d.getByText('frase do servidor')).toBeInTheDocument();
    });

    it('posição na cadeia aparece só com posição E tamanho', () => {
        expect(dialogText({ chainPosition: 2, chainSize: 3 })).toContain('2ª de 3 · Fonte principal');
        expect(dialogText({ chainPosition: 2, chainSize: null })).not.toContain('2ª de');
    });

    it('selo "essencial" só para fonte crítica', () => {
        expect(dialogText({ critical: true })).toContain('essencial');
        expect(dialogText({ critical: false })).not.toContain('essencial');
    });
});

describe('detalhe da fonte: relógios e chamadas', () => {
    it('cadência com e sem próxima execução; sem cadência a linha some', () => {
        expect(dialogText({ cadence: 'A cada 15 min', nextRun: 'em 9 min' })).toContain('A cada 15 min · próxima em 9 min');
        expect(dialogText({ cadence: 'Diário', nextRun: null })).toMatch(/Quando rodaDiárioÚltima/);
        expect(dialogText({ cadence: null })).not.toContain('Quando roda');
    });

    it('deliveryTracked false esconde a linha de entrega', () => {
        expect(dialogText({ deliveryTracked: false })).not.toContain('Última entrega');
    });

    it('entrega medida sem carimbo diz que nada gravado veio desta fonte', () => {
        expect(dialogText({ deliveryTracked: true, lastDeliveryAt: null }))
            .toContain('Última entreganada gravado veio desta fonte agora');
        expect(dialogText({ lastDeliveryAt: null })).toContain('nada gravado veio desta fonte agora');
    });

    it('entrega com carimbo mostra a idade', () => {
        expect(dialogText({})).toMatch(/Última entrega.*\(30 min\)/);
    });

    it('última resposta cai em lastOkAt e, sem nenhum, diz "sem registro"', () => {
        expect(dialogText({ lastOkAt: '2026-11-18T16:00:00.000Z' })).toMatch(/Última resposta.*\(—\)/);
        expect(dialogText({ lastResponseAt: '2026-11-18T16:00:00.000Z', lastResponseHours: 30 })).toMatch(/\(30h\)/);
        expect(dialogText({})).toContain('Última respostasem registro');
    });

    it('data inválida vira ausência', () => {
        expect(dialogText({ lastResponseAt: 'lixo' })).toContain('Última respostasem registro');
    });

    it('chamadas só com tentativas; ok ausente vira 0', () => {
        expect(dialogText({ attempts: 10, failures: 3 })).toContain('10 desde o reinício · 0 com dado · 3 sem');
        expect(dialogText({ attempts: 0 })).not.toContain('Chamadas');
    });

    it('"Não chamada" com e sem motivo', () => {
        expect(dialogText({ skipped: 3, lastSkipReason: 'feriado' })).toContain('3× por decisão nossa — feriado');
        expect(dialogText({ skipped: 2 })).toMatch(/2× por decisão nossa(?! —)/);
        expect(dialogText({ skipped: 0 })).not.toContain('Não chamada');
    });

    it('última falha: erro sem data, data sem erro, nenhum', () => {
        expect(dialogText({ lastError: 'boom' })).toContain('Última falhasem data — boom');
        expect(dialogText({ lastFailAt: '2026-11-18T12:00:00.000Z' })).toMatch(/Última falha\d/);
        expect(dialogText({})).not.toContain('Última falha');
    });
});

describe('detalhe da fonte: quem cobre', () => {
    it('sem backups e sem covers = ponto único de falha', () => {
        expect(dialogText({ backups: [], covers: null })).toContain('Não há fonte alternativa');
        expect(dialogText({})).toContain('Não há fonte alternativa');
    });

    it('cobre alguém mas não tem backup = última da cadeia', () => {
        const t = dialogText({ backups: [], covers: 'Yahoo' });
        expect(t).toContain('Esta é reserva de Yahoo.');
        expect(t).toContain('É a última da cadeia');
    });

    it('backups na ordem; backupOf vem do vocabulário quando existe', () => {
        const t = dialogText({ backups: ['A', 'B'], covers: 'Yahoo', chain: 'quotes' }, flow({ vocabulary: { ...vocab, backupOf: 'Fecha a ponta de' } }));
        expect(t).toContain('Fecha a ponta de Yahoo.');
        expect(t).toContain('Assumem, nesta ordem: A → B');
    });

    it('só backups, sem covers', () => {
        const t = dialogText({ backups: ['A'] });
        expect(t).toContain('Assumem, nesta ordem: A');
        expect(t).not.toContain('reserva de');
    });
});

describe('detalhe da fonte: quem passou por aqui', () => {
    it('sem escalated a seção some', () => {
        expect(dialogText({ escalated: null, ...chained }, flow({ items }))).not.toContain('passaram por aqui');
    });

    it('reached 0 com pulados conta os pulados (frase padrão sem skippedLine)', () => {
        expect(dialogText({ escalated: { reached: 0, rescued: 0, missed: 0, skipped: 5 }, ...chained }, flow({})))
            .toContain('5 ativo(s) passaram pela cadeia sem que esta fonte fosse consultada.');
    });

    it('reached 0 na 1ª da cadeia: ninguém precisou de reserva', () => {
        expect(dialogText({ escalated: { reached: 0, rescued: 0, missed: 0 }, chain: 'quotes', chainPosition: 1 }, flow({})))
            .toContain('Nenhum ativo precisou de reserva: a principal deu conta.');
    });

    it('reached 0 depois da 1ª: a anterior deu conta', () => {
        expect(dialogText({ escalated: { reached: 0, rescued: 0, missed: 0 }, ...chained }, flow({})))
            .toContain('Nenhum ativo chegou até aqui — a fonte anterior deu conta de todos.');
    });

    it('sem fluxo, o vocabulário padrão fala de "assunto"', () => {
        const t = dialogText({ escalated: { reached: 0, rescued: 0, missed: 0 } });
        expect(t).toContain('Assuntos que passaram por aqui');
        expect(t).toContain('Nenhum assunto chegou até aqui');
    });

    it('reached > 0 na 1ª: desceram para a reserva', () => {
        expect(dialogText({ escalated: { reached: 4, rescued: 1, missed: 3 }, chain: 'quotes', chainPosition: 1 }, flow({ items })))
            .toContain('4 ativo(s) ficaram sem preço aqui e desceram para a reserva');
    });

    it('reached > 0 depois da 1ª, com pulados', () => {
        expect(dialogText({ escalated: { reached: 4, rescued: 1, missed: 3, skipped: 2 }, ...chained }, flow({ items })))
            .toContain('4 ativo(s) chegaram até aqui · 1 foram salvos aqui · 3 não · 2 nem foram perguntados');
    });

    it('separa salvos, seguiram e sem preço pela linha do ledger; pulado e alheio ficam de fora', () => {
        const d = openDetail({ escalated: { reached: 3, rescued: 1, missed: 2 }, ...chained }, flow({ items }));
        expect(d.getByText('Resolvido por esta fonte').nextElementSibling?.textContent).toBe('SALVO3');
        expect(d.getByText('Seguiu para a próxima fonte').nextElementSibling?.textContent).toBe('SEGUIU3');
        expect(d.getByText('Ficou sem preço em fonte nenhuma').nextElementSibling?.textContent).toBe('ORFAO3');
        expect(d.queryByText('PULADO3')).toBeNull();
        expect(d.queryByText('ALHEIO3')).toBeNull();
    });

    it('grupo vazio some; "resolvido" usa a contagem do servidor e mostra "+ N"', () => {
        const d = openDetail({ escalated: { reached: 5, rescued: 3, missed: 2 }, ...chained }, flow({ items: [items[0], items[1]] }));
        expect(d.getByText('Resolvido por esta fonte').nextElementSibling?.textContent).toBe('SALVO3+ 2');
        expect(d.queryByText('Ficou sem preço em fonte nenhuma')).toBeNull();
    });

    it('rescued 0 esconde o grupo de resolvidos mesmo com tickers', () => {
        const d = openDetail({ escalated: { reached: 2, rescued: 0, missed: 2 }, ...chained }, flow({ items }));
        expect(d.queryByText('Resolvido por esta fonte')).toBeNull();
    });

    it('amostra com teto de 14 por grupo e "+ resto"', () => {
        const muitos = Array.from({ length: 16 }, (_, i) => esc({ subject: `Z${i}`, tried: ['x', 'y'], resolvedBy: 'y' }));
        const d = openDetail({ escalated: { reached: 16, rescued: 0, missed: 16 }, ...chained }, flow({ items: muitos }));
        const grupo = d.getByText('Seguiu para a próxima fonte').nextElementSibling;
        expect(grupo?.querySelectorAll('.font-mono')).toHaveLength(14);
        expect(grupo?.textContent).toContain('+ 2');
    });
});
