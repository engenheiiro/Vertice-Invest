import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signalEngine } from '../services/engines/signalEngine.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import QuantSignal from '../models/QuantSignal.js';

// Mocks do Mongoose + dependências externas (teste 100% determinístico, sem rede/DB).
vi.mock('../models/MarketAsset.js');
vi.mock('../models/AssetHistory.js');
vi.mock('../models/QuantSignal.js');
vi.mock('../models/SystemConfig.js');
vi.mock('../services/externalMarketService.js', () => ({
    externalMarketService: {
        // getMacroContext consome isto; [] => contexto macro neutro, sem chamada de rede.
        getQuotes: vi.fn().mockResolvedValue([]),
    },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('Quantitative Regression Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Detecta RSI Oversold com reversão confirmada (UPSERT via bulkWrite)', async () => {
        // Ativo líquido e saudável (passa nos gates de elegibilidade do scanner).
        const mockAsset = {
            ticker: 'TEST3',
            type: 'STOCK',
            lastPrice: 41.0,
            liquidity: 10_000_000,
            netMargin: 10,
            isActive: true,
            isIgnored: false,
            isBlacklisted: false,
            marketCap: 5_000_000_000,
            sector: 'Tecnologia',
            pl: 10,
            p_vp: 1.5,
            // roe ausente de propósito → não dispara o CHECK 2 (Deep Value), isolando o RSI.
        };

        // Série (mais recente → mais antiga): queda forte (RSI baixo) com repique hoje
        // (closes[0]=41 > closes[1]=40) para satisfazer a "reversão confirmada".
        const closesDesc = [41, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110];
        const mockHistory = {
            ticker: 'TEST3',
            history: closesDesc.map((close, i) => ({
                date: new Date(Date.now() - i * 86_400_000),
                close,
                adjClose: close,
            })),
        };

        // --- Cadeia Mongoose: MarketAsset.find(...).lean() ---
        MarketAsset.find.mockReturnValue({
            lean: vi.fn().mockResolvedValue([mockAsset]),
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
        });

        // AssetHistory.find(...).lean()
        AssetHistory.find.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([mockHistory]),
        });

        // QuantSignal.find({status:'ACTIVE'}).select(...).lean() → nenhum sinal ativo prévio
        QuantSignal.find.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        });
        QuantSignal.countDocuments = vi.fn().mockResolvedValue(1);
        const bulkSpy = vi.spyOn(QuantSignal, 'bulkWrite').mockResolvedValue(true);

        // Execução
        const result = await signalEngine.runScanner();

        // Asserções
        expect(result.success).toBe(true);
        expect(result.signals).toBe(1);

        // Persistência via bulkWrite com upsert do sinal RSI_OVERSOLD e RSI < 30.
        expect(bulkSpy).toHaveBeenCalledTimes(1);
        const ops = bulkSpy.mock.calls[0][0];
        const rsiOp = ops.find((o) => o.updateOne?.filter?.type === 'RSI_OVERSOLD');
        expect(rsiOp).toBeTruthy();
        expect(rsiOp.updateOne.filter.ticker).toBe('TEST3');
        expect(rsiOp.updateOne.update.$set.value).toBeLessThan(30);
    });

    it('Lida com banco vazio sem gerar sinais', async () => {
        MarketAsset.find.mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
        });

        const result = await signalEngine.runScanner();

        expect(result.success).toBe(true);
        expect(result.signals).toBe(0);
        expect(result.analyzed).toBe(0);
    });
});
