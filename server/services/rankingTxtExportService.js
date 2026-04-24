
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_DIR = path.resolve(__dirname, '../../reports');

const fmt = (val, decimals = 2, fallback = 'N/D') => {
    if (val === null || val === undefined || val === '' || (typeof val === 'number' && (isNaN(val) || !isFinite(val)))) return fallback;
    if (typeof val === 'number') return val.toFixed(decimals);
    return String(val);
};

const fmtBRL = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `R$ ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtPct = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `${Number(val).toFixed(2)}%`;
};

const fmtMarketCap = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e12) return `R$ ${(val / 1e12).toFixed(2)} tri`;
    if (val >= 1e9) return `R$ ${(val / 1e9).toFixed(2)} bi`;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)} mi`;
    return `R$ ${val.toFixed(0)}`;
};

const fmtLiquidity = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e9) return `R$ ${(val / 1e9).toFixed(2)} bi/dia`;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)} mi/dia`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)} mil/dia`;
    return `R$ ${val.toFixed(0)}/dia`;
};

const fmtUSD = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `$ ${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtMarketCapUSD = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e12) return `$ ${(val / 1e12).toFixed(2)} tri`;
    if (val >= 1e9) return `$ ${(val / 1e9).toFixed(2)} bi`;
    if (val >= 1e6) return `$ ${(val / 1e6).toFixed(2)} mi`;
    return `$ ${val.toFixed(0)}`;
};

const line = (char = '─', len = 80) => char.repeat(len);

const actionLabel = (action) => {
    if (action === 'BUY') return '✅ COMPRAR';
    if (action === 'SELL') return '🔴 VENDER';
    return '⏳ AGUARDAR';
};

const tierLabel = (tier) => {
    if (tier === 'GOLD') return '🥇 GOLD';
    if (tier === 'SILVER') return '🥈 SILVER';
    if (tier === 'BRONZE') return '🥉 BRONZE';
    return tier || 'N/D';
};

const profileLabel = (profile) => {
    if (profile === 'DEFENSIVE') return 'Defensivo';
    if (profile === 'MODERATE') return 'Moderado';
    if (profile === 'BOLD') return 'Arrojado';
    return profile || 'N/D';
};

const assetClassLabel = (cls) => {
    const map = { STOCK: 'AÇÕES', FII: 'FIIs', CRYPTO: 'CRIPTOMOEDAS', BRASIL_10: 'BRASIL 10', STOCK_US: 'ATIVOS GLOBAIS (S&P 500)' };
    return map[cls] || cls;
};

const deltaSymbol = (curr, prev) => {
    if (prev === null || prev === undefined) return '🆕 Novo';
    const diff = prev - curr;
    if (diff > 0) return `⬆️ +${diff} (era #${prev})`;
    if (diff < 0) return `⬇️ ${diff} (era #${prev})`;
    return '➡️ Manteve';
};

const formatAuditLog = (auditLog) => {
    if (!auditLog || auditLog.length === 0) return '  (sem registros)\n';

    const grouped = {};
    auditLog.forEach(entry => {
        const cat = entry.category || 'Geral';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(entry);
    });

    let out = '';
    for (const [category, entries] of Object.entries(grouped)) {
        out += `  [${category}]\n`;
        entries.forEach(e => {
            const sign = e.points > 0 ? `+${e.points}` : `${e.points}`;
            const typeTag = e.type === 'base' ? 'base' : e.type === 'bonus' ? 'bônus' : 'penalidade';
            out += `    ${e.points > 0 ? '▲' : e.points < 0 ? '▼' : '○'} ${String(e.factor).padEnd(55)} [${sign.padStart(4)} pts] (${typeTag})\n`;
        });
    }
    return out;
};

const formatMetrics = (m, type) => {
    if (!m) return '  (sem métricas)\n';
    const fmtP = type === 'STOCK_US' ? fmtUSD : fmtBRL;
    const fmtCap = type === 'STOCK_US' ? fmtMarketCapUSD : fmtMarketCap;
    let out = '';

    out += `  ── Valuation ─────────────────────────────────────────\n`;
    out += `  Preço Justo:       ${fmtP(m.fairPrice)}   Método: ${m.method || 'N/D'}\n`;
    out += `  Preço Graham:      ${fmtP(m.grahamPrice)}   Preço Bazin:  ${fmtP(m.bazinPrice)}\n`;
    out += `  PEG Ratio:         ${fmt(m.pegRatio, 2)}\n`;

    out += `\n  ── Indicadores de Mercado ────────────────────────────\n`;
    out += `  Market Cap:        ${fmtCap(m.marketCap)}\n`;
    out += `  Liquidez Média:    ${fmtLiquidity(m.avgLiquidity)}\n`;
    out += `  Volatilidade:      ${fmtPct(m.volatility)}   Beta: ${fmt(m.beta, 2)}\n`;
    out += `  SMA200:            ${fmtP(m.sma200)}   EMA50: ${fmtP(m.ema50)}\n`;

    if (type === 'STOCK' || type === 'STOCK_US') {
        out += `\n  ── Múltiplos Fundamentais ────────────────────────────\n`;
        out += `  P/L:               ${fmt(m.pl, 2)}   P/VP:         ${fmt(m.pvp, 2)}\n`;
        out += `  EV/EBITDA:         ${fmt(m.evEbitda, 2)}   EV/EBIT:      ${fmt(m.evEbit, 2)}\n`;
        out += `  PSR:               ${fmt(m.psr, 2)}   P/EBIT:       ${fmt(m.pEbit, 2)}\n`;
        out += `  P/Ativos:          ${fmt(m.pAtivos, 2)}   P/Cap.Giro:   ${fmt(m.pCapGiro, 2)}\n`;
        out += `  P/Ativ.Circ.Liq:   ${fmt(m.pAtivCircLiq, 2)}   Earnings Yield: ${fmtPct(m.earningsYield)}\n`;

        out += `\n  ── Rentabilidade e Eficiência ────────────────────────\n`;
        out += `  ROE:               ${fmtPct(m.roe)}   ROIC:         ${fmtPct(m.roic)}\n`;
        out += `  Margem Líquida:    ${fmtPct(m.netMargin)}   Margem EBIT:  ${fmtPct(m.ebitMargin)}\n`;
        out += `  Crescimento 5a:    ${fmtPct(m.revenueGrowth)}\n`;

        out += `\n  ── Endividamento e Saúde Financeira ──────────────────\n`;
        out += `  Dívida/PL:         ${fmt(m.debtToEquity, 2)}   Corrente:     ${fmt(m.currentRatio, 2)}\n`;
        out += `  Patrimônio Líq.:   ${fmtCap(m.patrimLiq)}   Dív. Líquida: ${fmtCap(m.netDebt)}\n`;
        out += `  Receita Líquida:   ${fmtCap(m.netRevenue)}   Lucro Líq.:   ${fmtCap(m.netIncome)}\n`;
        out += `  Total Ativos:      ${fmtCap(m.totalAssets)}\n`;

        out += `\n  ── Dividendos ────────────────────────────────────────\n`;
        out += `  Dividend Yield:    ${fmtPct(m.dy)}   Payout:       ${fmtPct(m.payout)}\n`;
    }

    if (type === 'FII') {
        out += `\n  ── Indicadores de FII ────────────────────────────────\n`;
        out += `  P/VP:              ${fmt(m.pvp, 2)}   Dividend Yield: ${fmtPct(m.dy)}\n`;
        out += `  Vacância:          ${fmtPct(m.vacancy)}   Cap Rate:     ${fmtPct(m.capRate)}\n`;
        out += `  Qtd. Imóveis:      ${fmt(m.qtdImoveis, 0)}   FFO Yield:    ${fmtPct(m.ffoYield)}\n`;
        out += `  VPA por Cota:      ${fmtBRL(m.vpCota)}   FFO/Cota:     ${fmtBRL(m.ffoCota)}\n`;
        out += `  Preço/m²:          ${fmtBRL(m.priceM2)}   Renda/m²:     ${fmtBRL(m.rentM2)}\n`;
        out += `  Market Cap:        ${fmtMarketCap(m.marketCap)}\n`;
    }

    if (type === 'CRYPTO') {
        out += `\n  ── Indicadores Cripto ────────────────────────────────\n`;
        out += `  Market Cap:        ${fmtMarketCap(m.marketCap)}\n`;
        out += `  Volatilidade:      ${fmtPct(m.volatility)}   Beta: ${fmt(m.beta, 2)}\n`;
        out += `  Liquidez:          ${fmtLiquidity(m.avgLiquidity)}\n`;
    }

    if (m.structural) {
        out += `\n  ── Scores Estruturais (0–100) ────────────────────────\n`;
        out += `  Qualidade:         ${fmt(m.structural.quality, 0)}/100\n`;
        out += `  Valuation:         ${fmt(m.structural.valuation, 0)}/100\n`;
        out += `  Risco:             ${fmt(m.structural.risk, 0)}/100\n`;
    }

    if (m._staleDays !== null && m._staleDays !== undefined) {
        out += `\n  ⚠ Defasagem dos Dados Fundamentais: ${m._staleDays} dias\n`;
    }
    if (m._missing && Object.keys(m._missing).length > 0) {
        const missing = Object.entries(m._missing).filter(([, v]) => v).map(([k]) => k);
        if (missing.length > 0) {
            out += `  ⚠ Campos Ausentes: ${missing.join(', ')}\n`;
        }
    }

    return out;
};

const formatRankingItem = (item, idx) => {
    const m = item.metrics || {};
    const currency = item.type === 'CRYPTO' || item.type === 'STOCK_US' ? '$' : 'R$';
    const priceStr = (val) => {
        if (val === null || val === undefined || isNaN(val)) return 'N/D';
        return `${currency} ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const upside = (item.currentPrice && item.targetPrice && item.currentPrice > 0)
        ? (((item.targetPrice - item.currentPrice) / item.currentPrice) * 100).toFixed(1)
        : null;

    let out = '';
    out += `\n${line('─')}\n`;
    out += `  #${item.position}  ${item.ticker}  —  ${item.name || 'N/D'}  [${item.type}]\n`;
    out += `  Setor: ${item.sector || 'N/D'}\n`;
    out += `  ${line('·', 76)}\n`;
    out += `  Ação:    ${actionLabel(item.action).padEnd(18)}  Tier: ${tierLabel(item.tier).padEnd(14)}  Perfil: ${profileLabel(item.riskProfile)}\n`;
    out += `  Score:   ${fmt(item.score, 1)}/100   Delta Posição: ${deltaSymbol(item.position, item.previousPosition)}\n`;
    out += `  ${line('·', 76)}\n`;

    if (item.scores) {
        out += `  Scores por Perfil:\n`;
        out += `    Defensivo:  ${fmt(item.scores['DEFENSIVE'], 1).padStart(5)}/100\n`;
        out += `    Moderado:   ${fmt(item.scores['MODERATE'], 1).padStart(5)}/100\n`;
        out += `    Arrojado:   ${fmt(item.scores['BOLD'], 1).padStart(5)}/100\n`;
    }

    out += `  ${line('·', 76)}\n`;
    out += `  Preço Atual:    ${priceStr(item.currentPrice).padEnd(20)}  Preço Alvo: ${priceStr(item.targetPrice)}\n`;
    if (upside !== null) out += `  Upside/Downside: ${upside >= 0 ? '+' : ''}${upside}%\n`;
    if (item.isDividendAristocrat) out += `  🏆 DIVIDEND ARISTOCRAT\n`;
    out += `  ${line('·', 76)}\n`;

    out += `  TESE: ${item.thesis || 'N/D'}\n`;

    if (item.bullThesis && item.bullThesis.length > 0) {
        out += `\n  Bull Thesis:\n`;
        item.bullThesis.forEach(t => { out += `    + ${t}\n`; });
    }
    if (item.bearThesis && item.bearThesis.length > 0) {
        out += `\n  Bear Thesis:\n`;
        item.bearThesis.forEach(t => { out += `    - ${t}\n`; });
    }

    out += `\n  AUDIT LOG:\n`;
    out += formatAuditLog(item.auditLog);

    out += `\n  MÉTRICAS:\n`;
    out += formatMetrics(m, item.type);

    return out;
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
            ranking.forEach((item, idx) => {
                txt += formatRankingItem(item, idx);
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
