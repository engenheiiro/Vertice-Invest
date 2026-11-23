// Bloco de um ativo do ranking no relatório TXT (cabeçalho, preços, teses,
// audit log e métricas).
import { fmt, line, actionLabel, tierLabel, profileLabel } from './formatters.js';
import { formatMetrics } from './metricsText.js';

const SEPARATOR = `  ${line('·', 76)}\n`;

const deltaSymbol = (curr, prev) => {
    if (prev === null || prev === undefined) return '🆕 Novo';
    const diff = prev - curr;
    if (diff > 0) return `⬆️ +${diff} (era #${prev})`;
    if (diff < 0) return `⬇️ ${diff} (era #${prev})`;
    return '➡️ Manteve';
};

const auditEntryText = (e) => {
    const sign = e.points > 0 ? `+${e.points}` : `${e.points}`;
    const typeTag = e.type === 'base' ? 'base' : e.type === 'bonus' ? 'bônus' : 'penalidade';
    const arrow = e.points > 0 ? '▲' : e.points < 0 ? '▼' : '○';
    return `    ${arrow} ${String(e.factor).padEnd(55)} [${sign.padStart(4)} pts] (${typeTag})\n`;
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
        entries.forEach(e => { out += auditEntryText(e); });
    }
    return out;
};

const currencyOf = (type) => (type === 'CRYPTO' || type === 'STOCK_US' ? '$' : 'R$');

const priceText = (currency, val) => {
    if (val === null || val === undefined || isNaN(val)) return 'N/D';
    return `${currency} ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// String com 1 casa ou null; a comparação com 0 abaixo é feita sobre a string.
const upsideOf = (currentPrice, targetPrice) => (
    (currentPrice && targetPrice && currentPrice > 0)
        ? (((targetPrice - currentPrice) / currentPrice) * 100).toFixed(1)
        : null
);

const headerText = (item) => {
    let out = '';
    out += `\n${line('─')}\n`;
    out += `  #${item.position}  ${item.ticker}  —  ${item.name || 'N/D'}  [${item.type}]\n`;
    out += `  Setor: ${item.sector || 'N/D'}\n`;
    out += SEPARATOR;
    out += `  Ação:    ${actionLabel(item.action).padEnd(18)}  Tier: ${tierLabel(item.tier).padEnd(14)}  Perfil: ${profileLabel(item.riskProfile)}\n`;
    out += `  Score:   ${fmt(item.score, 1)}/100   Delta Posição: ${deltaSymbol(item.position, item.previousPosition)}\n`;
    out += SEPARATOR;
    return out;
};

const profileScoresText = (scores) => {
    if (!scores) return '';
    let out = `  Scores por Perfil:\n`;
    out += `    Defensivo:  ${fmt(scores['DEFENSIVE'], 1).padStart(5)}/100\n`;
    out += `    Moderado:   ${fmt(scores['MODERATE'], 1).padStart(5)}/100\n`;
    out += `    Arrojado:   ${fmt(scores['BOLD'], 1).padStart(5)}/100\n`;
    return out;
};

const priceBlockText = (item) => {
    const currency = currencyOf(item.type);
    const upside = upsideOf(item.currentPrice, item.targetPrice);
    let out = SEPARATOR;
    out += `  Preço Atual:    ${priceText(currency, item.currentPrice).padEnd(20)}  Preço Alvo: ${priceText(currency, item.targetPrice)}\n`;
    if (upside !== null) out += `  Upside/Downside: ${upside >= 0 ? '+' : ''}${upside}%\n`;
    if (item.isDividendAristocrat) out += `  🏆 DIVIDEND ARISTOCRAT\n`;
    out += SEPARATOR;
    return out;
};

const thesisListText = (title, marker, list) => {
    if (!list || list.length === 0) return '';
    let out = `\n  ${title}:\n`;
    list.forEach(t => { out += `    ${marker} ${t}\n`; });
    return out;
};

export const formatRankingItem = (item) => {
    let out = headerText(item);
    out += profileScoresText(item.scores);
    out += priceBlockText(item);
    out += `  TESE: ${item.thesis || 'N/D'}\n`;
    out += thesisListText('Bull Thesis', '+', item.bullThesis);
    out += thesisListText('Bear Thesis', '-', item.bearThesis);

    out += `\n  AUDIT LOG:\n`;
    out += formatAuditLog(item.auditLog);

    out += `\n  MÉTRICAS:\n`;
    out += formatMetrics(item.metrics || {}, item.type, item.sector);
    return out;
};
