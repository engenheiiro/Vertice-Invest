
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
        // 1. Cenário: Ativo Líquido e Saudável (Margem > -5)
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
            sector: 'Tecnologia'
        };

        // 2. Cenário: Queda abrupta de preço (RSI vai pro chão)
        // Aumentado para 60 dias para passar na validação de liquidez/histórico do engine (>50)
        const mockHistory = {
            history: Array.from({ length: 60 }, (_, i) => ({
                date: new Date(Date.now() - i * 86400000),
                close: 50 + (i * 2), // Preço era maior no passado e caiu até chegar a 50 hoje
                adjClose: 50 + (i * 2)
            }))
        };

        // Mocks de Banco de Dados
        MarketAsset.countDocuments.mockResolvedValue(1); // Health check pass
        MarketAsset.find.mockResolvedValue([mockAsset]);
        
        // CORREÇÃO CRÍTICA: Mockar a cadeia .lean() do Mongoose
        // O engine chama: AssetHistory.findOne(...).lean()
        const leanMock = vi.fn().mockResolvedValue(mockHistory);
        AssetHistory.findOne.mockReturnValue({
            lean: leanMock
        });

        QuantSignal.findOne.mockResolvedValue(null); // Não existe sinal duplicado
        
        // Espião no Create
        const createSpy = vi.spyOn(QuantSignal, 'create').mockResolvedValue(true);

        // 3. Execução
        const result = await signalEngine.runScanner();

        // 4. Asserção
        expect(result.success).toBe(true);
        expect(result.signals).toBe(1);
        
        // Verifica se o sinal gerado foi do tipo correto
        expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
            ticker: 'TEST3',
            type: 'RSI_OVERSOLD',
            // RSI deve ser baixo numa queda dessa magnitude
        }));
        
        const callArgs = createSpy.mock.calls[0][0];
        // console.log(`📊 [Regression Test] RSI Calculado: ${callArgs.value.toFixed(2)}`);
        expect(callArgs.value).toBeLessThan(30); // Deve ser oversold
    });

    it('Should trigger Safety Switch on empty liquidity', async () => {
        // Mock DB vazio
        MarketAsset.countDocuments.mockResolvedValue(0);

        const result = await signalEngine.runScanner();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Base de dados parece vazia");
    });

});
