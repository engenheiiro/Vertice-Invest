/**
 * Fix 7 — melhor perfil de ativo FORA do ranking (Auditoria Completa).
 * Empate cai no mais conservador (DEFENSIVE > MODERATE > BOLD) e ativo com todos
 * os scores zerados não ganha perfil ("BOLD 0" era um perfil que ele nunca teve).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/DiscardLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/rankingTxtExportService.js', () => ({ rankingTxtExportService: {} }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { pickBestAuditProfile } = await import('../services/aiResearchService.js');

describe('pickBestAuditProfile', () => {
    it('escolhe o maior score', () => {
        expect(pickBestAuditProfile({ DEFENSIVE: 40, MODERATE: 62, BOLD: 55 })).toEqual(['MODERATE', 62]);
    });

    it('empate prefere DEFENSIVE > MODERATE > BOLD, independente da ordem das chaves', () => {
        expect(pickBestAuditProfile({ BOLD: 60, MODERATE: 60, DEFENSIVE: 60 })).toEqual(['DEFENSIVE', 60]);
        expect(pickBestAuditProfile({ BOLD: 60, MODERATE: 60, DEFENSIVE: 10 })).toEqual(['MODERATE', 60]);
    });

    it('todos zerados (ou ausentes) → null, sem perfil', () => {
        expect(pickBestAuditProfile({ DEFENSIVE: 0, MODERATE: 0, BOLD: 0 })).toBeNull();
        expect(pickBestAuditProfile({})).toBeNull();
        expect(pickBestAuditProfile(undefined)).toBeNull();
    });
});
