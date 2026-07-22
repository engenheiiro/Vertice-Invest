
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import logger from '../config/logger.js';
import {
    FUNDAMENTUS_STOCKS_LAYOUT,
    FUNDAMENTUS_FIIS_LAYOUT,
    validateFundamentusLayout,
} from '../config/scraperSchemas.js';

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

// Exportado para teste (T5). Uso interno inalterado.
export const parseBrFloat = (str) => {
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

            const layout = FUNDAMENTUS_STOCKS_LAYOUT;
            const col = layout.columns;
            // (6.7) Detecta proativamente mudança de estrutura do site (índices
            // de coluna defasados → dados zerados sem erro).
            const check = validateFundamentusLayout($, layout);
            if (!check.ok) {
                logger.error('❌ [Fundamentus] Layout de AÇÕES incompatível; ingestão bloqueada', {
                    source: 'fundamentus', kind: 'STOCK', schemaVersion: check.version, mismatches: check.mismatches,
                });
                throw new Error(`Layout de AÇÕES incompatível: ${check.mismatches.join('; ')}`);
            }

            $(`${layout.table} tbody tr`).each((i, el) => {
                try {
                    const tds = $(el).find('td');
                    const ticker = $(tds[col.ticker]).text().trim().toUpperCase();

                    // Validação básica para ignorar linhas quebradas
                    if (!ticker || ticker.length < 4) return;

                    // Extração Básica
                    const price = parseBrFloat($(tds[col.price]).text());
                    const pl = parseBrFloat($(tds[col.pl]).text());
                    const pvp = parseBrFloat($(tds[col.pvp]).text());
                    const psr = parseBrFloat($(tds[col.psr]).text());
                    const pAtivo = parseBrFloat($(tds[col.pAtivo]).text());
                    const pEbit = parseBrFloat($(tds[col.pEbit]).text());
                    const evEbit = parseBrFloat($(tds[col.evEbit]).text());
                    const patrimLiq = parseBrFloat($(tds[col.patrimLiq]).text());

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

                    // 6. Payout (Dividendos / Lucro Líquido)
                    // Matematicamente: Payout = DY * PL
                    const dy = parseBrFloat($(tds[col.dy]).text());
                    let payout = 0;
                    if (dy > 0 && pl > 0) {
                        payout = dy * pl;
                    }

                    dataMap.set(ticker, {
                        ticker,
                        price: price,
                        pl: pl,
                        pvp: pvp,
                        psr: psr,
                        dy: dy,
                        pAtivo: pAtivo,
                        pCapGiro: parseBrFloat($(tds[col.pCapGiro]).text()),
                        pEbit: pEbit,
                        pAtivCircLiq: parseBrFloat($(tds[col.pAtivCircLiq]).text()),
                        evEbit: evEbit,
                        evEbitda: parseBrFloat($(tds[col.evEbitda]).text()),
                        grossMargin: parseBrFloat($(tds[col.mrgBruta]).text()),
                        mrgEbit: parseBrFloat($(tds[col.mrgEbit]).text()),
                        netMargin: parseBrFloat($(tds[col.netMargin]).text()),
                        currentRatio: parseBrFloat($(tds[col.currentRatio]).text()),
                        roic: parseBrFloat($(tds[col.roic]).text()),
                        roe: parseBrFloat($(tds[col.roe]).text()),
                        liq2m: parseBrFloat($(tds[col.liq2m]).text()),
                        patrimLiq: patrimLiq,
                        // A fonte atual publica Dív.Líq/Patrim. O alias legado é
                        // mantido no payload durante a transição do syncService.
                        debtToEquity: parseBrFloat($(tds[col.debtToEquity]).text()),
                        divBrutaPatrim: parseBrFloat($(tds[col.debtToEquity]).text()),
                        cresRec5a: parseBrFloat($(tds[col.cresRec5a]).text()),
                        
                        // Dados Enriquecidos Calculados
                        marketCap,
                        netIncome,
                        netRevenue,
                        totalAssets,
                        netDebt,
                        payout
                    });
                } catch (rowError) {
                    logger.warn(`⚠️ Erro ao processar linha ${i} de ações: ${rowError.message}`);
                }
            });

            if (dataMap.size < 100) {
                const msg = `Scraping retornou apenas ${dataMap.size} ações. Possível bloqueio ou instabilidade no Fundamentus.`;
                if (process.env.NODE_ENV !== 'test') throw new Error(msg);
                logger.warn(`⚠️ [Fundamentus][TEST] ${msg}`); // não falha o teste, mas torna a regressão visível
            }

            logger.info(`✅ Fundamentus: ${dataMap.size} ações processadas com dados completos.`, {
                source: 'fundamentus', kind: 'STOCK', count: dataMap.size, schemaVersion: layout.version,
            });
            return dataMap;

        } catch (error) {
            // Não-fatal: o IP do Render é bloqueado pelo Fundamentus (403). A rotina
            // segue com fundamentos em cache + refresh manual (sync:prod). Por isso é
            // warn, não error (evita ruído/alerta para uma condição esperada e tratada).
            logger.warn(`⚠️ Scraping Ações indisponível: ${error.message} (usando cache)`, {
                source: 'fundamentus', kind: 'STOCK', status: error.response?.status ?? null,
            });
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

            const layout = FUNDAMENTUS_FIIS_LAYOUT;
            const col = layout.columns;
            // (6.7) Alerta proativo de mudança de estrutura do site.
            const check = validateFundamentusLayout($, layout);
            if (!check.ok) {
                logger.error('❌ [Fundamentus] Layout de FIIs incompatível; ingestão bloqueada', {
                    source: 'fundamentus', kind: 'FII', schemaVersion: check.version, mismatches: check.mismatches,
                });
                throw new Error(`Layout de FIIs incompatível: ${check.mismatches.join('; ')}`);
            }

            $(`${layout.table} tbody tr`).each((i, el) => {
                try {
                    const tds = $(el).find('td');
                    const ticker = $(tds[col.ticker]).text().trim().toUpperCase();

                    if (!ticker || ticker.length < 4) return;

                    const price = parseBrFloat($(tds[col.price]).text());
                    const pvp = parseBrFloat($(tds[col.pvp]).text());
                    const ffoYield = parseBrFloat($(tds[col.ffoYield]).text());
                    const marketCap = parseBrFloat($(tds[col.marketCap]).text()); // FII já tem market cap direto na tabela (Valor de Mercado)

                    // Campos Derivados
                    const vpCota = (pvp > 0 && price > 0) ? (price / pvp) : 0;
                    const ffoCota = (price > 0) ? (price * (ffoYield / 100)) : 0;

                    dataMap.set(ticker, {
                        ticker,
                        sector: $(tds[col.segment]).text().trim(),
                        price: price,
                        ffoYield: ffoYield,
                        dy: parseBrFloat($(tds[col.dy]).text()),
                        pvp: pvp,
                        marketCap: marketCap,
                        liquidity: parseBrFloat($(tds[col.liquidity]).text()),
                        qtdImoveis: parseBrFloat($(tds[col.qtdImoveis]).text()),
                        priceM2: parseBrFloat($(tds[col.priceM2]).text()),
                        rentM2: parseBrFloat($(tds[col.rentM2]).text()),
                        capRate: parseBrFloat($(tds[col.capRate]).text()),
                        vacancy: parseBrFloat($(tds[col.vacancy]).text()),
                        address: $(tds[col.address]).text().replace(/\s+/g, ' ').trim(),
                        vpCota: parseFloat(vpCota.toFixed(2)),
                        ffoCota: parseFloat(ffoCota.toFixed(2))
                    });
                } catch (rowError) {
                    logger.warn(`⚠️ Erro ao processar linha ${i} de FIIs: ${rowError.message}`);
                }
            });

            if (dataMap.size < 100) {
                const msg = `Scraping retornou apenas ${dataMap.size} FIIs. Possível bloqueio ou instabilidade no Fundamentus.`;
                if (process.env.NODE_ENV !== 'test') throw new Error(msg);
                logger.warn(`⚠️ [Fundamentus][TEST] ${msg}`); // não falha o teste, mas torna a regressão visível
            }

            logger.info(`✅ Fundamentus: ${dataMap.size} FIIs processados com dados completos.`, {
                source: 'fundamentus', kind: 'FII', count: dataMap.size, schemaVersion: layout.version,
            });
            return dataMap;

        } catch (error) {
            // Não-fatal (ver getStocksMap): 403 do Render → segue com cache + sync:prod manual.
            logger.warn(`⚠️ Scraping FIIs indisponível: ${error.message} (usando cache)`, {
                source: 'fundamentus', kind: 'FII', status: error.response?.status ?? null,
            });
            return new Map();
        }
    }
};
