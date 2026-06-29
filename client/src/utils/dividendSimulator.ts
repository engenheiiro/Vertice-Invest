// Simulador de reinvestimento de dividendos ("bola de neve"). Função pura,
// sem I/O: isola o efeito de reinvestir os proventos (vs. retirá-los) sobre o
// patrimônio em ativos pagadores — não modela valorização do ativo em si, só
// o efeito de juros compostos sobre o fluxo de proventos.

export interface SimulateReinvestmentParams {
    /** Patrimônio inicial em ativos pagadores (R$). */
    initialEquity: number;
    /** Yield mensal médio do portfólio (ex.: 0.006 = 0,6% ao mês). */
    monthlyYieldRate: number;
    /** Horizonte da simulação em anos. */
    years: number;
    /** Aporte mensal adicional (R$), aplicado igualmente em ambos os cenários. */
    monthlyContribution?: number;
}

export interface SimulateReinvestmentResult {
    /** Patrimônio mês a mês (índice 0 = mês inicial) reinvestindo os proventos. */
    withReinvestment: number[];
    /** Patrimônio mês a mês retirando os proventos (só cresce por aporte). */
    withoutReinvestment: number[];
}

export const simulateReinvestment = ({
    initialEquity,
    monthlyYieldRate,
    years,
    monthlyContribution = 0,
}: SimulateReinvestmentParams): SimulateReinvestmentResult => {
    const months = Math.max(0, Math.round(years * 12));
    const withReinvestment: number[] = [initialEquity];
    const withoutReinvestment: number[] = [initialEquity];

    let reinvested = initialEquity;
    let flat = initialEquity;

    for (let m = 1; m <= months; m++) {
        const dividend = reinvested * monthlyYieldRate;
        reinvested = reinvested + dividend + monthlyContribution;
        // Proventos não reinvestidos saem da base — só o aporte a faz crescer.
        flat = flat + monthlyContribution;

        withReinvestment.push(reinvested);
        withoutReinvestment.push(flat);
    }

    return { withReinvestment, withoutReinvestment };
};
