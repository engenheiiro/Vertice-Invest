import { describe, it, expect } from 'vitest';
import { businessDaysBetween, MAX_SNAPSHOT_GAP_SCAN_DAYS } from '../utils/walletSnapshot.js';

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: selo "Auditado / Estimado" da Rentabilidade Real (TWRR).
//
// Bug original: `computeWalletMetrics` rebaixava o selo quando o snapshot-âncora
// tinha mais de 3 DIAS CORRIDOS. A régua não conhecia fim de semana nem feriado,
// então bastava um feriadão para acusar carteira sadia:
//
//   terça 08/09/2026, 14h BRT — âncora = sexta 04/09 (último pregão, porque
//   sáb 05, dom 06 e a Independência na seg 07 não têm fechamento).
//   Idade do âncora: 3,6 dias corridos → "Estimado", com ZERO fechamentos
//   faltando. (Carteira real: TWRR +2,43% marcada como estimada.)
//
// A régua correta conta FECHAMENTOS QUE FALTAM — a mesma lista que o backfill
// usa para decidir o que reconstruir. Sem nada a preencher, não há buraco.
// ─────────────────────────────────────────────────────────────────────────────

// Réplica da decisão do controller (a matemática toda vive em businessDaysBetween).
const sealFor = (anchorDayKey, todayKey) =>
    businessDaysBetween(anchorDayKey, todayKey).length > 0 ? 'ESTIMATED' : 'AUDITED';

describe('Selo do TWRR — feriado e fim de semana não são buraco', () => {
    it('terça após o 7 de Setembro: âncora na sexta continua AUDITADO', () => {
        // O caso que apareceu na tela. Antes: 3,6 dias corridos → ESTIMATED.
        expect(businessDaysBetween('2026-09-04', '2026-09-08')).toEqual([]);
        expect(sealFor('2026-09-04', '2026-09-08')).toBe('AUDITED');
    });

    it('segunda comum: âncora na sexta continua AUDITADO', () => {
        expect(sealFor('2026-09-11', '2026-09-14')).toBe('AUDITED');
    });

    it('durante o pregão, a ausência do snapshot de HOJE não conta', () => {
        // O snapshot do dia só nasce às 23:59 BRT — cobrá-lo às 14h rebaixaria
        // toda carteira, todo dia.
        expect(sealFor('2026-09-09', '2026-09-10')).toBe('AUDITED');
    });

    it('âncora do próprio dia (após o cron das 23:59) é AUDITADO', () => {
        expect(sealFor('2026-09-10', '2026-09-10')).toBe('AUDITED');
    });
});

describe('Selo do TWRR — fechamento que falta ainda rebaixa', () => {
    it('um pregão sem snapshot cai para ESTIMADO', () => {
        // Âncora na quarta, hoje é sexta: a quinta deveria existir e não existe.
        expect(businessDaysBetween('2026-09-09', '2026-09-11')).toEqual(['2026-09-10']);
        expect(sealFor('2026-09-09', '2026-09-11')).toBe('ESTIMATED');
    });

    it('série parada há semanas cai para ESTIMADO', () => {
        expect(sealFor('2026-08-03', '2026-09-08')).toBe('ESTIMATED');
    });

    it('feriado no meio do buraco não é cobrado como fechamento', () => {
        // Quinta 03/09 → sexta 11/09: faltam 04, 08, 09 e 10. O 07 (Independência)
        // e os fins de semana ficam de fora.
        expect(businessDaysBetween('2026-09-03', '2026-09-11'))
            .toEqual(['2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10']);
    });
});

describe('businessDaysBetween — bordas', () => {
    it('não olha para trás quando o âncora é posterior a hoje', () => {
        expect(businessDaysBetween('2026-09-10', '2026-09-08')).toEqual([]);
    });

    it('chave inválida não estoura nem inventa buraco', () => {
        expect(businessDaysBetween(null, '2026-09-08')).toEqual([]);
        expect(businessDaysBetween('2026-09-04', undefined)).toEqual([]);
        expect(businessDaysBetween('04/09/2026', '2026-09-08')).toEqual([]);
    });

    it('buraco enorme para de ser medido no teto de varredura', () => {
        const gap = businessDaysBetween('2020-01-02', '2026-09-08');
        expect(gap.length).toBeLessThanOrEqual(MAX_SNAPSHOT_GAP_SCAN_DAYS);
        expect(gap.length).toBeGreaterThan(0); // ainda diz "há buraco"
    });
});
