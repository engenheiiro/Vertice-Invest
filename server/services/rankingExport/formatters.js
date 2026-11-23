// Formatadores de texto do relatório TXT do ranking (reports/ranking_latest.txt).
// Número ausente, NaN ou infinito vira N/D; nunca "NaN" nem "0.00" inventado.

export const fmt = (val, decimals = 2, fallback = 'N/D') => {
    if (val === null || val === undefined || val === '' || (typeof val === 'number' && (isNaN(val) || !isFinite(val)))) return fallback;
    if (typeof val === 'number') return val.toFixed(decimals);
    return String(val);
};

export const fmtBRL = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `R$ ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtPct = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `${Number(val).toFixed(2)}%`;
};

export const fmtMarketCap = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e12) return `R$ ${(val / 1e12).toFixed(2)} tri`;
    if (val >= 1e9) return `R$ ${(val / 1e9).toFixed(2)} bi`;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)} mi`;
    return `R$ ${val.toFixed(0)}`;
};

export const fmtLiquidity = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e9) return `R$ ${(val / 1e9).toFixed(2)} bi/dia`;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)} mi/dia`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)} mil/dia`;
    return `R$ ${val.toFixed(0)}/dia`;
};

export const fmtLiquidityUSD = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e9) return `$ ${(val / 1e9).toFixed(2)} bi/dia`;
    if (val >= 1e6) return `$ ${(val / 1e6).toFixed(2)} mi/dia`;
    if (val >= 1e3) return `$ ${(val / 1e3).toFixed(0)} mil/dia`;
    return `$ ${val.toFixed(0)}/dia`;
};

export const fmtUSD = (val, fallback = 'N/D') => {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return fallback;
    return `$ ${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtMarketCapUSD = (val) => {
    if (!val || isNaN(val)) return 'N/D';
    if (val >= 1e12) return `$ ${(val / 1e12).toFixed(2)} tri`;
    if (val >= 1e9) return `$ ${(val / 1e9).toFixed(2)} bi`;
    if (val >= 1e6) return `$ ${(val / 1e6).toFixed(2)} mi`;
    return `$ ${val.toFixed(0)}`;
};

export const line = (char = '─', len = 80) => char.repeat(len);

export const actionLabel = (action) => {
    if (action === 'BUY') return '✅ COMPRAR';
    if (action === 'SELL') return '🔴 VENDER';
    return '⏳ AGUARDAR';
};

export const tierLabel = (tier) => {
    if (tier === 'GOLD') return '🥇 GOLD';
    if (tier === 'SILVER') return '🥈 SILVER';
    if (tier === 'BRONZE') return '🥉 BRONZE';
    return tier || 'N/D';
};

export const profileLabel = (profile) => {
    if (profile === 'DEFENSIVE') return 'Defensivo';
    if (profile === 'MODERATE') return 'Moderado';
    if (profile === 'BOLD') return 'Arrojado';
    return profile || 'N/D';
};
