import { fundamentusService } from '../services/fundamentusService.js';

async function run() {
    try {
        console.log("Iniciando teste do Fundamentus...\n");
        
        const stocksMap = await fundamentusService.getStocksMap();
        console.log(`✅ Ações carregadas: ${stocksMap.size}`);
        
        const fiiMap = await fundamentusService.getFIIsMap();
        console.log(`✅ FIIs carregados: ${fiiMap.size}`);
        
        console.log("\n--- Exemplos de Ações ---");
        let count = 0;
        for (const [ticker, data] of stocksMap.entries()) {
            if (count >= 3) break;
            console.log(`Ticker: ${ticker} | Preço: ${data.price} | Liquidez: ${data.liquidity}`);
            count++;
        }

        console.log("\n--- Exemplos de FIIs ---");
        count = 0;
        for (const [ticker, data] of fiiMap.entries()) {
            if (count >= 3) break;
            console.log(`Ticker: ${ticker} | Preço: ${data.price} | Liquidez: ${data.liquidity}`);
            count++;
        }

        console.log("\nTeste finalizado com sucesso!");
        process.exit(0);
    } catch (error) {
        console.error("\n❌ Erro durante o teste:", error.message);
        process.exit(1);
    }
}

run();
