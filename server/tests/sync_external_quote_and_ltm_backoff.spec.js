/**
 * syncService:
 *  - Exterior/cripto NÃO têm mais escrita de cotação própria na Etapa 2: o
 *    `refreshQuotesBatch` (com os juízes de eco/sessão velha/sem negócio) é o
 *    único escritor de preço, e a lista inteira segue para ele.
 *  - Enriquecimento LTM tem backoff de 30 dias para quem respondeu "nada".
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    buildLtmCandidateFilter,
    buildLtmEnrichOp,
    LTM_ENRICH_BACKOFF_DAYS,
} from '../services/syncService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '../services/syncService.js'), 'utf8');

describe('cotação de exterior/cripto: um escritor só', () => {
    it('o sync não cota por conta própria (sem getQuotes, sem isActive:true de cotação)', () => {
        expect(source).not.toMatch(/externalMarketService\.getQuotes/);
        expect(source).not.toMatch(/liquidity\s*=\s*quote\.volume/);
    });

    it('a lista de exterior/cripto entra na segunda passada (refreshQuotesBatch)', () => {
        expect(source).toMatch(/validTickers\.push\(\.\.\.externalTickers\)/);
    });
});

describe('LTM — candidatos com backoff', () => {
    it('exclui quem foi tentado sem resultado dentro da janela', () => {
        const now = new Date('2026-11-22T12:00:00Z');
        const filter = buildLtmCandidateFilter(now);
        const backoff = filter.$and[1].$or;
        expect(backoff[0]).toEqual({ ltmEnrichAttemptedAt: null });
        const cutoff = backoff[1].ltmEnrichAttemptedAt.$lt;
        expect(now - cutoff).toBe(LTM_ENRICH_BACKOFF_DAYS * 24 * 60 * 60 * 1000);
        expect(filter.type).toBe('STOCK');
    });
});

describe('LTM — operação por ativo', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const asset = { ticker: 'ABCD3', netRevenue: 0, netIncome: null, marketCap: 0, patrimLiq: 0 };

    it('falha transitória (null) não grava nada — nem o carimbo', () => {
        expect(buildLtmEnrichOp(asset, null, now)).toBeNull();
    });

    it('resposta sem nada aproveitável grava SÓ o carimbo de tentativa', () => {
        const op = buildLtmEnrichOp(asset, {}, now);
        expect(op.enriched).toBe(false);
        expect(op.updateOne.update).toEqual({ $set: { ltmEnrichAttemptedAt: now } });
    });

    it('campo novo é gravado e não inicia backoff', () => {
        const op = buildLtmEnrichOp(asset, { netRevenue: 1e9 }, now);
        expect(op.enriched).toBe(true);
        expect(op.updateOne.update.$set).toEqual({ netRevenue: 1e9 });
    });

    it('não sobrescreve campo já preenchido', () => {
        const op = buildLtmEnrichOp({ ...asset, netRevenue: 5e8 }, { netRevenue: 1e9 }, now);
        expect(op.enriched).toBe(false);
    });
});
