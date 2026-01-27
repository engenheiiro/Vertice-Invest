
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

const IGNORED_TICKERS = [
    'ISAE4', 'PLAG11', 'FIGS11', 'FIIB11', 'OSXB3', 'MNPR3', 'JFEN3', 'PPAR3', 'MERC4'
];

// Mapeamento Setorial para cálculo de Beta/Risco
const SECTOR_MAP = {
    'Bancos': ['ITUB', 'BBDC', 'BBAS', 'SANB', 'BPAC', 'ABCB', 'BRSR', 'BNBR', 'BPAN', 'BAZA', 'BMEB', 'PINE', 'BRBI'],
    'Elétricas': ['ELET', 'EGIE', 'TAEE', 'TRPL', 'ALUP', 'CPFE', 'CMIG', 'EQTL', 'NEOE', 'ENGI', 'ENEV', 'LIGT', 'CPLE', 'CLSC', 'AURE', 'MEGA'],
    'Saneamento': ['SBSP', 'SAPR', 'CSMG', 'AMBP', 'ORVR'],
    'Seguros': ['BBSE', 'CXSE', 'PSSA', 'IRBR', 'WIZC', 'CSUD'],
    'Telecom': ['VIVT', 'TIMS', 'FIQE', 'OIBR', 'DESK', 'BRST'],
    'Mineração': ['VALE', 'CMIN', 'BRAP', 'AURA', 'CBAV'],
    'Petróleo': ['PETR', 'PRIO', 'RECV', 'UGPA', 'VBBR', 'CSAN', 'RRRP', 'ENAT', 'BRAV'],
    'Papel e Celulose': ['SUZB', 'KLBN', 'RANI'],
    'Construção': ['CYRE', 'EZTC', 'MRVE', 'CURY', 'DIRR', 'TEND', 'JHSF', 'LAVV', 'TRIS', 'EVEN', 'MTRE', 'HBOR', 'MELK', 'GFSA', 'PLPL'],
    'Varejo': ['MGLU', 'LREN', 'ARZZ', 'SOMA', 'ALPA', 'ASAI', 'CRFB', 'GMAT', 'PCAR', 'PETZ', 'RADL', 'PGMN', 'PNVL', 'CEAB', 'CAMB', 'AMER', 'BHIA', 'LJQQ', 'GUAR'],
    'Logística': ['RAIL', 'STBP', 'HBSA', 'LOGG', 'TGMA', 'PORT', 'LOGN', 'TPIS', 'SIMH', 'JSLG', 'VAMO']
};

const getSector = (ticker, type) => {
    if (type === 'FII') return 'FII'; 
    const root = ticker.substring(0, 4);
    for (const [sector, prefixes] of Object.entries(SECTOR_MAP)) {
        if (prefixes.includes(root)) return sector;
    }
    return 'Outros';
};

const parseBrFloat = (str) => {
    if (!str || str.trim() === '-') return 0;
    const cleanStr = str.replace(/\./g, '').replace(',', '.').replace('%', '').trim();
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
};

export const marketDataService = {
    normalizeSymbol(ticker, type) {
        if (!ticker) return '';
        let t = ticker.toUpperCase().trim();
        return t.endsWith('.SA') ? t : `${t}.SA`;
    },

    async getMarketDataByTicker(ticker) {
        // Mock simples para garantir funcionalidade sem API externa pesada no momento
        return { price: 0, change: 0, name: ticker };
    },

    async getMacroIndicators() {
        const indicators = {
            selic: { value: 11.25, name: 'Selic Meta', source: 'BCB' },
            cdi: { value: 11.15, name: 'CDI', source: 'Cetip' },
            ipca: { value: 4.50, name: 'IPCA (12m)', source: 'BCB' },
            ibov: { value: 128000, change: 0.5, name: 'Ibovespa', source: 'B3' },
            usd: { value: 5.75, change: -0.2, name: 'Dólar (PTAX)', source: 'B3' },
            spx: { value: 5200, change: 0.1, name: 'S&P 500', source: 'NYSE' },
            btc: { value: 65000, change: 1.5, name: 'Bitcoin', source: 'Global' }
        };
        // Aqui poderíamos conectar com API do BCB real se necessário
        return indicators;
    },

    async getMarketData(assetClass) {
        try {
            const isBrasil = assetClass === 'STOCK' || assetClass === 'FII' || assetClass === 'BRASIL_10';
            const results = [];
            
            const dbAssets = await MarketAsset.find({ 
                isActive: true,
                type: isBrasil ? { $in: ['STOCK', 'FII'] } : assetClass 
            }).lean();
            
            const dbMap = new Map(dbAssets.map(a => [a.ticker, a]));

            if (isBrasil) {
                let fundDataMap = new Map();

                // STOCK DATA
                if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
                    const stockMap = await fundamentusService.getStocksMap();
                    if (stockMap) stockMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'STOCK' }));
                }
                
                // FII DATA
                if (assetClass === 'FII' || assetClass === 'BRASIL_10') {
                    const fiiMap = await fundamentusService.getFIIsMap();
                    if (fiiMap) fiiMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'FII' }));
                }

                logger.info(`🔄 Normalizando ${fundDataMap.size} ativos BR...`);

                // Filtragem e Deduplicação
                const uniqueAssets = new Map();
                for (const [ticker, fundData] of fundDataMap) {
                    if (IGNORED_TICKERS.includes(ticker)) continue;
                    
                    const liquidity = fundData.liq2m || fundData.liquidity || 0;
                    if (liquidity < 250000) continue; // Liquidez mínima R$ 250k/dia

                    const rootTicker = ticker.substring(0, 4); 
                    
                    // Preferência por ON (3) ou PN (4) com maior liquidez
                    if (fundData.type === 'STOCK') {
                        if (uniqueAssets.has(rootTicker)) {
                            const existing = uniqueAssets.get(rootTicker);
                            if (liquidity > existing.liquidity) {
                                uniqueAssets.set(rootTicker, { ...fundData, liquidity });
                            }
                        } else {
                            uniqueAssets.set(rootTicker, { ...fundData, liquidity });
                        }
                    } else {
                        uniqueAssets.set(ticker, { ...fundData, liquidity });
                    }
                }

                const bulkOps = [];

                for (const fundData of uniqueAssets.values()) {
                    const ticker = fundData.ticker;
                    const dbInfo = dbMap.get(ticker);
                    const sector = getSector(ticker, fundData.type);
                    const name = dbInfo?.name || ticker;

                    // Persistência
                    bulkOps.push({
                        updateOne: {
                            filter: { ticker: ticker },
                            update: { 
                                $set: {
                                    lastPrice: fundData.price,
                                    netDebt: fundData.netDebt || 0,
                                    marketCap: fundData.marketCap || 0,
                                    vacancy: fundData.vacancy || 0,
                                    p_vp: fundData.pvp || 0,
                                    dy: fundData.dy || 0,
                                    sector: sector,
                                    updatedAt: new Date()
                                }
                            },
                            upsert: true
                        }
                    });

                    results.push({
                        ticker: ticker,
                        type: fundData.type,
                        name: name,
                        sector: sector, 
                        price: fundData.price,
                        change: 0, 
                        metrics: {
                            // Valuation
                            pl: fundData.pl,
                            pvp: fundData.pvp,
                            evEbitda: fundData.evEbitda,
                            psr: fundData.psr,
                            earningsYield: fundData.pl > 0 ? (1 / fundData.pl) * 100 : 0,
                            
                            // Efficiency
                            roe: fundData.roe,
                            roic: fundData.roic,
                            netMargin: fundData.netMargin,
                            
                            // Financial Health
                            dy: fundData.dy,
                            currentRatio: fundData.currentRatio,
                            debtToEquity: fundData.divBrutaPatrim || 0, // Dívida Bruta/PL
                            netDebt: fundData.netDebt || 0,
                            
                            // Growth & Size
                            revenueGrowth: fundData.cresRec5a || 0,
                            marketCap: fundData.marketCap || 0,
                            avgLiquidity: fundData.liquidity,
                            
                            // FII Specifics
                            vacancy: fundData.vacancy || 0,
                            capRate: fundData.capRate || 0,
                            ffoYield: fundData.ffoYield || 0,
                            qtdImoveis: fundData.qtdImoveis || 0,
                            vpCota: fundData.vpCota || 0,
                            
                            dataSource: 'Fundamentus'
                        }
                    });
                }

                if (bulkOps.length > 0) {
                    await MarketAsset.bulkWrite(bulkOps, { ordered: false });
                }

            } else {
                return [];
            }

            return results;
        } catch (error) {
            logger.error(`Erro MarketData: ${error.message}`);
            return [];
        }
    }
};

export const fundamentusService = {
    async getStocksMap() {
        try {
            const response = await axios.get('https://www.fundamentus.com.br/resultado.php', {
                headers: HEADERS, responseType: 'arraybuffer', timeout: 20000 
            });
            const decodedData = iconv.decode(response.data, 'iso-8859-1');
            const $ = cheerio.load(decodedData);
            const dataMap = new Map();

            $('table#resultado tbody tr').each((i, el) => {
                const tds = $(el).find('td');
                const ticker = $(tds[0]).text().trim().toUpperCase();
                const price = parseBrFloat($(tds[1]).text());
                const pl = parseBrFloat($(tds[2]).text());
                const pvp = parseBrFloat($(tds[3]).text());
                const patrimLiq = parseBrFloat($(tds[18]).text());
                
                // Engenharia Reversa para MarketCap e Dívida Líquida (Estimativa)
                const marketCap = (patrimLiq && pvp) ? patrimLiq * pvp : 0;
                
                // Tentativa de extrair Dívida Líquida via EV/EBIT (Aprox)
                // EV = MktCap + NetDebt => NetDebt = EV - MktCap
                // EV = EBIT * (EV/EBIT)
                const pEbit = parseBrFloat($(tds[8]).text());
                const evEbit = parseBrFloat($(tds[10]).text());
                let netDebt = 0;
                if (marketCap > 0 && pEbit > 0 && evEbit > 0) {
                    const ebit = marketCap / pEbit;
                    const ev = ebit * evEbit;
                    netDebt = ev - marketCap;
                }

                dataMap.set(ticker, {
                    ticker, price, pl, pvp,
                    psr: parseBrFloat($(tds[4]).text()),
                    dy: parseBrFloat($(tds[5]).text()),
                    pEbit, evEbit,
                    evEbitda: parseBrFloat($(tds[11]).text()),
                    netMargin: parseBrFloat($(tds[13]).text()),
                    currentRatio: parseBrFloat($(tds[14]).text()),
                    roic: parseBrFloat($(tds[15]).text()),
                    roe: parseBrFloat($(tds[16]).text()),
                    liq2m: parseBrFloat($(tds[17]).text()),
                    patrimLiq,
                    divBrutaPatrim: parseBrFloat($(tds[19]).text()), // Proxies
                    cresRec5a: parseBrFloat($(tds[20]).text()),
                    marketCap, netDebt
                });
            });
            return dataMap;
        } catch (e) {
            console.error(e);
            return new Map();
        }
    },

    async getFIIsMap() {
        try {
            const response = await axios.get('https://www.fundamentus.com.br/fii_resultado.php', {
                headers: HEADERS, responseType: 'arraybuffer', timeout: 20000
            });
            const decodedData = iconv.decode(response.data, 'iso-8859-1');
            const $ = cheerio.load(decodedData);
            const dataMap = new Map();

            $('table#tabelaResultado tbody tr').each((i, el) => {
                const tds = $(el).find('td');
                const ticker = $(tds[0]).text().trim().toUpperCase();
                const price = parseBrFloat($(tds[2]).text());
                const pvp = parseBrFloat($(tds[5]).text());
                const dy = parseBrFloat($(tds[4]).text());
                const ffoYield = parseBrFloat($(tds[3]).text());
                
                const marketCap = parseBrFloat($(tds[6]).text()); // Valor de Mercado
                const vacancy = parseBrFloat($(tds[12]).text());
                
                const vpCota = (price > 0 && pvp > 0) ? price / pvp : 0;

                dataMap.set(ticker, {
                    ticker, 
                    sector: $(tds[1]).text().trim(),
                    price, dy, pvp, ffoYield,
                    marketCap, 
                    liquidity: parseBrFloat($(tds[7]).text()),
                    qtdImoveis: parseBrFloat($(tds[8]).text()),
                    capRate: parseBrFloat($(tds[11]).text()),
                    vacancy, vpCota
                });
            });
            return dataMap;
        } catch (e) { return new Map(); }
    }
};
