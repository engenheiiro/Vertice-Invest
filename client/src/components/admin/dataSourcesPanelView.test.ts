import { describe, it, expect, vi, afterAll } from 'vitest';
import {
    VOCAB_PADRAO, agoLabel, absoluteTime, capitalizar, chainPassage, footerInfo, hasNoBackup,
    quietPassageText, reachedPassageText, shortTime, sinceLabel, visualFor,
} from './dataSourcesPanelView';
import type { ChainEscalation, ChainFlow, DataSource } from '../../services/health';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T14:00:00-03:00'));
afterAll(() => { vi.useRealTimers(); });

const src = (over: Partial<DataSource>): DataSource => ({
    id: 'x', label: 'X', feeds: 'f', critical: false, status: 'OK', detail: '', lastDeliveryAt: null,
    lastDeliveryHours: null, attempts: 0, failures: 0, failureRate: null, lastError: null, lastFailAt: null, ...over,
});
const esc = (over: Partial<ChainEscalation>): ChainEscalation => ({
    subject: 'A', tried: ['x'], resolvedBy: null, reason: null, expected: false, count: 1, at: '', ...over,
});

describe('sinceLabel', () => {
    it.each([
        [null, '—'], [0.01, 'agora'], [0.02, '1 min'], [0.5, '30 min'], [1, '1h'], [47.4, '47h'], [48, '2d'],
    ] as const)('%s → %s', (h, esperado) => {
        expect(sinceLabel(h)).toBe(esperado);
    });
});

describe('agoLabel / absoluteTime / shortTime', () => {
    it('agoLabel mede a idade contra o relógio e rejeita vazio ou inválido', () => {
        expect(agoLabel('2026-11-18T10:00:00-03:00')).toBe('4h');
        expect(agoLabel(null)).toBeNull();
        expect(agoLabel('lixo')).toBeNull();
    });

    it('absoluteTime devolve null sem data válida; shortTime devolve traço', () => {
        expect(absoluteTime(undefined)).toBeNull();
        expect(absoluteTime('lixo')).toBeNull();
        expect(absoluteTime('2026-11-18T10:00:00-03:00')).toMatch(/18\/11/);
        expect(shortTime('lixo')).toBe('—');
    });
});

describe('footerInfo e visualFor', () => {
    it('estado julgado usa o rótulo do estado e o relógio de entrega, depois o de resposta', () => {
        expect(footerInfo(src({ status: 'CRITICAL', lastDeliveryHours: 2 }))).toEqual({ label: 'Sem receber', time: '2h' });
        expect(footerInfo(src({ status: 'WARN', lastResponseHours: 0.5 }))).toEqual({ label: 'Instável', time: '30 min' });
    });

    it('UNKNOWN: SKIPPED > sem alvo vivo > em espera > aguardando', () => {
        expect(footerInfo(src({ status: 'UNKNOWN', idleReason: 'SKIPPED', trigger: 'onFailure' })).label).toBe('Não chamada hoje');
        expect(footerInfo(src({ status: 'UNKNOWN', idleReason: 'NO_LIVE_SUBJECT' })).label).toBe('Sem alvo vivo');
        expect(footerInfo(src({ status: 'UNKNOWN', trigger: 'onFailure', escalated: { reached: 1, rescued: 0, missed: 1 } })).label)
            .toBe('Sem alvo vivo');
        expect(footerInfo(src({ status: 'UNKNOWN', trigger: 'onFailure' }))).toEqual({ label: 'Em espera', time: 'reserva' });
        expect(footerInfo(src({ status: 'UNKNOWN', nextRun: 'em 5 min' }))).toEqual({ label: 'Aguardando', time: 'em 5 min' });
    });

    it('a decisão do servidor vence o fallback local: idleReason presente desliga "Sem alvo vivo"', () => {
        const s = src({ status: 'UNKNOWN', trigger: 'onFailure', idleReason: 'STANDBY', escalated: { reached: 3, rescued: 0, missed: 3 } });
        expect(footerInfo(s).label).toBe('Em espera');
    });

    it('reserva parada é azul; agendada sem notícia é cinza', () => {
        expect(visualFor(src({ status: 'UNKNOWN', trigger: 'onFailure' })).dot).toBe('bg-blue-500');
        expect(visualFor(src({ status: 'UNKNOWN', trigger: 'scheduled' })).dot).toBe('bg-slate-600');
        expect(visualFor(src({ status: 'OK', trigger: 'onFailure' })).dot).toBe('bg-emerald-500');
    });
});

describe('cobertura', () => {
    it('sem backup e sem cobrir ninguém = ponto único de falha', () => {
        expect(hasNoBackup(src({}))).toBe(true);
        expect(hasNoBackup(src({ backups: [], covers: 'Yahoo' }))).toBe(false);
        expect(hasNoBackup(src({ backups: ['A'] }))).toBe(false);
    });

    it('capitalizar', () => {
        expect(capitalizar('ativo')).toBe('Ativo');
    });
});

describe('trajeto por ativo', () => {
    const flow = {
        items: [
            esc({ subject: 'SALVO', resolvedBy: 'x' }),
            esc({ subject: 'SEGUIU', tried: ['x', 'y'], resolvedBy: 'y' }),
            esc({ subject: 'ORFAO', tried: ['x', 'y'] }),
            esc({ subject: 'PULADO', tried: ['x', 'y'], skipped: ['x'], resolvedBy: 'y' }),
            esc({ subject: 'ALHEIO', tried: ['y'], resolvedBy: 'y' }),
        ],
    } as ChainFlow;

    it('separa os três destinos e ignora quem foi pulado ou não passou por aqui', () => {
        expect(chainPassage(src({}), flow)).toEqual({ salvos: ['SALVO'], seguiram: ['SEGUIU'], semPreco: ['ORFAO'] });
    });

    it('sem fluxo, ninguém passou', () => {
        expect(chainPassage(src({}))).toEqual({ salvos: [], seguiram: [], semPreco: [] });
    });

    it('frase do silêncio: pulados, 1ª da cadeia, demais', () => {
        expect(quietPassageText(src({}), VOCAB_PADRAO, 3))
            .toBe('3 assunto(s) passaram pela cadeia sem que esta fonte fosse consultada.');
        expect(quietPassageText(src({ chainPosition: 1 }), VOCAB_PADRAO, 0))
            .toBe('Nenhum assunto precisou de reserva: esta fonte resolveu todos.');
        expect(quietPassageText(src({ chainPosition: 2 }), VOCAB_PADRAO, 0))
            .toBe('Nenhum assunto chegou até aqui — a fonte anterior deu conta de todos.');
    });

    it('frase de quem chegou: 1ª desce para a reserva; demais fazem o balanço', () => {
        expect(reachedPassageText(src({ chainPosition: 1 }), VOCAB_PADRAO, { rescued: 1, missed: 2 }))
            .toBe(' assunto(s) ficaram sem dado aqui e desceram para a reserva');
        expect(reachedPassageText(src({ chainPosition: 3 }), VOCAB_PADRAO, { rescued: 1, missed: 2 }))
            .toBe(' assunto(s) chegaram até aqui · 1 foram resolvidos por esta fonte · 2 não');
    });
});
