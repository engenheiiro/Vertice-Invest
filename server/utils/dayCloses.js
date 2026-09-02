import AssetHistory from '../models/AssetHistory.js';
import { historyStorageKey } from './assetHistory.js';

/**
 * Fechamentos de UM dia (AssetHistory) para um conjunto de posições.
 *
 * Fonte ÚNICA compartilhada entre o snapshot diário (que MARCA o patrimônio do
 * dia por estes candles) e o KPI ao vivo (que precisa do MESMO número como
 * âncora do "início do dia"). Enquanto as duas pontas liam fontes diferentes —
 * candle gravado de um lado, `previousClose` do provedor do outro — a identidade
 * `patrimônio de ontem + variação de hoje = patrimônio de hoje` não fechava, e a
 * tela exibia "Variação Hoje +R$ 7,97" com o patrimônio R$ 8,14 menor.
 *
 * Só o candle do dia pedido é projetado: hidratar os arrays de ~400 candles de
 * toda a base seria caro à toa.
 *
 * @param {Array<{ticker: string, type: string}>} assetRefs
 * @param {string} dayStr YYYY-MM-DD
 * @returns {Promise<Map<string, number>>} chave de armazenamento → fechamento
 */
export const loadClosesForDay = async (assetRefs, dayStr) => {
    if (!dayStr) return new Map();
    const keys = [...new Set((assetRefs || []).map((a) => historyStorageKey(a.ticker, a.type)).filter(Boolean))];
    if (keys.length === 0) return new Map();

    const rows = await AssetHistory.aggregate([
        { $match: { ticker: { $in: keys } } },
        {
            $project: {
                ticker: 1,
                candle: {
                    $first: {
                        $filter: { input: { $ifNull: ['$history', []] }, as: 'h', cond: { $eq: ['$$h.date', dayStr] } },
                    },
                },
            },
        },
        { $match: { 'candle.close': { $gt: 0 } } },
    ]);
    return new Map(rows.map((r) => [r.ticker, r.candle.close]));
};
