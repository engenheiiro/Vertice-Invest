// Tipos compartilhados entre o widget "Cofre de Dividendos" do Dashboard e a
// aba Proventos da Carteira (DividendDashboard) — ambos consomem a mesma
// resposta de GET /wallet/dividends.

export interface DividendGoal {
    target: number;
    current: number;
    /** null = sem meta definida (distinto de meta em 0%). */
    progressPercent: number | null;
}

export interface YieldOnCostItem {
    ticker: string;
    receivedLast12Months: number;
    totalCost: number;
    yocPercent: number;
}
