import type { WalletKPIs } from '../../contexts/WalletContext';
import { totalResultBalance } from '../../utils/kpiCalculations';
import { buildEquitySummaryView, type EquitySummaryView } from '../dashboard/equitySummaryView';

/**
 * Derivação pura do resumo da aba Carteira. É a mesma do card do Terminal
 * (sinais, cores, selo de risco), com UMA diferença: o saldo bruto aqui é a
 * identidade do gráfico — Aplicado + Resultado Total —, não patrimônio +
 * proventos. A soma das posições pode conservar subcentavos enquanto os KPIs
 * do servidor já chegam arredondados; recompor por outro caminho deixaria card
 * e gráfico discordando por um centavo.
 */
export function buildWalletSummaryView(kpis: WalletKPIs): EquitySummaryView {
    const base = buildEquitySummaryView(kpis);
    const invested = kpis.totalInvested || 0;
    const totalGross = totalResultBalance(kpis);
    return { ...base, totalGross, grossMultiple: invested > 0 ? totalGross / invested : 0 };
}
