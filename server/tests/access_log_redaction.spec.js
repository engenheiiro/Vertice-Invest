/**
 * O token do link público de carteira (`/api/public/wallet/<token>`) é a ÚNICA
 * credencial da carteira compartilhada. Ele saía inteiro em toda linha de log de
 * acesso — quem lia o log abria a carteira.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({ default: { http: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { redactLogPath } = await import('../middleware/accessLog.js');

describe('redactLogPath', () => {
    it('esconde token opaco longo', () => {
        expect(redactLogPath('/api/public/wallet/9f2c1b7e4a8d4c3e9b1a7f6e5d4c3b2a'))
            .toBe('/api/public/wallet/:redacted');
    });

    it('esconde e-mail no caminho', () => {
        expect(redactLogPath('/api/admin/users/fulano@exemplo.com')).toBe('/api/admin/users/:redacted');
        expect(redactLogPath('/api/admin/users/fulano%40exemplo.com')).toBe('/api/admin/users/:redacted');
    });

    it('mantém ObjectId, ticker e rota legíveis', () => {
        expect(redactLogPath('/api/wallet/transactions/PETR4')).toBe('/api/wallet/transactions/PETR4');
        expect(redactLogPath('/api/support/tickets/65f1a2b3c4d5e6f7a8b9c0d1')).toBe('/api/support/tickets/65f1a2b3c4d5e6f7a8b9c0d1');
    });

    it('entrada vazia não quebra', () => {
        expect(redactLogPath(undefined)).toBe('');
    });
});
