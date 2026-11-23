// Teses dinâmicas (bull/bear) do scorer legado. Saíram do scoringEngine sem mudar
// texto nem ordem: cada bloco empurra nas listas na mesma sequência de antes.
import { DEFAULT_NTNB_FALLBACK } from '../../config/financialConstants.js';
import { resolvePapel } from './sectorRules.js';

const commonTheses = (m, MACRO, bull) => {
    if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) supera a Selic.`);
    if (m.pvp < 0.85 && m.pvp > 0) bull.push(`Desconto patrimonial (P/VP ${m.pvp.toFixed(2)}).`);
    if (!m._missing?.roe && m.roe > 18) bull.push(`Rentabilidade alta (ROE ${m.roe.toFixed(1)}%).`);
};

const fiiTheses = (m, MACRO, isPapel, bull, bear) => {
    const ntnb = MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    const spread = m.dy - ntnb;

    if (spread > 2.5) bull.push(`Alto prêmio de risco: Spread de ${spread.toFixed(1)}% sobre NTN-B.`);
    else if (spread < 0.5) bear.push(`Prêmio de risco pífio (${spread.toFixed(1)}%) sobre o Tesouro.`);

    if (m.vacancy > 12) bear.push(`Vacância elevada (${m.vacancy.toFixed(1)}%): Risco de fluxo de caixa.`);
    else if (m.vacancy < 3 && !isPapel) bull.push("Ocupação quase plena (Vacância < 3%).");

    if (m.qtdImoveis === 1) bear.push("Risco Mono-Ativo: Dependência total de um único imóvel.");
    if (m.beta < 0.7) bull.push(`Baixa volatilidade (Beta ${m.beta.toFixed(2)}): Perfil defensivo.`);
    else if (m.beta > 1.1) bear.push(`Volatilidade alta para o setor (Beta ${m.beta.toFixed(2)}).`);

    if (isPapel && m.pvp > 1.05) bear.push("Ágio em FII de Papel: Risco de amortização negativa.");
};

const cryptoSizeTheses = (m, ticker, bull, bear) => {
    if (['BTC', 'ETH'].includes(ticker)) bull.push("Blue Chip do mercado cripto (Reserva de Valor / Infraestrutura).");
    if (m.marketCap > 20000000000) bull.push("Alta capitalização de mercado (Large Cap), maior resiliência.");
    else if (m.marketCap < 2000000000) bull.push("Baixa capitalização (Small Cap), alta assimetria de retorno.");

    if (m.avgLiquidity > 1000000000) bull.push("Altíssima liquidez, facilitando entrada/saída institucional.");
    else if (m.avgLiquidity < 50000000) bear.push("Baixa liquidez, risco de slippage e manipulação.");
};

const cryptoVolumeTheses = (m, bull, bear) => {
    const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
    if (vmc > 0.02 && vmc < 0.15) bull.push(`Volume/MarketCap saudável (${(vmc*100).toFixed(1)}%), indicando adoção orgânica.`);
    else if (vmc > 0.5) bear.push(`Volume/MarketCap excessivo (${(vmc*100).toFixed(1)}%), possível especulação ou wash trading.`);
    else if (vmc < 0.005) bear.push(`Volume/MarketCap muito baixo (${(vmc*100).toFixed(1)}%), indicando desinteresse do mercado.`);

    if (m.marketCap < 100000000) bear.push("Micro Cap (< $100M): Risco extremo de volatilidade e falha do projeto.");
};

const cryptoTrendTheses = (m, currentPrice, bull, bear) => {
    if (m.sma200) {
        if (currentPrice > m.sma200) bull.push("Tendência de alta de longo prazo (Preço > SMA200).");
        else bear.push("Tendência de baixa de longo prazo (Preço < SMA200).");
    }

    if (m.volatility) {
        if (m.volatility > 100) bear.push(`Volatilidade extrema (${m.volatility.toFixed(1)}% a.a.).`);
        else if (m.volatility < 50) bull.push(`Volatilidade controlada para o setor (${m.volatility.toFixed(1)}% a.a.).`);
    }
};

/** Teses do ativo já preparado pelo scorer (`asset.metrics` é a fonte das métricas). */
export const generateDynamicTheses = (asset, context) => {
    const { MACRO } = context;
    const { metrics: m, type } = asset;
    const bull = [];
    const bear = [];
    commonTheses(m, MACRO, bull);
    if (type === 'FII') fiiTheses(m, MACRO, resolvePapel(asset.fiiSubType, asset.sector), bull, bear);

    if (m.debtToEquity > 4 && type === 'STOCK') bear.push("Alavancagem alta.");
    if (m.avgLiquidity < 500000 && type !== 'CRYPTO') bear.push("Baixa liquidez.");

    if (type === 'CRYPTO') {
        cryptoSizeTheses(m, asset.ticker, bull, bear);
        cryptoVolumeTheses(m, bull, bear);
        cryptoTrendTheses(m, asset.price, bull, bear);
    }
    return { bull, bear };
};
