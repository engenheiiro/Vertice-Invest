
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signalEngine } from '../services/engines/signalEngine.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import QuantSignal from '../models/QuantSignal.js';

// Mocks do Mongoose
vi.mock('../models/MarketAsset.js');
vi.mock('../models/AssetHistory.js');
vi.mock('../models/QuantSignal.js');
vi.mock('../config/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('Quantitative Regression Engine', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Should detect RSI Oversold condition (Market Crash Simulation)', async () => {
        // 1. Cenário: Ativo Líquido e Saudável
        const mockAsset = {
            ticker: 'TEST3',
            type: 'STOCK',
            lastPrice: 50.00,
            liquidity: 10000000,
            netMargin: 10,
            isActive: true,
            isIgnored: false,
            isBlacklisted: false,
            marketCap: 5000000000,
            sector: 'Tecnologia',
            pl: 10,
            p_vp: 1.5,
            debtToEquity: 0.5
        };

        // 2. Cenário: Queda abrupta de preço (RSI vai pro chão)
        const mockHistory = {
            ticker: 'TEST3',
            history: Array.from({ length: 60 }, (_, i) => ({
                date: new Date(Date.now() - i * 86400000),
                close: 50 + (i * 2), // Caiu de ~170 para 50
                adjClose: 50 + (i * 2)
            }))
        };

        // --- MOCKS CORRETOS PARA CADEIA MONGOOSE (.find().lean()) ---
        
        // Mock para MarketAsset.find(...).lean()
        const marketAssetQuery = {
            lean: vi.fn().mockResolvedValue([mockAsset]),
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis()
        };
        MarketAsset.find.mockReturnValue(marketAssetQuery);
        
        // Mock para AssetHistory.find(...).select(...).lean()
        const assetHistoryQuery = {
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([mockHistory])
        };
        AssetHistory.find.mockReturnValue(assetHistoryQuery);

        // Mock para QuantSignal.find(...).select(...).lean() (Sinais Ativos)
        const quantSignalQuery = {
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]) // Nenhum sinal ativo prévio
        };
        QuantSignal.find.mockReturnValue(quantSignalQuery);
        
        // Espiões de Escrita
        const insertSpy = vi.spyOn(QuantSignal, 'insertMany').mockResolvedValue(true);
        const bulkSpy = vi.spyOn(QuantSignal, 'bulkWrite').mockResolvedValue(true);

        // 3. Execução
        const result = await signalEngine.runScanner();

        // 4. Asserção
        expect(result.success).toBe(true);
        // Espera-se 1 sinal novo (RSI Oversold)
        expect(result.signals).toBe(1);
        
        // Verifica payload
        expect(insertSpy).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({
                ticker: 'TEST3',
                type: 'RSI_OVERSOLD'
            })
        ]));
        
        // Opcional: Verificar valor do RSI no log ou payload
        const payload = insertSpy.mock.calls[0][0];
        expect(payload[0].value).toBeLessThan(30); // Deve ser oversold
    });

    it('Should handle empty database gracefully', async () => {
        // Mock DB vazio (retorna array vazio no lean)
        const emptyQuery = {
            lean: vi.fn().mockResolvedValue([]),
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis()
        };
        MarketAsset.find.mockReturnValue(emptyQuery);

        const result = await signalEngine.runScanner();

        // Comportamento esperado: Sucesso, mas 0 sinais analisados
        expect(result.success).toBe(true);
        expect(result.signals).toBe(0);
        expect(result.analyzed).toBe(0);
    });

});
