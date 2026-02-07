
import { describe, it, expect } from 'vitest';

// Simulação da lógica CORE de TWRR (Modified Dietz Diário)
// Esta função replica a lógica encontrada no loop do financialService.rebuildUserHistory
const calculateTWRR = (transactions, priceHistory) => {
    let currentQuota = 100.0;
    let previousEquityAdjusted = 0;
    
    const dates = [...new Set([...transactions.map(t => t.date), ...priceHistory.map(p => p.date)])].sort();
    
    let portfolioQty = 0;
    
    for (const date of dates) {
        const dayTxs = transactions.filter(t => t.date === date);
        let dayFlowAdjusted = 0;
        
        const priceData = priceHistory.find(p => p.date === date) || { close: 0 };
        const closePrice = priceData.close; // Já deve vir ajustado por splits na fonte de dados

        // Processa movimentações do dia
        for (const tx of dayTxs) {
            if (tx.type === 'BUY') {
                portfolioQty += tx.quantity;
                dayFlowAdjusted += (tx.quantity * tx.price); 
            } else if (tx.type === 'SELL') {
                portfolioQty -= tx.quantity;
                dayFlowAdjusted -= (tx.quantity * tx.price);
            } else if (tx.type === 'SPLIT') {
                // Em um sistema real, o split ajusta a quantidade E o preço histórico.
                // Aqui simulamos apenas o ajuste de quantidade, assumindo que priceHistory já reflete o ajuste.
                portfolioQty = portfolioQty * tx.ratio;
            }
        }

        // Patrimônio ao final do dia (Mark to Market)
        const totalEquityAdjusted = portfolioQty * closePrice;

        // Cálculo do Retorno Diário (Modified Dietz)
        // R = (V1 - V0 - F) / (V0 + F*w)
        if (previousEquityAdjusted > 0) {
            const capitalGainAdj = totalEquityAdjusted - previousEquityAdjusted - dayFlowAdjusted;
            const denominator = previousEquityAdjusted + (dayFlowAdjusted * 0.5); // Peso 0.5 para fluxos intraday
            
            if (denominator > 0.0001) { // Evita divisão por zero
                const dailyReturn = capitalGainAdj / denominator;
                currentQuota = currentQuota * (1 + dailyReturn);
            }
        }
        
        previousEquityAdjusted = totalEquityAdjusted;
    }

    return currentQuota;
};

describe('Financial Regression Suite (10-Year Horizon)', () => {

    it('Scenario A: Standard Accumulation (Buy & Hold)', () => {
        // Tese: Comprar e o preço subir gera retorno positivo. Aportes não devem distorcer o % artificialmente.
        // Dia 1: Compra 100 a R$ 10. (Patrimônio 1000). Fecha a 10.
        // Dia 2: Preço sobe para 11 (+10%). Patrimônio 1100.
        // Dia 3: Compra 100 a R$ 11. (Fluxo 1100). Qty 200. Patrimônio 2200.
        // Dia 4: Preço sobe para 12 (+9.09%). Patrimônio 2400.
        // Retorno Composto Esperado: (1.10) * (1.0909) = ~1.20 (20%)
        
        const txs = [
            { date: '2024-01-01', type: 'BUY', quantity: 100, price: 10.00 },
            { date: '2024-01-03', type: 'BUY', quantity: 100, price: 11.00 }
        ];
        const prices = [
            { date: '2024-01-01', close: 10.00 },
            { date: '2024-01-02', close: 11.00 },
            { date: '2024-01-03', close: 11.00 },
            { date: '2024-01-04', close: 12.00 }
        ];

        const quota = calculateTWRR(txs, prices);
        expect(quota).toBeCloseTo(120.00, 1); // 100 * 1.20 = 120
    });

    it('Scenario B: Stock Split (1:2)', () => {
        // Tese: Um desdobramento não deve gerar lucro ou prejuízo imediato no TWRR.
        // Dia 1: Compra 100 a R$ 20. (Total 2000).
        // Dia 2: Split 1:2. Quantidade vira 200. Preço ajustado cai para R$ 10.
        // Patrimônio D1: 100 * 20 = 2000.
        // Patrimônio D2: 200 * 10 = 2000.
        // Retorno deve ser 0%.

        const txs = [
            { date: '2024-01-01', type: 'BUY', quantity: 100, price: 20.00 },
            { date: '2024-01-02', type: 'SPLIT', ratio: 2, price: 0 } // Evento corporativo
        ];
        const prices = [
            { date: '2024-01-01', close: 20.00 },
            { date: '2024-01-02', close: 10.00 }
        ];

        const quota = calculateTWRR(txs, prices);
        expect(quota).toBeCloseTo(100.00, 1); // Sem alteração
    });

    it('Scenario C: JCP Reinvestment (Dividend Cycle)', () => {
        // Tese: Receber dividendo e reinvestir.
        // Dia 1: Compra 100 a R$ 10. (1000).
        // Dia 2: Preço cai ex-div para R$ 9.00. Mas recebe R$ 1.00/ação (R$ 100).
        // O sistema deve tratar o "recebimento" implicitamente na conta se o preço ajustado for usado, 
        // ou o fluxo de reinvestimento deve neutralizar a queda.
        // Simplificação: Se usarmos preços AJUSTADOS por proventos (padrão Yahoo/B3), a queda de cotação "some".
        // Se usarmos preço nominal, a queda aparece e o dividendo entra como fluxo positivo externo.
        // Assumindo Preço Ajustado (Cenário Ideal):
        
        const txs = [{ date: '2024-01-01', type: 'BUY', quantity: 100, price: 10.00 }];
        // Preço ajustado: Se pagou 1.00, o preço ajustado de D1 seria ~9.00 retroativamente.
        // Vamos simular preço estável ajustado.
        const prices = [
            { date: '2024-01-01', close: 9.00 }, // Ajustado
            { date: '2024-01-02', close: 9.00 }
        ];
        
        // Se comprou a 10 (nominal) mas o histórico ajustado diz 9, há uma perda "técnica" inicial 
        // se não corrigirmos o custo. Mas o TWRR olha a variação D1->D2.
        
        const quota = calculateTWRR(txs, prices);
        // De 9 pra 9 = 0% de retorno.
        expect(quota).toBeCloseTo(100.00, 1);
    });

    it('Scenario D: Long Term Volatility (The 10-Year Stress Test)', () => {
        // Simulação de 10 anos (3650 dias) com volatilidade aleatória
        // Objetivo: Garantir que o acumulado não exploda para Infinity ou NaN
        
        const txs = [{ date: '2010-01-01', type: 'BUY', quantity: 100, price: 10.00 }];
        const prices = [];
        let price = 10.00;
        
        for (let i = 0; i < 3650; i++) {
            const date = new Date(2010, 0, 1);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            
            // Volatilidade diária +/- 2%
            const change = 1 + (Math.random() * 0.04 - 0.02);
            price = price * change;
            
            prices.push({ date: dateStr, close: price });
        }

        const quota = calculateTWRR(txs, prices);
        
        expect(quota).not.toBeNaN();
        expect(quota).toBeGreaterThan(0);
        expect(quota).toBeLessThan(1000000); // Sanity check
    });

});
