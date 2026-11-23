
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fmt, fmtBRL, fmtPct, line, actionLabel } from './rankingExport/formatters.js';
import { formatRankingItem } from './rankingExport/rankingItemText.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_DIR = path.resolve(__dirname, '../../reports');

const assetClassLabel = (cls) => {
    const map = { STOCK: 'AÇÕES', FII: 'FIIs', CRYPTO: 'CRIPTOMOEDAS', BRASIL_10: 'BRASIL 10', STOCK_US: 'ATIVOS GLOBAIS (S&P 500)' };
    return map[cls] || cls;
};

const formatDiscardSection = (discardLogs, assetClass) => {
    const relevant = (discardLogs || []).filter(d => d.assetType === assetClass);
    if (relevant.length === 0) return '';
    let out = `\n${line('═')}\n`;
    out += `  ATIVOS DESCARTADOS (${assetClass}) — ${relevant.length} ativos\n`;
    out += `${line('═')}\n`;
    relevant.forEach(d => {
        out += `  ${String(d.ticker).padEnd(12)}  Motivo: ${d.reason}\n`;
        if (d.details) out += `               Detalhe: ${d.details}\n`;
    });
    return out;
};

const generateTxtContent = (allData, macro) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR');
    const filename = `ranking_${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 5).replace(':', '')}.txt`;

    let txt = '';
    txt += `${line('═')}\n`;
    txt += `  VÉRTICE INVEST — RANKING QUANTITATIVO\n`;
    txt += `  Gerado em: ${dateStr} às ${timeStr}\n`;
    txt += `  ${line('─', 76)}\n`;

    if (macro) {
        txt += `  Contexto Macro:\n`;
        txt += `    SELIC:      ${fmtPct(macro.selic)}    CDI:        ${fmtPct(macro.cdi)}\n`;
        txt += `    IPCA:       ${fmtPct(macro.ipca)}    Risk Free:  ${fmtPct(macro.riskFree)}\n`;
        txt += `    NTN-B Long: ${fmtPct(macro.ntnbLong)}    Dólar:      ${fmtBRL(macro.dollar)}\n`;
        txt += `    Ibovespa:   ${fmt(macro.ibov, 0)} pts (${macro.ibovChange >= 0 ? '+' : ''}${fmtPct(macro.ibovChange)})\n`;
        txt += `    BTC:        $${fmt(macro.btc, 0)} (${macro.btcChange >= 0 ? '+' : ''}${fmtPct(macro.btcChange)})\n`;
    }
    txt += `${line('═')}\n\n`;

    const classOrder = ['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US'];

    for (const assetClass of classOrder) {
        const data = allData[assetClass];
        if (!data) continue;

        const { ranking = [], fullList = [], discardLogs = [] } = data;

        const gold = ranking.filter(r => r.tier === 'GOLD').length;
        const silver = ranking.filter(r => r.tier === 'SILVER').length;
        const bronze = ranking.filter(r => r.tier === 'BRONZE').length;
        const buys = ranking.filter(r => r.action === 'BUY').length;
        const waits = ranking.filter(r => r.action !== 'BUY').length;
        const discardCount = (discardLogs || []).filter(d => d.assetType === assetClass).length;

        txt += `\n${line('═')}\n`;
        txt += `  CLASSE: ${assetClassLabel(assetClass)}\n`;
        txt += `  Total no Ranking: ${ranking.length}   GOLD: ${gold}  SILVER: ${silver}  BRONZE: ${bronze}\n`;
        txt += `  COMPRAR: ${buys}   AGUARDAR: ${waits}   Descartados: ${discardCount}\n`;
        txt += `${line('═')}\n`;

        if (ranking.length === 0) {
            txt += `  (nenhum ativo no ranking para esta classe)\n`;
        } else {
            ranking.forEach(item => {
                txt += formatRankingItem(item);
            });
        }

        // Full audit list (ativos fora do ranking mas pontuados)
        const rankedTickers = new Set(ranking.map(r => r.ticker));
        const nonRanked = fullList.filter(a => !rankedTickers.has(a.ticker));

        if (nonRanked.length > 0) {
            txt += `\n${line('═')}\n`;
            txt += `  LISTA COMPLETA PONTUADA — FORA DO RANKING (${nonRanked.length} ativos)\n`;
            txt += `${line('═')}\n`;
            nonRanked.forEach(item => {
                const currency = item.type === 'CRYPTO' || item.type === 'STOCK_US' ? '$' : 'R$';
                const price = (item.currentPrice !== null && item.currentPrice !== undefined)
                    ? `${currency} ${Number(item.currentPrice).toFixed(2)}`
                    : 'N/D';
                const d = item.scores || {};
                txt += `  ${String(item.ticker).padEnd(10)}  Score: ${fmt(item.score, 1).padStart(5)}/100`;
                txt += `  D:${fmt(d['DEFENSIVE'], 0).padStart(3)}  M:${fmt(d['MODERATE'], 0).padStart(3)}  B:${fmt(d['BOLD'], 0).padStart(3)}`;
                txt += `  ${actionLabel(item.action).padEnd(14)}  ${price.padEnd(14)}  ${item.sector || 'N/D'}\n`;
                if (item.auditLog && item.auditLog.length > 0) {
                    const pts = item.auditLog.map(e => {
                        const sign = e.points > 0 ? `+${e.points}` : `${e.points}`;
                        return `${e.factor}(${sign})`;
                    }).join(' | ');
                    txt += `             Audit: ${pts}\n`;
                }
            });
        }

        txt += formatDiscardSection(discardLogs, assetClass);
    }

    txt += `\n\n${line('═')}\n`;
    txt += `  FIM DO RELATÓRIO  |  ${dateStr} ${timeStr}\n`;
    txt += `${line('═')}\n`;

    return { txt, filename };
};

export const rankingTxtExportService = {
    async saveRankingReport(allData, macro) {
        try {
            if (!fs.existsSync(REPORTS_DIR)) {
                fs.mkdirSync(REPORTS_DIR, { recursive: true });
            }

            const { txt } = generateTxtContent(allData, macro);
            const filename = 'ranking_latest.txt';
            const filePath = path.join(REPORTS_DIR, filename);

            fs.writeFileSync(filePath, txt, 'utf-8');

            return { success: true, filePath, filename };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
};
