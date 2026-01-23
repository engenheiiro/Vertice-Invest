import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const assets = [
    // --- AÇÕES BR (Sólidas / Ibovespa) ---
    { ticker: 'VALE3', name: 'Vale', type: 'STOCK' },
    { ticker: 'PETR4', name: 'Petrobras PN', type: 'STOCK' },
    { ticker: 'ITUB4', name: 'Itaú Unibanco', type: 'STOCK' },
    { ticker: 'BBDC4', name: 'Bradesco PN', type: 'STOCK' },
    { ticker: 'BBAS3', name: 'Banco do Brasil', type: 'STOCK' },
    { ticker: 'WEGE3', name: 'Weg', type: 'STOCK' },
    { ticker: 'ABEV3', name: 'Ambev', type: 'STOCK' },
    { ticker: 'ITSA4', name: 'Itaúsa', type: 'STOCK' },
    { ticker: 'RENT3', name: 'Localiza', type: 'STOCK' },
    { ticker: 'BPAC11', name: 'BTG Pactual', type: 'STOCK' },
    { ticker: 'GGBR4', name: 'Gerdau', type: 'STOCK' },
    { ticker: 'SUZB3', name: 'Suzano', type: 'STOCK' },
    { ticker: 'PRIO3', name: 'Prio', type: 'STOCK' },
    { ticker: 'RDOR3', name: 'Rede D\'Or', type: 'STOCK' },
    { ticker: 'RAIL3', name: 'Rumo', type: 'STOCK' },
    { ticker: 'VIVT3', name: 'Telefônica Brasil', type: 'STOCK' },
    { ticker: 'TIMS3', name: 'TIM', type: 'STOCK' },
    { ticker: 'BBSE3', name: 'BB Seguridade', type: 'STOCK' },
    { ticker: 'CXSE3', name: 'Caixa Seguridade', type: 'STOCK' },
    { ticker: 'CMIG4', name: 'Cemig', type: 'STOCK' },
    { ticker: 'EGIE3', name: 'Engie Brasil', type: 'STOCK' },
    { ticker: 'TAEE11', name: 'Taesa', type: 'STOCK' },
    { ticker: 'KLBN11', name: 'Klabin', type: 'STOCK' },
    { ticker: 'SANB11', name: 'Santander BR', type: 'STOCK' },
    { ticker: 'CSAN3', name: 'Cosan', type: 'STOCK' },
    { ticker: 'LREN3', name: 'Lojas Renner', type: 'STOCK' },
    { ticker: 'MGLU3', name: 'Magalu', type: 'STOCK' },
    { ticker: 'HAPV3', name: 'Hapvida', type: 'STOCK' },
    { ticker: 'EQTL3', name: 'Equatorial', type: 'STOCK' },
    { ticker: 'RADL3', name: 'Raia Drogasil', type: 'STOCK' },
    { ticker: 'UGPA3', name: 'Ultrapar', type: 'STOCK' },
    { ticker: 'CSNA3', name: 'CSN Siderúrgica', type: 'STOCK' },
    { ticker: 'GOAU4', name: 'Metalúrgica Gerdau', type: 'STOCK' },
    { ticker: 'ENEV3', name: 'Eneva', type: 'STOCK' },
    { ticker: 'VBBR3', name: 'Vibra Energia', type: 'STOCK' },
    { ticker: 'HYPE3', name: 'Hypera Pharma', type: 'STOCK' },
    { ticker: 'CYRE3', name: 'Cyrela', type: 'STOCK' },
    { ticker: 'TOTS3', name: 'Totvs', type: 'STOCK' },
    { ticker: 'SESP4', name: 'Sanepar', type: 'STOCK' },
    { ticker: 'SAPR11', name: 'Sanepar Unit', type: 'STOCK' },
    { ticker: 'CPFE3', name: 'CPFL Energia', type: 'STOCK' },
    { ticker: 'FLRY3', name: 'Fleury', type: 'STOCK' },
    { ticker: 'MRFG3', name: 'Marfrig', type: 'STOCK' },
    { ticker: 'BEEF3', name: 'Minerva', type: 'STOCK' },
    { ticker: 'ALPA4', name: 'Alpargatas', type: 'STOCK' },
    { ticker: 'VAMO3', name: 'Vamos', type: 'STOCK' },
    { ticker: 'ASAI3', name: 'Assaí', type: 'STOCK' },

    // --- FIIs ---
    { ticker: 'HGLG11', name: 'CSHG Logística', type: 'FII' },
    { ticker: 'KNRI11', name: 'Kinea Renda', type: 'FII' },
    { ticker: 'MXRF11', name: 'Maxi Renda', type: 'FII' },
    { ticker: 'XPML11', name: 'XP Malls', type: 'FII' },
    { ticker: 'VISC11', name: 'Vinci Shopping', type: 'FII' },
    { ticker: 'XPLG11', name: 'XP Logística', type: 'FII' },
    { ticker: 'HGBS11', name: 'Hedge Brasil Shopping', type: 'FII' },
    { ticker: 'HGRU11', name: 'CSHG Renda Urbana', type: 'FII' },
    { ticker: 'BTLG11', name: 'BTG Pactual Logística', type: 'FII' },
    { ticker: 'KNIP11', name: 'Kinea Índices', type: 'FII' },
    { ticker: 'IRDM11', name: 'Iridium Recebíveis', type: 'FII' },
    { ticker: 'CPTS11', name: 'Capitânia Securities', type: 'FII' },
    { ticker: 'RECR11', name: 'Rec Recebíveis', type: 'FII' },
    { ticker: 'GARE11', name: 'Guardian Real Estate', type: 'FII' },
    { ticker: 'TRXF11', name: 'TRX Real Estate', type: 'FII' },
    { ticker: 'ALZR11', name: 'Alianza Trust', type: 'FII' },
    { ticker: 'VILG11', name: 'Vinci Logística', type: 'FII' },
    { ticker: 'HFOF11', name: 'Hedge Top FOF', type: 'FII' },
    { ticker: 'BRCO11', name: 'Bresco Logística', type: 'FII' },
    { ticker: 'HGCR11', name: 'CSHG Recebíveis', type: 'FII' },
    { ticker: 'KNSC11', name: 'Kinea Securities', type: 'FII' },
    { ticker: 'HSML11', name: 'HSI Malls', type: 'FII' },
    { ticker: 'LVBI11', name: 'VBI Logística', type: 'FII' },
    { ticker: 'PVBI11', name: 'VBI Prime Properties', type: 'FII' },
    { ticker: 'JSRE11', name: 'JS Real Estate', type: 'FII' },
    { ticker: 'HGNG11', name: 'HG Rio', type: 'FII' },
    { ticker: 'RBRR11', name: 'RBR Rendimento', type: 'FII' },
    { ticker: 'RBRP11', name: 'RBR Properties', type: 'FII' },
    { ticker: 'SARE11', name: 'Santander Renda', type: 'FII' },
    { ticker: 'TEPP11', name: 'Tellus Properties', type: 'FII' },
    { ticker: 'RBVA11', name: 'Rio Bravo Varejo', type: 'FII' },
    { ticker: 'GGRC11', name: 'GGR Covepi', type: 'FII' },
    { ticker: 'XPIN11', name: 'XP Industrial', type: 'FII' },
    { ticker: 'DEVA11', name: 'Devant Recebíveis', type: 'FII' },
    { ticker: 'HCTR11', name: 'Hectare CE', type: 'FII' },
    { ticker: 'VSLH11', name: 'Versalhes', type: 'FII' },
    { ticker: 'TORD11', name: 'Tordesilhas', type: 'FII' },
    { ticker: 'VGHF11', name: 'Valora Hedge', type: 'FII' },
    { ticker: 'VGIR11', name: 'Valora RE', type: 'FII' },
    { ticker: 'RBRF11', name: 'RBR Alpha', type: 'FII' },
    { ticker: 'KFOF11', name: 'Kinea FOF', type: 'FII' },
    { ticker: 'XPSF11', name: 'XP Selection', type: 'FII' },
    { ticker: 'SNCI11', name: 'Suno Recebíveis', type: 'FII' },
    { ticker: 'SNAG11', name: 'Suno Agro', type: 'FII' },
    { ticker: 'VGIP11', name: 'Valora IP', type: 'FII' },
    { ticker: 'CVBI11', name: 'VBI CRI', type: 'FII' },
    { ticker: 'MCCI11', name: 'Mauá Capital', type: 'FII' },
    { ticker: 'URPR11', name: 'Urca Prime', type: 'FII' },
    { ticker: 'HABT11', name: 'Habitat', type: 'FII' },

    // --- CRYPTOS ---
    { ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'ETH', name: 'Ethereum', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'SOL', name: 'Solana', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'BNB', name: 'Binance Coin', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'XRP', name: 'Ripple', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'ADA', name: 'Cardano', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'DOT', name: 'Polkadot', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'LINK', name: 'Chainlink', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'MATIC', name: 'Polygon', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'LTC', name: 'Litecoin', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'DOGE', name: 'Dogecoin', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'AVAX', name: 'Avalanche', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'UNI', name: 'Uniswap', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'ATOM', name: 'Cosmos', type: 'CRYPTO', currency: 'USD' },
    { ticker: 'XLM', name: 'Stellar', type: 'CRYPTO', currency: 'USD' },

    // --- STOCKS US ---
    { ticker: 'AAPL', name: 'Apple Inc.', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'MSFT', name: 'Microsoft Corp', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'AMZN', name: 'Amazon.com', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'NVDA', name: 'NVIDIA Corp', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'META', name: 'Meta Platforms', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'TSLA', name: 'Tesla Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'BRK-B', name: 'Berkshire Hathaway', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'JPM', name: 'JPMorgan Chase', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'V', name: 'Visa Inc.', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'JNJ', name: 'Johnson & Johnson', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'WMT', name: 'Walmart Inc.', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'PG', name: 'Procter & Gamble', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'MA', name: 'Mastercard Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'HD', name: 'Home Depot', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'KO', name: 'Coca-Cola Co', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'PEP', name: 'PepsiCo Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'COST', name: 'Costco Wholesale', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'MCD', name: 'McDonald\'s', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'CSCO', name: 'Cisco Systems', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'CRM', name: 'Salesforce', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'AMD', name: 'Advanced Micro Dev', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'NFLX', name: 'Netflix Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'DIS', name: 'Walt Disney', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'NKE', name: 'Nike Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'O', name: 'Realty Income', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'T', name: 'AT&T Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'VZ', name: 'Verizon', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'PFE', name: 'Pfizer Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'XOM', name: 'Exxon Mobil', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'CVX', name: 'Chevron', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'ABBV', name: 'AbbVie', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'MRK', name: 'Merck & Co', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'AVGO', name: 'Broadcom', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'ACN', name: 'Accenture', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'ADBE', name: 'Adobe Inc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'LIN', name: 'Linde plc', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'ORCL', name: 'Oracle', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'CMCSA', name: 'Comcast', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'WFC', name: 'Wells Fargo', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'BAC', name: 'Bank of America', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'INTC', name: 'Intel', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'QCOM', name: 'Qualcomm', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'IBM', name: 'IBM', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'AMGN', name: 'Amgen', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'HON', name: 'Honeywell', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'UNH', name: 'UnitedHealth', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'TXN', name: 'Texas Instruments', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'SBUX', name: 'Starbucks', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'BA', name: 'Boeing', type: 'STOCK_US', currency: 'USD' }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("🌱 Conectado ao MongoDB para Seed...");

        // CRÍTICO: Limpa toda a coleção para evitar dados obsoletos
        console.log("🧹 Limpando coleção antiga de ativos...");
        await MarketAsset.deleteMany({});
        console.log("✅ Coleção limpa.");

        let count = 0;
        for (const asset of assets) {
            await MarketAsset.create(asset);
            process.stdout.write(`.`);
            count++;
        }

        console.log(`\n✅ Base de dados recriada com ${count} ativos.`);
        console.log("👉 Dados obsoletos removidos com sucesso.");
        process.exit(0);
    } catch (e) {
        console.error("Erro no seed:", e);
        process.exit(1);
    }
};

seed();