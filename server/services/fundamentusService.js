
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import logger from '../config/logger.js';

// Headers completos mimetizando um navegador Chrome Desktop Real
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br', // Importante para WAFs
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Referer': 'https://www.google.com/', // Engana verificações de origem simples
    'Pragma': 'no-cache'
};

const parseBrFloat = (str) => {
    if (!str || str.trim() === '-') return 0;
    // Remove pontos de milhar e substitui vírgula decimal por ponto
    const cleanStr = str.replace(/\./g, '').replace(',', '.').replace('%', '').trim();
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
};

export const fundamentusService = {
    async getStocksMap() {
        try {
            logger.info("🔎 Iniciando Scraping Detalhado Fundamentus (Ações)...");
            
            const response = await axios.get('https://www.fundamentus.com.br/resultado.php', {
                headers: HEADERS,
                responseType: 'arraybuffer',
                timeout: 25000, // Timeout aumentado para evitar falhas em redes lentas
                decompress: true // Garante descompressão do gzip
            });

            const decodedData = iconv.decode(response.data, 'iso-8859-1');
            const $ = cheerio.load(decodedData);
            const dataMap = new Map();

            $('table#resultado tbody tr').each((i, el) => {
                const tds = $(el).find('td');
                const ticker = $(tds[0]).text().trim().toUpperCase();
                
                // Validação básica para ignorar linhas quebradas
                if (!ticker || ticker.length < 4) return;

                // Extração Básica
                const price = parseBrFloat($(tds[1]).text());
                const pl = parseBrFloat($(tds[2]).text());
                const pvp = parseBrFloat($(tds[3]).text());
                const psr = parseBrFloat($(tds[4]).text());
                const pAtivo = parseBrFloat($(tds[6]).text());
                const pEbit = parseBrFloat($(tds[8]).text());
                const evEbit = parseBrFloat($(tds[10]).text());
                const patrimLiq = parseBrFloat($(tds[18]).text());

                // --- ENGENHARIA REVERSA DE DADOS FINANCEIROS ---
                // Cálculos baseados na consistência matemática dos múltiplos
                
                // 1. Market Cap (Valor de Mercado) = Patrimônio Líquido * P/VP
                let marketCap = 0;
                if (patrimLiq > 0 && pvp > 0) {
                    marketCap = patrimLiq * pvp;
                }

                // 2. Lucro Líquido (12m) = Market Cap / PL
                let netIncome = 0;
                if (marketCap > 0 && pl > 0) {
                    netIncome = marketCap / pl;
                }

                // 3. Receita Líquida (12m) = Market Cap / PSR
                let netRevenue = 0;
                if (marketCap > 0 && psr > 0) {
                    netRevenue = marketCap / psr;
                }

                // 4. Ativos Totais = Market Cap / (Price/Assets)
                let totalAssets = 0;
                if (marketCap > 0 && pAtivo > 0) {
                    totalAssets = marketCap / pAtivo;
                }

                // 5. Dívida Líquida (Net Debt)
                let netDebt = 0;
                if (marketCap > 0 && pEbit > 0 && evEbit > 0) {
                    const ebit = marketCap / pEbit;
                    const ev = ebit * evEbit;
                    netDebt = ev - marketCap;
                }

                dataMap.set(ticker, {
                    ticker,
                    price: price,
                    pl: pl,
                    pvp: pvp,
                    psr: psr,
                    dy: parseBrFloat($(tds[5]).text()),
                    pAtivo: pAtivo,
                    pCapGiro: parseBrFloat($(tds[7]).text()),
                    pEbit: pEbit,
                    pAtivCircLiq: parseBrFloat($(tds[9]).text()),
                    evEbit: evEbit,
                    evEbitda: parseBrFloat($(tds[11]).text()),
                    mrgEbit: parseBrFloat($(tds[12]).text()),
                    netMargin: parseBrFloat($(tds[13]).text()),
                    currentRatio: parseBrFloat($(tds[14]).text()),
                    roic: parseBrFloat($(tds[15]).text()),
                    roe: parseBrFloat($(tds[16]).text()),
                    liq2m: parseBrFloat($(tds[17]).text()),
                    patrimLiq: patrimLiq,
                    divBrutaPatrim: parseBrFloat($(tds[19]).text()),
                    cresRec5a: parseBrFloat($(tds[20]).text()),
                    
                    // Dados Enriquecidos Calculados
                    marketCap,
                    netIncome,
                    netRevenue,
                    totalAssets,
                    netDebt
                });
            });

            logger.info(`✅ Fundamentus: ${dataMap.size} ações processadas com dados completos.`);
            return dataMap;

        } catch (error) {
            // Log mais detalhado do erro
            if (error.response) {
                logger.error(`❌ Erro Scraping Ações: ${error.message} | Status: ${error.response.status}`);
            } else {
                logger.error(`❌ Erro Scraping Ações: ${error.message}`);
            }
            return new Map();
        }
    },

    async getFIIsMap() {
        try {
            logger.info("🔎 Iniciando Scraping Detalhado Fundamentus (FIIs)...");

            const response = await axios.get('https://www.fundamentus.com.br/fii_resultado.php', {
                headers: HEADERS,
                responseType: 'arraybuffer',
                timeout: 25000,
                decompress: true
            });

            const decodedData = iconv.decode(response.data, 'iso-8859-1');
            const $ = cheerio.load(decodedData);
            const dataMap = new Map();

            $('table#tabelaResultado tbody tr').each((i, el) => {
                const tds = $(el).find('td');
                const ticker = $(tds[0]).text().trim().toUpperCase();

                if (!ticker || ticker.length < 4) return;

                const price = parseBrFloat($(tds[2]).text());
                const pvp = parseBrFloat($(tds[5]).text());
                const ffoYield = parseBrFloat($(tds[3]).text());
                const marketCap = parseBrFloat($(tds[6]).text()); // FII já tem market cap direto na tabela (Valor de Mercado)

                // Campos Derivados
                const vpCota = (pvp > 0 && price > 0) ? (price / pvp) : 0;
                const ffoCota = (price > 0) ? (price * (ffoYield / 100)) : 0;

                dataMap.set(ticker, {
                    ticker,
                    sector: $(tds[1]).text().trim(),
                    price: price,
                    ffoYield: ffoYield,
                    dy: parseBrFloat($(tds[4]).text()),
                    pvp: pvp,
                    marketCap: marketCap,
                    liquidity: parseBrFloat($(tds[7]).text()),
                    qtdImoveis: parseBrFloat($(tds[8]).text()),
                    priceM2: parseBrFloat($(tds[9]).text()),
                    rentM2: parseBrFloat($(tds[10]).text()),
                    capRate: parseBrFloat($(tds[11]).text()),
                    vacancy: parseBrFloat($(tds[12]).text()),
                    vpCota: parseFloat(vpCota.toFixed(2)),
                    ffoCota: parseFloat(ffoCota.toFixed(2))
                });
            });

            logger.info(`✅ Fundamentus: ${dataMap.size} FIIs processados com dados completos.`);
            return dataMap;

        } catch (error) {
            if (error.response) {
                logger.error(`❌ Erro Scraping FIIs: ${error.message} | Status: ${error.response.status}`);
            } else {
                logger.error(`❌ Erro Scraping FIIs: ${error.message}`);
            }
            return new Map();
        }
    }
};
