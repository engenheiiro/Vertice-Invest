
import { describe, it, expect } from 'vitest';

// Simulação da lógica de cálculo TWRR do financialService.js
// Extraída para testar a matemática pura sem dependências de banco de dados
const calculateTWRR = (transactions, priceHistory) => {
    let currentQuota = 100.0;
    let previousEquityAdjusted = 0;
    
    // Ordena por data
    const dates = [...new Set([...transactions.map(t => t.date), ...priceHistory.map(p => p.date)])].sort();
    
    let portfolioQty = 0;
    
    for (const date of dates) {
        // 1. Processa Transações do Dia (Flow)
        const dayTxs = transactions.filter(t => t.date === date);
        let dayFlowAdjusted = 0;
        
        // Preço de fechamento do dia
        const priceData = priceHistory.find(p => p.date === date) || { close: 0 };
        const closePrice = priceData.close;

        for (const tx of dayTxs) {
            if (tx.type === 'BUY') {
                portfolioQty += tx.quantity;
                // Ajustado assume que a compra ocorreu no valor de fechamento para simplificação do teste Dietz, 
                // ou usamos o valor da transação se for intraday. 
                // Para TWRR puro, usamos o valor do fluxo.
                dayFlowAdjusted += (tx.quantity * tx.price); 
            }
        }

        // 2. Mark to Market (Patrimônio Final do Dia)
        const totalEquityAdjusted = portfolioQty * closePrice;

        // 3. TWRR Calculation
        if (previousEquityAdjusted > 0) {
            // Fórmula Modified Dietz para o dia:
            // R = (V_final - V_inicial - Flow) / (V_inicial + W*Flow)
            // Assumindo fluxo no final do dia (W=0) ou inicio (W=1). O sistema usa 0.5 (meio do dia).
            
            const capitalGainAdj = totalEquityAdjusted - previousEquityAdjusted - dayFlowAdjusted;
            const denominator = previousEquityAdjusted + (dayFlowAdjusted * 0.5); 
            
            if (denominator > 0) {
                const dailyReturn = capitalGainAdj / denominator;
                currentQuota = currentQuota * (1 + dailyReturn);
            }
        }
        
        previousEquityAdjusted = totalEquityAdjusted;
    }

    return currentQuota;
};

describe('Financial Math Engine (TWRR)', () => {
    
    it('Should calculate TWRR correctly with cash inflows (Gabarito Excel)', () => {
        // CENÁRIO GABARITO:
        // Dia 1: Compra 100 ações a R$ 10.00. (Patrimônio 1000). Preço fecha a 10.
        // Dia 2: Preço sobe para R$ 11.00. (Patrimônio 1100). Retorno dia = 10%.
        // Dia 3: Compra +100 ações a R$ 11.00. (Fluxo +1100). Total Qty 200. Preço fecha a 11. 
        //        Patrimônio Final = 2200. Anterior = 1100. Fluxo = 1100. Ganho = 0.
        // Dia 4: Preço sobe para R$ 12.00. (Patrimônio 2400). Anterior = 2200. Ganho = 200.
        //        Retorno dia = 200 / 2200 = 9.09%.
        //
        // Retorno Acumulado Esperado: (1.10 * 1.00 * 1.0909) - 1 = ~1.20 (20%)
        // Explicação: O investidor ganhou R$ 1,00 na primeira tranche (10->11) e R$ 1,00 em AMBAS as tranches (11->12).
        // Se tivesse mantido só a primeira: 10->12 = 20%.
        // O TWRR remove o efeito do aporte e mostra a performance do ativo/gestor. Deve ser 20%.

        const transactions = [
            { date: '2024-01-01', type: 'BUY', quantity: 100, price: 10.00 },
            { date: '2024-01-03', type: 'BUY', quantity: 100, price: 11.00 }
        ];

        const priceHistory = [
            { date: '2024-01-01', close: 10.00 },
            { date: '2024-01-02', close: 11.00 }, // +10%
            { date: '2024-01-03', close: 11.00 }, // Aporte ocorre aqui, preço flat
            { date: '2024-01-04', close: 12.00 }  // +9.09%
        ];

        const finalQuota = calculateTWRR(transactions, priceHistory);
        const finalReturnPercent = ((finalQuota / 100) - 1) * 100;

        // Tolerância de ponto flutuante pequena
        expect(finalReturnPercent).toBeCloseTo(20.0, 1); 
    });

    it('Should handle negative returns correctly', () => {
        // Cenário Queda:
        // Dia 1: Compra 100 a 10.
        // Dia 2: Cai para 9 (-10%).
        // TWRR deve ser -10%.
        const transactions = [{ date: '2024-01-01', type: 'BUY', quantity: 100, price: 10.00 }];
        const priceHistory = [
            { date: '2024-01-01', close: 10.00 },
            { date: '2024-01-02', close: 9.00 }
        ];

        const finalQuota = calculateTWRR(transactions, priceHistory);
        const finalReturnPercent = ((finalQuota / 100) - 1) * 100;

        expect(finalReturnPercent).toBeCloseTo(-10.0, 1);
    });

    it('Should handle high volatility with deposits', () => {
        // Cenário Misto:
        // D1: Buy 100 @ 10. (1000)
        // D2: Price 20 (+100%). Eq 2000.
        // D3: Buy 100 @ 20. (Flow 2000). Eq 4000.
        // D4: Price 10 (-50%). Eq 2000.
        // TWRR: (2.0) * (0.5) = 1.0 -> 0% Retorno acumulado.
        // O ativo foi de 10 pra 20 e voltou pra 10. O gestor entregou 0%.
        // (Apesar de o investidor ter perdido dinheiro no segundo aporte: comprou a 20, vale 10. 
        // ROI nominal seria negativo: Investiu 1000+2000=3000. Tem 2000. Prejuízo -1000 (-33%).
        // TWRR deve mostrar 0% pois o ativo voltou ao preço inicial).

        const transactions = [
            { date: '2024-01-01', type: 'BUY', quantity: 100, price: 10.00 },
            { date: '2024-01-03', type: 'BUY', quantity: 100, price: 20.00 }
        ];

        const priceHistory = [
            { date: '2024-01-01', close: 10.00 },
            { date: '2024-01-02', close: 20.00 },
            { date: '2024-01-03', close: 20.00 },
            { date: '2024-01-04', close: 10.00 }
        ];

        const finalQuota = calculateTWRR(transactions, priceHistory);
        const finalReturnPercent = ((finalQuota / 100) - 1) * 100;

        expect(finalReturnPercent).toBeCloseTo(0.0, 1);
    });

});
