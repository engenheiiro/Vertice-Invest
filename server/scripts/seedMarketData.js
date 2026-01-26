
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const assets = [
    // --- AÇÕES BR ---
    { ticker: 'VALE3', name: 'Vale', type: 'STOCK', sector: 'Mineração' },
    { ticker: 'PETR4', name: 'Petrobras PN', type: 'STOCK', sector: 'Petróleo e Gás' },
    { ticker: 'ITUB4', name: 'Itaú Unibanco', type: 'STOCK', sector: 'Financeiro' },
    { ticker: 'BBDC4', name: 'Bradesco PN', type: 'STOCK', sector: 'Financeiro' },
    { ticker: 'BBAS3', name: 'Banco do Brasil', type: 'STOCK', sector: 'Financeiro' },
    { ticker: 'WEGE3', name: 'Weg', type: 'STOCK', sector: 'Bens Industriais' },
    { ticker: 'ABEV3', name: 'Ambev', type: 'STOCK', sector: 'Bebidas' },
    { ticker: 'ITSA4', name: 'Itaúsa', type: 'STOCK', sector: 'Financeiro' }, 
    { ticker: 'RENT3', name: 'Localiza', type: 'STOCK', sector: 'Aluguel de Carros' },
    { ticker: 'BPAC11', name: 'BTG Pactual', type: 'STOCK', sector: 'Financeiro' },
    { ticker: 'GGBR4', name: 'Gerdau', type: 'STOCK', sector: 'Siderurgia' },
    { ticker: 'SUZB3', name: 'Suzano', type: 'STOCK', sector: 'Papel e Celulose' },
    { ticker: 'PRIO3', name: 'Prio', type: 'STOCK', sector: 'Petróleo e Gás' },
    { ticker: 'RDOR3', name: 'Rede D\'Or', type: 'STOCK', sector: 'Saúde / Hospital' },
    { ticker: 'RAIL3', name: 'Rumo', type: 'STOCK', sector: 'Logística' },
    { ticker: 'VIVT3', name: 'Telefônica Brasil', type: 'STOCK', sector: 'Telecom' },
    { ticker: 'TIMS3', name: 'TIM', type: 'STOCK', sector: 'Telecom' },
    { ticker: 'BBSE3', name: 'BB Seguridade', type: 'STOCK', sector: 'Seguros' },
    { ticker: 'CXSE3', name: 'Caixa Seguridade', type: 'STOCK', sector: 'Seguros' },
    { ticker: 'CMIG4', name: 'Cemig', type: 'STOCK', sector: 'Elétricas' },
    { ticker: 'EGIE3', name: 'Engie Brasil', type: 'STOCK', sector: 'Elétricas' },
    { ticker: 'TAEE11', name: 'Taesa', type: 'STOCK', sector: 'Elétricas' },
    { ticker: 'KLBN11', name: 'Klabin', type: 'STOCK', sector: 'Papel e Celulose' },
    { ticker: 'SANB11', name: 'Santander BR', type: 'STOCK', sector: 'Financeiro' },
    { ticker: 'CSAN3', name: 'Cosan', type: 'STOCK', sector: 'Petróleo e Gás' }, 
    { ticker: 'LREN3', name: 'Lojas Renner', type: 'STOCK', sector: 'Varejo / Vestuário' },
    { ticker: 'MGLU3', name: 'Magalu', type: 'STOCK', sector: 'Varejo / E-commerce' },
    { ticker: 'HAPV3', name: 'Hapvida', type: 'STOCK', sector: 'Saúde / Plano' },
    { ticker: 'EQTL3', name: 'Equatorial', type: 'STOCK', sector: 'Elétricas' },
    { ticker: 'RADL3', name: 'Raia Drogasil', type: 'STOCK', sector: 'Varejo / Farmácia' }, 
    { ticker: 'UGPA3', name: 'Ultrapar', type: 'STOCK', sector: 'Petróleo e Gás' }, 
    { ticker: 'CSNA3', name: 'CSN Siderúrgica', type: 'STOCK', sector: 'Siderurgia' },
    { ticker: 'GOAU4', name: 'Metalúrgica Gerdau', type: 'STOCK', sector: 'Siderurgia' },
    { ticker: 'ENEV3', name: 'Eneva', type: 'STOCK', sector: 'Elétricas' }, 
    { ticker: 'VBBR3', name: 'Vibra Energia', type: 'STOCK', sector: 'Petróleo e Gás' },
    { ticker: 'HYPE3', name: 'Hypera Pharma', type: 'STOCK', sector: 'Saúde / Pharma' },
    { ticker: 'CYRE3', name: 'Cyrela', type: 'STOCK', sector: 'Construção Civil' },
    { ticker: 'TOTS3', name: 'Totvs', type: 'STOCK', sector: 'Tecnologia' },
    { ticker: 'SESP4', name: 'Sanepar', type: 'STOCK', sector: 'Saneamento' },
    { ticker: 'SAPR11', name: 'Sanepar Unit', type: 'STOCK', sector: 'Saneamento' },
    { ticker: 'CPFE3', name: 'CPFL Energia', type: 'STOCK', sector: 'Elétricas' },
    { ticker: 'FLRY3', name: 'Fleury', type: 'STOCK', sector: 'Saúde / Medicina' },
    { ticker: 'MRFG3', name: 'Marfrig', type: 'STOCK', sector: 'Alimentos / Proteína' },
    { ticker: 'BEEF3', name: 'Minerva', type: 'STOCK', sector: 'Alimentos / Proteína' },
    { ticker: 'ALPA4', name: 'Alpargatas', type: 'STOCK', sector: 'Varejo / Vestuário' },
    { ticker: 'VAMO3', name: 'Vamos', type: 'STOCK', sector: 'Logística' },
    { ticker: 'ASAI3', name: 'Assaí', type: 'STOCK', sector: 'Varejo / Alimentos' },

    // --- FIIs ---
    { ticker: 'HGLG11', name: 'CSHG Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'KNRI11', name: 'Kinea Renda', type: 'FII', sector: 'Híbrido (Tijolo)' },
    { ticker: 'MXRF11', name: 'Maxi Renda', type: 'FII', sector: 'Papel (Híbrido)' },
    { ticker: 'XPML11', name: 'XP Malls', type: 'FII', sector: 'Shoppings' },
    { ticker: 'VISC11', name: 'Vinci Shopping', type: 'FII', sector: 'Shoppings' },
    { ticker: 'XPLG11', name: 'XP Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'HGBS11', name: 'Hedge Brasil Shopping', type: 'FII', sector: 'Shoppings' },
    { ticker: 'HGRU11', name: 'CSHG Renda Urbana', type: 'FII', sector: 'Renda Urbana' },
    { ticker: 'BTLG11', name: 'BTG Pactual Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'KNIP11', name: 'Kinea Índices', type: 'FII', sector: 'Papel (IPCA)' },
    { ticker: 'IRDM11', name: 'Iridium Recebíveis', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'CPTS11', name: 'Capitânia Securities', type: 'FII', sector: 'Papel (High Grade)' },
    { ticker: 'RECR11', name: 'Rec Recebíveis', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'GARE11', name: 'Guardian Real Estate', type: 'FII', sector: 'Híbrido' },
    { ticker: 'TRXF11', name: 'TRX Real Estate', type: 'FII', sector: 'Renda Urbana' },
    { ticker: 'ALZR11', name: 'Alianza Trust', type: 'FII', sector: 'Híbrido (Tijolo)' },
    { ticker: 'VILG11', name: 'Vinci Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'HFOF11', name: 'Hedge Top FOF', type: 'FII', sector: 'FOF' },
    { ticker: 'BRCO11', name: 'Bresco Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'HGCR11', name: 'CSHG Recebíveis', type: 'FII', sector: 'Papel (CDI)' },
    { ticker: 'KNSC11', name: 'Kinea Securities', type: 'FII', sector: 'Papel (Híbrido)' },
    { ticker: 'HSML11', name: 'HSI Malls', type: 'FII', sector: 'Shoppings' },
    { ticker: 'LVBI11', name: 'VBI Logística', type: 'FII', sector: 'Logística' },
    { ticker: 'PVBI11', name: 'VBI Prime Properties', type: 'FII', sector: 'Lajes Corporativas' },
    { ticker: 'JSRE11', name: 'JS Real Estate', type: 'FII', sector: 'Lajes Corporativas' },
    { ticker: 'HGNG11', name: 'HG Rio', type: 'FII', sector: 'Renda Urbana' },
    { ticker: 'RBRR11', name: 'RBR Rendimento', type: 'FII', sector: 'Papel (High Grade)' },
    { ticker: 'RBRP11', name: 'RBR Properties', type: 'FII', sector: 'Lajes Corporativas' },
    { ticker: 'SARE11', name: 'Santander Renda', type: 'FII', sector: 'Híbrido' },
    { ticker: 'TEPP11', name: 'Tellus Properties', type: 'FII', sector: 'Lajes Corporativas' },
    { ticker: 'RBVA11', name: 'Rio Bravo Varejo', type: 'FII', sector: 'Renda Urbana' },
    { ticker: 'GGRC11', name: 'GGR Covepi', type: 'FII', sector: 'Logística' },
    { ticker: 'XPIN11', name: 'XP Industrial', type: 'FII', sector: 'Logística' },
    { ticker: 'DEVA11', name: 'Devant Recebíveis', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'HCTR11', name: 'Hectare CE', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'VSLH11', name: 'Versalhes', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'TORD11', name: 'Tordesilhas', type: 'FII', sector: 'Híbrido' },
    { ticker: 'VGHF11', name: 'Valora Hedge', type: 'FII', sector: 'Papel (Hedge)' },
    { ticker: 'VGIR11', name: 'Valora RE', type: 'FII', sector: 'Papel (CDI)' },
    { ticker: 'RBRF11', name: 'RBR Alpha', type: 'FII', sector: 'FOF' },
    { ticker: 'KFOF11', name: 'Kinea FOF', type: 'FII', sector: 'FOF' },
    { ticker: 'XPSF11', name: 'XP Selection', type: 'FII', sector: 'FOF' },
    { ticker: 'SNCI11', name: 'Suno Recebíveis', type: 'FII', sector: 'Papel (IPCA)' },
    { ticker: 'SNAG11', name: 'Suno Agro', type: 'FII', sector: 'Fiagro' }, 
    { ticker: 'VGIP11', name: 'Valora IP', type: 'FII', sector: 'Papel (IPCA)' },
    { ticker: 'CVBI11', name: 'VBI CRI', type: 'FII', sector: 'Papel (Híbrido)' },
    { ticker: 'MCCI11', name: 'Mauá Capital', type: 'FII', sector: 'Papel (IPCA)' },
    { ticker: 'URPR11', name: 'Urca Prime', type: 'FII', sector: 'Papel (High Yield)' },
    { ticker: 'HABT11', name: 'Habitat', type: 'FII', sector: 'Papel (High Yield)' },

    // --- CRYPTOS ---
    { ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO', currency: 'USD', sector: 'Blockchain' },
    { ticker: 'ETH', name: 'Ethereum', type: 'CRYPTO', currency: 'USD', sector: 'Smart Contracts' },
    { ticker: 'SOL', name: 'Solana', type: 'CRYPTO', currency: 'USD', sector: 'Smart Contracts' },
    { ticker: 'BNB', name: 'Binance Coin', type: 'CRYPTO', currency: 'USD', sector: 'Exchange Token' },
    { ticker: 'XRP', name: 'Ripple', type: 'CRYPTO', currency: 'USD', sector: 'Pagamentos' },
    { ticker: 'ADA', name: 'Cardano', type: 'CRYPTO', currency: 'USD', sector: 'Smart Contracts' },
    { ticker: 'DOT', name: 'Polkadot', type: 'CRYPTO', currency: 'USD', sector: 'Interoperabilidade' },
    { ticker: 'LINK', name: 'Chainlink', type: 'CRYPTO', currency: 'USD', sector: 'Oracle' },
    { ticker: 'MATIC', name: 'Polygon', type: 'CRYPTO', currency: 'USD', sector: 'Scaling' },
    { ticker: 'LTC', name: 'Litecoin', type: 'CRYPTO', currency: 'USD', sector: 'Pagamentos' },
    { ticker: 'DOGE', name: 'Dogecoin', type: 'CRYPTO', currency: 'USD', sector: 'Meme' },
    { ticker: 'AVAX', name: 'Avalanche', type: 'CRYPTO', currency: 'USD', sector: 'Smart Contracts' },
    { ticker: 'UNI', name: 'Uniswap', type: 'CRYPTO', currency: 'USD', sector: 'DeFi' },
    { ticker: 'ATOM', name: 'Cosmos', type: 'CRYPTO', currency: 'USD', sector: 'Interoperabilidade' },
    { ticker: 'XLM', name: 'Stellar', type: 'CRYPTO', currency: 'USD', sector: 'Pagamentos' },

    // --- STOCKS US (GICS Standard) ---
    { ticker: 'AAPL', name: 'Apple Inc.', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'MSFT', name: 'Microsoft Corp', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' },
    { ticker: 'AMZN', name: 'Amazon.com', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'NVDA', name: 'NVIDIA Corp', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'META', name: 'Meta Platforms', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' },
    { ticker: 'TSLA', name: 'Tesla Inc', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'BRK-B', name: 'Berkshire Hathaway', type: 'STOCK_US', currency: 'USD', sector: 'Conglomerado' }, 
    { ticker: 'JPM', name: 'JPMorgan Chase', type: 'STOCK_US', currency: 'USD', sector: 'Financeiro' },
    { ticker: 'V', name: 'Visa Inc.', type: 'STOCK_US', currency: 'USD', sector: 'Meios de Pagamento' }, 
    { ticker: 'JNJ', name: 'Johnson & Johnson', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'WMT', name: 'Walmart Inc.', type: 'STOCK_US', currency: 'USD', sector: 'Consumo não Cíclico' },
    { ticker: 'PG', name: 'Procter & Gamble', type: 'STOCK_US', currency: 'USD', sector: 'Consumo não Cíclico' },
    { ticker: 'MA', name: 'Mastercard Inc', type: 'STOCK_US', currency: 'USD', sector: 'Meios de Pagamento' }, 
    { ticker: 'HD', name: 'Home Depot', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'KO', name: 'Coca-Cola Co', type: 'STOCK_US', currency: 'USD', sector: 'Consumo não Cíclico' },
    { ticker: 'PEP', name: 'PepsiCo Inc', type: 'STOCK_US', currency: 'USD', sector: 'Consumo não Cíclico' },
    { ticker: 'COST', name: 'Costco Wholesale', type: 'STOCK_US', currency: 'USD', sector: 'Consumo não Cíclico' },
    { ticker: 'MCD', name: 'McDonald\'s', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'CSCO', name: 'Cisco Systems', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'CRM', name: 'Salesforce', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'AMD', name: 'Advanced Micro Dev', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'NFLX', name: 'Netflix Inc', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' },
    { ticker: 'DIS', name: 'Walt Disney', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' },
    { ticker: 'NKE', name: 'Nike Inc', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'O', name: 'Realty Income', type: 'STOCK_US', currency: 'USD', sector: 'Imobiliário' },
    { ticker: 'T', name: 'AT&T Inc', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' }, 
    { ticker: 'VZ', name: 'Verizon', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' }, 
    { ticker: 'PFE', name: 'Pfizer Inc', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'XOM', name: 'Exxon Mobil', type: 'STOCK_US', currency: 'USD', sector: 'Energia' },
    { ticker: 'CVX', name: 'Chevron', type: 'STOCK_US', currency: 'USD', sector: 'Energia' },
    { ticker: 'ABBV', name: 'AbbVie', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'MRK', name: 'Merck & Co', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'AVGO', name: 'Broadcom', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'ACN', name: 'Accenture', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'ADBE', name: 'Adobe Inc', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'LIN', name: 'Linde plc', type: 'STOCK_US', currency: 'USD', sector: 'Materiais Básicos' },
    { ticker: 'ORCL', name: 'Oracle', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'CMCSA', name: 'Comcast', type: 'STOCK_US', currency: 'USD', sector: 'Comunicações' },
    { ticker: 'WFC', name: 'Wells Fargo', type: 'STOCK_US', currency: 'USD', sector: 'Financeiro' },
    { ticker: 'BAC', name: 'Bank of America', type: 'STOCK_US', currency: 'USD', sector: 'Financeiro' },
    { ticker: 'INTC', name: 'Intel', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'QCOM', name: 'Qualcomm', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'IBM', name: 'IBM', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'AMGN', name: 'Amgen', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'HON', name: 'Honeywell', type: 'STOCK_US', currency: 'USD', sector: 'Bens Industriais' },
    { ticker: 'UNH', name: 'UnitedHealth', type: 'STOCK_US', currency: 'USD', sector: 'Saúde' },
    { ticker: 'TXN', name: 'Texas Instruments', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
    { ticker: 'SBUX', name: 'Starbucks', type: 'STOCK_US', currency: 'USD', sector: 'Consumo Cíclico' },
    { ticker: 'BA', name: 'Boeing', type: 'STOCK_US', currency: 'USD', sector: 'Bens Industriais' }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("🌱 Conectado ao MongoDB para Seed...");

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
        console.log("👉 Setores refinados com sucesso.");
        process.exit(0);
    } catch (e) {
        console.error("Erro no seed:", e);
        process.exit(1);
    }
};

seed();
