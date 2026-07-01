
import AssetTransaction from '../models/AssetTransaction.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import { financialService } from './financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { isBusinessDay } from '../utils/dateUtils.js';

/**
 * (7.11) Motor de Imposto de Renda (IRPF – pessoa física).
 *
 * Reconstrói, a partir de AssetTransaction (fonte da verdade) + DividendEvent, o
 * material necessário para a Declaração Anual:
 *   • Posição em 31/12 (Bens e Direitos) a custo de aquisição (preço médio – RFB).
 *   • Ganhos/perdas realizados por mês em renda variável BR, com compensação de
 *     prejuízo por categoria e apuração de DARF (código 6015).
 *   • Proventos recebidos no ano (Rendimentos Isentos e Não Tributáveis).
 *
 * ESCOPO DO CÁLCULO DE IMPOSTO (decisão de produto): apenas renda variável
 * BRASILEIRA — Ações (isenção de R$20k/mês, 15%), FIIs (20%) e ETFs de índice
 * nacionais (15%). Exterior e cripto entram na POSIÇÃO e nos PROVENTOS, mas o
 * ganho de capital deles é apenas LISTADO como "conferência manual" (regras de
 * carnê-leão/GCAP/isenção de R$35k diferem e são fáceis de errar).
 *
 * MÉTODO: preço médio ponderado (padrão RFB para renda variável), idêntico ao
 * `realizedProfit` do financialService — não FIFO.
 *
 * As funções de cálculo (`simulatePortfolio`, `settleMonthlyTaxes`,
 * `buildDarfSchedule`) são PURAS e exportadas para teste isolado (sem DB).
 */

// Alíquotas e limites (renda variável PF – swing trade).
export const TAX = {
    RATE_ACOES: 0.15,       // Ações – mercado à vista (swing trade)
    RATE_FII: 0.20,         // FIIs
    RATE_ETF: 0.15,         // ETFs de renda variável nacionais
    EXEMPTION_ACOES: 20000, // Isenção de ações: vendas ≤ R$20.000/mês
    DARF_MIN: 10,           // DARF < R$10 acumula para o mês seguinte
    DARF_CODE: '6015',      // Ganhos líquidos em renda variável – PF
};

export const BR_CATEGORIES = ['ACOES', 'FII', 'ETF'];
const RATE_BY_CATEGORY = { ACOES: TAX.RATE_ACOES, FII: TAX.RATE_FII, ETF: TAX.RATE_ETF };

// Categoria fiscal a partir do tipo/moeda do ativo.
//  ACOES/FII/ETF → renda variável BR (entra no cálculo de DARF).
//  EXTERIOR/CRIPTO → apenas informativo (conferência manual).
//  null → Renda Fixa / Caixa (tributação na fonte pela corretora, fora daqui).
export const taxCategory = (type, currency) => {
    switch (type) {
        case 'STOCK': return 'ACOES';
        case 'FII': return 'FII';
        case 'ETF': return currency === 'USD' ? 'EXTERIOR' : 'ETF';
        case 'STOCK_US': return 'EXTERIOR';
        case 'CRYPTO': return 'CRIPTO';
        default: return null;
    }
};

// Rótulo + grupo/código sugeridos para "Bens e Direitos" (layout DIRPF recente).
// Os códigos são SUGESTÕES — o contribuinte deve confirmar no programa da Receita.
const BENS_GROUP = {
    STOCK:        { grupo: '03', codigo: '01', label: 'Ações (mercado à vista)', exterior: false },
    FII:          { grupo: '07', codigo: '03', label: 'Fundos de Investimento Imobiliário (FII)', exterior: false },
    ETF:          { grupo: '07', codigo: '09', label: 'ETF – Renda Variável', exterior: false },
    STOCK_US:     { grupo: '03', codigo: '09', label: 'Bens no Exterior (Ações/ETF/REIT)', exterior: true },
    CRYPTO:       { grupo: '08', codigo: '01', label: 'Criptoativos', exterior: true },
    FIXED_INCOME: { grupo: '04', codigo: '02', label: 'Renda Fixa (Tesouro/CDB/LCI/etc.)', exterior: false },
    CASH:         { grupo: '06', codigo: '01', label: 'Conta / Reserva', exterior: false },
};

const monthKey = (date) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Último dia útil do mês (0-indexado). Usado para a data de vencimento do DARF:
// último dia útil do mês SUBSEQUENTE ao da apuração.
const lastBusinessDayOfMonth = (year, monthIndex) => {
    const d = new Date(Date.UTC(year, monthIndex + 1, 0)); // último dia do mês
    while (!isBusinessDay(d)) d.setUTCDate(d.getUTCDate() - 1);
    return d;
};

const nextMonthDueDate = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const idx = m - 1;           // mês de apuração (0-idx)
    const dueYear = idx === 11 ? y + 1 : y;
    const dueMonthIdx = idx === 11 ? 0 : idx + 1; // mês seguinte
    return lastBusinessDayOfMonth(dueYear, dueMonthIdx);
};

/**
 * (PURA) Simulação cronológica das transações: reconstrói a posição por preço
 * médio e agrega vendas/ganhos por (mês × categoria). Processa TODO o histórico
 * (anos anteriores inclusive) para que o prejuízo acumulado que entra no ano-alvo
 * esteja correto; só transações até 31/12 do ano-alvo devem ser passadas.
 *
 * @param txs transações ordenadas por data asc ({ ticker, type, quantity, price, date }).
 * @param metaOf (ticker) => { type, currency, name }.
 * @param year ano-alvo (para isolar os ganhos informativos de exterior/cripto).
 * @returns { portfolio, buckets, manualGains }
 *   portfolio[ticker] = { qty, cost }
 *   buckets = Map<'YYYY-MM', { [category]: { sales, gain } }>
 *   manualGains = Map<'EXTERIOR'|'CRIPTO', { gain, sales }> (só do ano-alvo)
 */
export const simulatePortfolio = (txs, metaOf, year) => {
    const portfolio = {};
    const buckets = new Map();
    const manualGains = new Map();

    const addBucket = (ym, category, sales, gain) => {
        if (!buckets.has(ym)) buckets.set(ym, {});
        const byCat = buckets.get(ym);
        if (!byCat[category]) byCat[category] = { sales: 0, gain: 0 };
        byCat[category].sales = safeAdd(byCat[category].sales, sales);
        byCat[category].gain = safeAdd(byCat[category].gain, gain);
    };

    for (const tx of txs) {
        const ticker = tx.ticker;
        const meta = metaOf(ticker);
        const category = taxCategory(meta.type, meta.currency);
        const qty = safeFloat(tx.quantity);
        const price = safeFloat(tx.price);
        const total = safeCurrency(qty * price);

        if (!portfolio[ticker]) portfolio[ticker] = { qty: 0, cost: 0 };
        const pos = portfolio[ticker];

        if (tx.type === 'BUY') {
            pos.qty = safeAdd(pos.qty, qty);
            pos.cost = safeAdd(pos.cost, total);
        } else if (tx.type === 'SELL') {
            const avg = pos.qty > 0 ? safeDiv(pos.cost, pos.qty) : 0;
            const costOfSold = safeCurrency(qty * avg);
            const gain = safeSub(total, costOfSold);
            pos.qty = safeSub(pos.qty, qty);
            pos.cost = safeSub(pos.cost, costOfSold);
            if (pos.qty < QUANTITY_EPSILON) { pos.qty = 0; pos.cost = 0; }

            const ym = monthKey(tx.date);
            const txYear = new Date(tx.date).getUTCFullYear();
            if (category && BR_CATEGORIES.includes(category)) {
                addBucket(ym, category, total, gain);
            } else if (category === 'EXTERIOR' || category === 'CRIPTO') {
                if (txYear === year) {
                    if (!manualGains.has(category)) manualGains.set(category, { gain: 0, sales: 0 });
                    const mg = manualGains.get(category);
                    mg.gain = safeAdd(mg.gain, gain);
                    mg.sales = safeAdd(mg.sales, total);
                }
            }
        }
    }

    return { portfolio, buckets, manualGains };
};

/**
 * (PURA) Apuração mensal cronológica com compensação de prejuízo por categoria.
 * Varre TODOS os meses (para levar o prejuízo correto ao ano-alvo) mas só devolve
 * as linhas do ano-alvo.
 *
 * Regras:
 *  • Ações com vendas ≤ R$20k no mês → ganho ISENTO; a perda de operação isenta
 *    NÃO é compensável (não entra no estoque de prejuízo).
 *  • Demais casos: prejuízo do mês acumula; lucro tributável compensa o prejuízo
 *    acumulado da MESMA categoria antes de aplicar a alíquota.
 *
 * @returns { monthly, monthTaxByYm, lossCarryEndOfYear }
 */
export const settleMonthlyTaxes = (buckets, year) => {
    const accLoss = { ACOES: 0, FII: 0, ETF: 0 };
    const monthly = [];
    const monthTaxByYm = new Map();

    const sortedYms = [...buckets.keys()].sort();
    for (const ym of sortedYms) {
        const ymYear = Number(ym.slice(0, 4));
        const byCat = buckets.get(ym);
        let monthTax = 0;

        for (const category of BR_CATEGORIES) {
            const b = byCat[category];
            if (!b || (b.sales === 0 && b.gain === 0)) continue;

            const rate = RATE_BY_CATEGORY[category];
            let exempt = false;
            let compensatedLoss = 0;
            let taxableBase = 0;
            let tax = 0;

            if (category === 'ACOES' && b.sales <= TAX.EXEMPTION_ACOES) {
                exempt = true; // isento; perda isenta não compensável (accLoss inalterado)
            } else if (b.gain <= 0) {
                accLoss[category] = safeAdd(accLoss[category], -b.gain);
            } else {
                compensatedLoss = Math.min(b.gain, accLoss[category]);
                taxableBase = safeSub(b.gain, compensatedLoss);
                accLoss[category] = safeSub(accLoss[category], compensatedLoss);
                tax = safeCurrency(safeMult(taxableBase, rate));
                monthTax = safeAdd(monthTax, tax);
            }

            if (ymYear === year) {
                monthly.push({
                    month: ym.slice(5),
                    category,
                    sales: safeCurrency(b.sales),
                    gain: safeCurrency(b.gain),
                    exempt,
                    compensatedLoss: safeCurrency(compensatedLoss),
                    taxableBase: safeCurrency(taxableBase),
                    taxRate: rate,
                    tax,
                    lossCarryAfter: safeCurrency(accLoss[category]),
                });
            }
        }

        if (ymYear === year) monthTaxByYm.set(ym, safeCurrency(monthTax));
    }

    return {
        monthly,
        monthTaxByYm,
        lossCarryEndOfYear: {
            ACOES: safeCurrency(accLoss.ACOES),
            FII: safeCurrency(accLoss.FII),
            ETF: safeCurrency(accLoss.ETF),
        },
    };
};

/**
 * (PURA) Agenda de DARFs do ano com a regra do mínimo de R$10: imposto mensal
 * abaixo de R$10 acumula para o mês seguinte até atingir o mínimo.
 * @returns { darf, carry } (carry = sobra < R$10 no fim do ano)
 */
export const buildDarfSchedule = (monthTaxByYm, monthly, year) => {
    const darf = [];
    let carry = 0;
    for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, '0');
        const ym = `${year}-${mm}`;
        const monthTax = monthTaxByYm.get(ym) || 0;
        if (monthTax <= 0) continue;
        carry = safeAdd(carry, monthTax);
        if (carry >= TAX.DARF_MIN) {
            const breakdown = monthly
                .filter(l => l.month === mm && l.tax > 0)
                .map(l => ({ category: l.category, tax: l.tax }));
            darf.push({
                month: mm,
                competencia: ym,
                code: TAX.DARF_CODE,
                dueDate: nextMonthDueDate(ym),
                amount: safeCurrency(carry),
                breakdown,
            });
            carry = 0;
        }
    }
    return { darf, carry: safeCurrency(carry) };
};

export const taxReportService = {
    /**
     * Calcula o relatório de IR do usuário para um ano-calendário.
     * @param {string} userId
     * @param {number} year ano-calendário (ex.: 2025)
     * @returns objeto estruturado consumido pelo controller (JSON e PDF).
     */
    async computeReport(userId, year) {
        const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

        // Só interessam transações até 31/12 do ano-alvo. Ordem cronológica
        // estável (data → createdAt) espelha o recalculatePosition.
        const txs = await AssetTransaction.find({
            user: userId,
            date: { $lte: yearEnd },
        }).sort({ date: 1, createdAt: 1 }).lean();

        const userAssets = await UserAsset.find({ user: userId }).lean();
        const metaByTicker = new Map();
        userAssets.forEach(a => metaByTicker.set(a.ticker, a));
        // Metadados de tickers zerados/vendidos também vêm de UserAsset; para
        // tickers totalmente ausentes (raro), assume STOCK/BRL.
        const metaOf = (ticker) => metaByTicker.get(ticker) || { type: 'STOCK', currency: 'BRL', name: ticker };

        // 1) Simulação → posição (preço médio) + ganhos por mês/categoria.
        const { portfolio, buckets, manualGains } = simulatePortfolio(txs, metaOf, year);

        // 2) Apuração mensal com compensação de prejuízo.
        const { monthly, monthTaxByYm, lossCarryEndOfYear } = settleMonthlyTaxes(buckets, year);

        // 3) DARFs do ano (regra do mínimo de R$10).
        const { darf, carry: darfCarryToNextYear } = buildDarfSchedule(monthTaxByYm, monthly, year);

        // 4) Posição em 31/12 (Bens e Direitos) a custo de aquisição.
        const positions = [];
        for (const ticker of Object.keys(portfolio)) {
            const pos = portfolio[ticker];
            if (pos.qty <= QUANTITY_EPSILON) continue;
            const meta = metaOf(ticker);
            const grp = BENS_GROUP[meta.type] || { grupo: '99', codigo: '99', label: meta.type, exterior: false };
            positions.push({
                ticker,
                name: meta.name || ticker,
                type: meta.type,
                currency: meta.currency || 'BRL',
                quantity: safeFloat(pos.qty),
                avgPrice: safeCurrency(safeDiv(pos.cost, pos.qty)),
                totalCost: safeCurrency(pos.cost),
                grupo: grp.grupo,
                codigo: grp.codigo,
                groupLabel: grp.label,
                manualReview: !!grp.exterior, // exterior/cripto: confirmar valor/câmbio
            });
        }
        positions.sort((a, b) => (a.type.localeCompare(b.type) || a.ticker.localeCompare(b.ticker)));

        // Agrupamento por rótulo para a seção Bens e Direitos.
        const positionsByGroup = [];
        const groupIndex = new Map();
        for (const p of positions) {
            if (!groupIndex.has(p.groupLabel)) {
                groupIndex.set(p.groupLabel, positionsByGroup.length);
                positionsByGroup.push({ groupLabel: p.groupLabel, grupo: p.grupo, items: [], totalCost: 0, exterior: p.manualReview });
            }
            const g = positionsByGroup[groupIndex.get(p.groupLabel)];
            g.items.push(p);
            g.totalCost = safeCurrency(safeAdd(g.totalCost, p.totalCost));
        }

        // 5) Proventos recebidos no ano (Rendimentos Isentos).
        const dividends = await this._computeDividends(userId, year, txs, metaByTicker);

        // 6) Sumários.
        const totalDarf = darf.reduce((s, d) => safeAdd(s, d.amount), 0);
        const totalTaxByCategory = { ACOES: 0, FII: 0, ETF: 0 };
        monthly.forEach(l => { totalTaxByCategory[l.category] = safeAdd(totalTaxByCategory[l.category], l.tax); });
        const totalPositionCost = positions
            .filter(p => !p.manualReview)
            .reduce((s, p) => safeAdd(s, p.totalCost), 0);

        const manualReviewItems = [...manualGains.entries()].map(([category, v]) => ({
            category,
            realizedGain: safeCurrency(v.gain),
            sales: safeCurrency(v.sales),
        }));

        return {
            year,
            generatedAt: new Date(),
            positions,
            positionsByGroup,
            monthly,
            darf,
            darfCarryToNextYear,
            dividends,
            lossCarryEndOfYear,
            manualReviewItems,
            summary: {
                totalDarf: safeCurrency(totalDarf),
                totalTaxByCategory: {
                    ACOES: safeCurrency(totalTaxByCategory.ACOES),
                    FII: safeCurrency(totalTaxByCategory.FII),
                    ETF: safeCurrency(totalTaxByCategory.ETF),
                },
                totalDividends: safeCurrency(dividends.total),
                totalPositionCostBRL: safeCurrency(totalPositionCost),
                positionsCount: positions.length,
            },
            disclaimers: [
                'Relatório gerado automaticamente para APOIO ao preenchimento da declaração. Confira os valores no programa da Receita Federal e/ou com seu contador.',
                'Ganho de capital calculado pelo PREÇO MÉDIO (padrão RFB) apenas para renda variável BRASILEIRA: Ações (isenção de vendas ≤ R$20.000/mês, 15%), FIIs (20%) e ETFs de renda variável nacionais (15%).',
                'Ativos no EXTERIOR e CRIPTOATIVOS aparecem em Bens e Direitos e nos proventos, mas o ganho de capital deles NÃO é calculado aqui (regras de carnê-leão/GCAP e isenção de R$35.000/mês diferem) — veja "Conferência manual".',
                'A fonte de proventos não distingue Dividendos de JCP. Todos foram classificados como Rendimentos Isentos. JCP é tributado a 15% na fonte (Rendimentos Sujeitos à Tributação Exclusiva) — ajuste manualmente se houver JCP.',
                'Renda Fixa e Caixa entram em Bens e Direitos pelo valor aplicado; o imposto desses é retido na fonte pela instituição (informe pelo informe de rendimentos).',
                'O relatório é reconstruído a partir do histórico de transações da carteira. Se você REMOVER um ativo já encerrado (100% vendido), as vendas dele deixam de constar aqui — gere/exporte o IR do ano ANTES de remover posições fechadas.',
                `Os códigos de "Bens e Direitos" (grupo/código) são SUGESTÕES do layout mais recente e podem variar — confirme no programa do ano-base ${year}.`,
            ],
        };
    },

    /**
     * Proventos recebidos no ano-calendário, por ticker. Reconstrói a quantidade
     * detida na data-ex (a partir das transações) e multiplica pelo valor por
     * cota, deduplicando por identidade canônica (ticker + ex-date + tipo).
     */
    async _computeDividends(userId, year, txs, metaByTicker) {
        // Tickers pagadores (renda variável). Cripto/RF/Caixa não pagam proventos.
        const payerTickers = [...new Set(
            txs.map(t => t.ticker).filter(tk => {
                const m = metaByTicker.get(tk);
                return m && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(m.type);
            })
        )];
        if (payerTickers.length === 0) return { total: 0, byTicker: [] };

        // Timeline de quantidade por ticker (transações ordenadas).
        const txByTicker = new Map();
        for (const t of txs) {
            if (!payerTickers.includes(t.ticker)) continue;
            if (!txByTicker.has(t.ticker)) txByTicker.set(t.ticker, []);
            txByTicker.get(t.ticker).push(t);
        }
        const qtyHeldOn = (ticker, date) => {
            const list = txByTicker.get(ticker) || [];
            let q = 0;
            for (const t of list) {
                if (new Date(t.date) > date) break;
                q += t.type === 'BUY' ? safeFloat(t.quantity) : -safeFloat(t.quantity);
            }
            return q;
        };

        const events = await DividendEvent.find({ ticker: { $in: payerTickers } }).sort({ date: 1 }).lean();
        const receivedByTicker = new Map();
        const seen = new Set();

        for (const ev of events) {
            const identity = financialService.dividendIdentity(ev.ticker, ev.date, ev.type);
            if (seen.has(identity)) continue;
            seen.add(identity);

            const exDate = new Date(ev.date);
            // Data de recebimento: pagamento informado ou ex-date + 15 dias (mesma
            // heurística do calculateUserDividends).
            const payDate = ev.paymentDate ? new Date(ev.paymentDate) : new Date(new Date(ev.date).setDate(exDate.getUTCDate() + 15));
            if (payDate.getUTCFullYear() !== year) continue;

            const qty = qtyHeldOn(ev.ticker, exDate);
            if (qty <= QUANTITY_EPSILON) continue;

            const amount = safeCurrency(safeMult(qty, safeFloat(ev.amount)));
            if (amount <= 0) continue;
            receivedByTicker.set(ev.ticker, safeAdd(receivedByTicker.get(ev.ticker) || 0, amount));
        }

        const byTicker = [...receivedByTicker.entries()]
            .map(([ticker, amount]) => {
                const m = metaByTicker.get(ticker);
                return { ticker, name: m?.name || ticker, type: m?.type || 'STOCK', amount: safeCurrency(amount) };
            })
            .sort((a, b) => b.amount - a.amount);

        const total = byTicker.reduce((s, d) => safeAdd(s, d.amount), 0);
        return { total: safeCurrency(total), byTicker };
    },
};
