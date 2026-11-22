// Card de cada posição da carteira (preço, variação do dia, renda fixa). Extraído de walletController.js.
import {
    safeFloat,
    safeUnitPrice,
    safeCurrency,
    safeAdd,
    safeSub,
    safeMult,
    safeDiv,
    calculatePercent,
    safeValue,
    safePrice,
    safeQuantity,
} from '../utils/mathUtils.js';
import { brazilDateKey } from '../utils/dateUtils.js';
import { assetDailyFactor, valueFixedIncomeAsset, PRICING_SOURCE, brazilToday, isMatured } from '../utils/fixedIncome.js';
import { EMPTY_TREASURY_PRICING } from '../services/treasuryPriceService.js';
import { isDollarized } from '../utils/assetCurrency.js';
import { positionCostBRL, positionRealizedProfitBRL } from '../utils/fxRate.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { DAY_CHANGE_REASON } from '../utils/dayChangeReason.js';
import { resolveAllocationClass } from '../utils/assetAllocation.js';

/**
 * O dia BR de um lote. Data "pura" (meia-noite UTC, como vem de um input
 * YYYY-MM-DD) é lida como está; instante com hora é convertido para o fuso de
 * São Paulo.
 */
const lotDayStr = (d) => {
    const o = new Date(d);
    if (o.getUTCHours() === 0 && o.getUTCMinutes() === 0 && o.getUTCSeconds() === 0) {
        return o.toISOString().split('T')[0];
    }
    return brazilDateKey(o);
};

/**
 * TODOS os lotes da posição são do dia `dayKey`? É a guarda que impede uma compra
 * de hoje de exibir a variação do pregão inteiro (a posição não existia na
 * abertura) — e agora a que garante que ela ancore no CUSTO, não no candle.
 *
 * O dia vem do fuso BR (`todayKey`), nunca de `toDateKey(new Date())`: aquele é
 * UTC, e das 21h à meia-noite de Brasília já aponta para o dia seguinte. A guarda
 * ficava morta justamente nas três horas em que o usuário confere a carteira
 * depois do pregão.
 */
const isBoughtOnDay = (asset, dayKey) =>
    Array.isArray(asset.taxLots) && asset.taxLots.length > 0
    && asset.taxLots.every((lot) => lotDayStr(lot.date) === dayKey);

/**
 * Variação do dia de uma posição de renda fixa ANTES das guardas de vencimento e
 * de âncora: a régua (PU oficial ou curva) e o motivo que a acompanha.
 */
const fixedIncomeRawDayChange = (asset, pricing, { macroRates, isTodayBusinessDay, todayKey }) => {
    // Mesmo dia BR que o resto da função usa (`todayKey`), em vez de recalcular
    // o fuso aqui — duas leituras do "hoje" na mesma função é como elas passam
    // a discordar na virada.
    const todayStr = todayKey;

    if (pricing.source === PRICING_SOURCE.MTM) {
        // Marcado: a variação do dia é a do PU — e só existe quando o PU
        // publicado é o de HOJE. A série oficial sai de manhã e é ingerida no
        // fim do dia; repetir a variação de ontem enquanto isso mostraria um
        // movimento que não aconteceu hoje.
        const puIsFromToday = pricing.priceDate === todayStr;
        const hasPreviousMark = pricing.previousMarket > 0;
        const dayChangePct = (puIsFromToday && hasPreviousMark)
            ? ((pricing.value / pricing.previousMarket) - 1) * 100
            : 0;

        if (puIsFromToday && hasPreviousMark) {
            return { dayChangePct, dayChangeReason: DAY_CHANGE_REASON.FIXED_INCOME_MTM };
        }
        if (!hasPreviousMark && isBoughtOnDay(asset, todayKey)) {
            // Não há marcação anterior porque a POSIÇÃO não existia no PU
            // anterior — é compra do dia, não série atrasada. É a mesma guarda
            // que o ramo da curva faz explicitamente; aqui ela cai por
            // consequência, e sem esta distinção a linha diria "PU de hoje não
            // publicado" com o PU de hoje publicado na tela ao lado.
            return { dayChangePct, dayChangeReason: DAY_CHANGE_REASON.BOUGHT_TODAY };
        }
        return { dayChangePct, dayChangeReason: DAY_CHANGE_REASON.FIXED_INCOME_MTM_PENDING };
    }

    const effectiveDailyFactor = assetDailyFactor(asset, macroRates);
    // Ativo comprado HOJE: zera a variação do dia (evita variação irreal).
    // Só no ramo da CURVA — no marcado a mercado o código não zera por
    // compra do dia, e a etiqueta acompanha essa assimetria.
    if (isBoughtOnDay(asset, todayKey)) {
        return { dayChangePct: 0, dayChangeReason: DAY_CHANGE_REASON.BOUGHT_TODAY };
    }
    return {
        dayChangePct: isTodayBusinessDay ? (effectiveDailyFactor - 1) * 100 : 0,
        dayChangeReason: DAY_CHANGE_REASON.FIXED_INCOME_CURVE,
    };
};

// Preço unitário exibido da renda fixa/caixa: saldo ÷ quantidade.
const fixedIncomeUnitPrice = (asset, totalCurrentValue) => {
    const totalQuantity = asset.quantity;
    if (totalQuantity > 0) return totalCurrentValue / totalQuantity;
    return asset.type === 'CASH' ? 1 : safeDiv(asset.totalCost, asset.quantity);
};

const resolveFixedIncomeDay = (asset, ctx) => {
    const { macroRates, treasuryPricing, anchorDayKey } = ctx;
    // Fonte única (utils/fixedIncome): marca a mercado quando o título público
    // foi identificado, senão compõe a taxa. Idêntica ao calculateLiveKPIS e ao
    // snapshot, garantindo que KPI, ponto live do gráfico e histórico batam.
    const calcDate = brazilToday();
    const history = treasuryPricing.historyFor(asset);
    // Diagnóstico da renda fixa (mercado × curva) para a UI.
    const pricing = valueFixedIncomeAsset(asset, { ...macroRates, calcDate, history });
    const totalCurrentValue = pricing.value;

    // Renda fixa no dia-âncora pela MESMA porta (`valueFixedIncomeAsset`), com a
    // data de cálculo daquele dia: curva ou PU oficial, exatamente como o
    // snapshot marcou. Substitui a heurística de "um fator diário se hoje é dia
    // útil", que errava sempre que o âncora não era o dia útil imediatamente
    // anterior (segunda-feira, feriado, buraco no histórico).
    let anchorValueNative = null;
    if (anchorDayKey) {
        const anchorValue = valueFixedIncomeAsset(asset, {
            ...macroRates,
            calcDate: new Date(`${anchorDayKey}T00:00:00.000Z`),
            history,
        }).value;
        if (anchorValue > 0) anchorValueNative = anchorValue;
    }
    const currentPrice = fixedIncomeUnitPrice(asset, totalCurrentValue);

    let { dayChangePct, dayChangeReason } = fixedIncomeRawDayChange(asset, pricing, ctx);

    // C2: título vencido não rende mais — zera a variação do dia (o valor já
    // vem congelado no vencimento). isMatured usa a mesma calcDate.
    const matured = isMatured(asset, calcDate);
    if (matured) {
        dayChangePct = 0;
        dayChangeReason = DAY_CHANGE_REASON.MATURED;
    }

    // Com âncora, a variação exibida é a MEDIDA contra o dia-âncora — não a
    // estimada por um fator. Cobre curva e marcação a mercado com uma régua só.
    if (anchorValueNative !== null && !matured) {
        dayChangePct = ((totalCurrentValue / anchorValueNative) - 1) * 100;
    }

    return {
        currentPrice,
        dayChangePct,
        dayChangeReason,
        anchorValueNative,
        // Renda fixa/caixa: valor TOTAL da posição (fonte da verdade). Guardado à parte
        // porque re-derivar via quantidade × preço unitário perde precisão — safeFloat
        // arredonda o preço a 4 casas e, numa reserva com muitas "unidades" (ex.: 15.000),
        // isso descarta centavos (R$15.000 a 100% CDI → 1,000525 vira 1,0005 → perde R$0,38).
        accruedTotalValue: totalCurrentValue,
        matured, // C2: título de RF vencido (accrual congelado, sugere resgate)
        pricing,
    };
};

// Fechamento GRAVADO do dia-âncora para a posição (0 quando não há).
const anchorCloseFor = (asset, anchorCloses) =>
    safeUnitPrice(Number(anchorCloses?.get(historyStorageKey(asset.ticker, asset.type)) || 0));

/**
 * Variação do dia de um ativo cotado, antes do ajuste de compra do dia.
 * `anchorValueNative` = valor da posição na MOEDA NATIVA no dia-âncora; `null` =
 * sem âncora utilizável (o cálculo cai na reconstrução por percentual).
 */
const quotedRawDayChange = (asset, cached, currentPrice, anchorClose, { isTodayBusinessDay, todayKey }) => {
    // Fechamento GRAVADO do dia-âncora: o mesmo número que virou patrimônio
    // no snapshot. Vale para todas as classes — ação, FII, ETF e cripto — e
    // é o que impede que um ajuste de referência do provedor (dia-ex) ou um
    // corte de dia diferente (cripto 24h) abra vão entre o card e o gráfico.
    if (anchorClose > 0) {
        return {
            dayChangePct: ((currentPrice / anchorClose) - 1) * 100,
            anchorValueNative: safeValue(asset.quantity, anchorClose),
            dayChangeReason: DAY_CHANGE_REASON.ANCHOR_CLOSE,
        };
    }
    if (asset.type === 'CRYPTO') {
        // Cripto não tem pregão para datar: negocia 24h. Mas o `change` do
        // provedor é uma janela DESLIZANTE de 24 horas, e isso não é "hoje":
        // à 00h48 ele ainda carregava o dia inteiro de ontem — movimento que
        // já está dentro do patrimônio de ontem e passava a ser contado duas
        // vezes. Numa carteira real: R$ 5,09 no card contra R$ 1,34 de ganho
        // efetivo, e o card divergia do gráfico exatamente nessa diferença.
        //
        // O fechamento anterior do provedor é a âncora fixa que falta — o
        // mesmo "desde ontem" que as outras classes usam (BTC em 01/09:
        // +1,18% na janela de 24h contra +0,13% desde o fechamento).
        // Sem previousClose, mantém a janela do provedor: defasada, mas é
        // a única leitura disponível.
        const previousClose = safeFloat(Number(cached.previousClose) || 0);
        const hasPreviousClose = previousClose > 0 && currentPrice > 0;
        return {
            dayChangePct: hasPreviousClose
                ? ((currentPrice / previousClose) - 1) * 100
                : safeFloat(Number(cached.change)),
            anchorValueNative: null,
            dayChangeReason: hasPreviousClose
                ? DAY_CHANGE_REASON.PREVIOUS_CLOSE
                : DAY_CHANGE_REASON.PROVIDER_WINDOW,
        };
    }
    // A variação só é de HOJE se a SESSÃO que a produziu for a de hoje.
    // O updatedAt não responde isso: ele diz quando NÓS perguntamos ao
    // provedor. À 00:23 de um dia útil o refresh regrava a linha com o
    // fechamento da véspera, e o card exibia o pregão de ontem como
    // "variação hoje" até a B3 abrir — todo dia, por ~10 horas, com o
    // mesmo movimento contado duas vezes (ontem às 23h59 e hoje de
    // madrugada). É a MESMA guarda que o PU do Tesouro já faz acima.
    //
    // Sem priceDate (fonte que não publica horário, ou documento
    // anterior à migração) cai no teste antigo de dia útil: um número
    // defasado é melhor que zerar a variação da carteira inteira, e o
    // campo se preenche sozinho no primeiro refresh.
    const isTodaySession = cached.priceDate
        ? cached.priceDate === todayKey
        : isTodayBusinessDay;
    return {
        dayChangePct: isTodaySession ? safeFloat(Number(cached.change)) : 0,
        anchorValueNative: null,
        dayChangeReason: isTodaySession
            ? DAY_CHANGE_REASON.PROVIDER_SESSION
            : DAY_CHANGE_REASON.STALE_QUOTE,
    };
};

const NO_FIXED_INCOME = { accruedTotalValue: null, matured: false, pricing: null };

const resolveQuotedDay = (asset, cached, ctx) => {
    const currentPrice = safeUnitPrice(Number(cached.price));
    const anchorClose = anchorCloseFor(asset, ctx.anchorCloses);
    const day = { currentPrice, ...quotedRawDayChange(asset, cached, currentPrice, anchorClose, ctx), ...NO_FIXED_INCOME };

    // Ajuste para ativos comprados HOJE (evita variação irreal no dia da compra)
    const boughtToday = isBoughtOnDay(asset, ctx.todayKey);
    if (!boughtToday || !(asset.quantity > 0)) return day;

    const averagePrice = safePrice(asset.totalCost, asset.quantity);
    if (averagePrice > 0) {
        day.dayChangePct = ((currentPrice / averagePrice) - 1) * 100;
        // Sobrescreve QUALQUER um dos quatro motivos acima: o início do
        // dia deixou de ser um fechamento e passou a ser o custo.
        day.dayChangeReason = DAY_CHANGE_REASON.BOUGHT_TODAY;
        // Posição que não existia no dia-âncora: o início do dia é o
        // custo, não o fechamento de um candle em que ela não estava.
        // Precede a âncora — senão o movimento do dia inteiro entraria
        // como variação de uma posição comprada à tarde.
        day.anchorValueNative = safeValue(asset.quantity, averagePrice);
    }
    return day;
};

// Sem cotação: marca no último fechamento GRAVADO do dia-âncora (o
// mesmo que compôs o snapshot) e, sem ele, no custo médio — a régua
// do rebuild (último preço conhecido → custo) e do snapshot diário.
// Com preço 0 o card zerava o saldo mas mantinha o custo, exibindo
// prejuízo de 100% numa posição que o gráfico mostrava pelo custo.
const resolveUnquotedDay = (asset, ctx) => {
    const anchorClose = anchorCloseFor(asset, ctx.anchorCloses);
    const base = { dayChangePct: 0, dayChangeReason: DAY_CHANGE_REASON.NO_QUOTE, ...NO_FIXED_INCOME };
    if (anchorClose > 0) {
        return { ...base, currentPrice: anchorClose, anchorValueNative: safeValue(asset.quantity, anchorClose) };
    }
    const currentPrice = asset.quantity > 0 ? safePrice(asset.totalCost, asset.quantity) : 0;
    return { ...base, currentPrice, anchorValueNative: null };
};

// Preço, variação do dia e âncora da posição, pela régua da sua classe. O motivo
// (`dayChangeReason`, ver utils/dayChangeReason.js) é atribuído em CADA ramo, na
// mesma ordem em que o valor é sobrescrito: um motivo fora de ordem faz a linha
// exibir um número e explicar outro.
const resolveDayPosition = (asset, ctx) => {
    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') return resolveFixedIncomeDay(asset, ctx);
    const cached = ctx.assetMap.get(asset.ticker);
    if (cached && cached.price > 0) return resolveQuotedDay(asset, cached, ctx);
    return resolveUnquotedDay(asset, ctx);
};

// Câmbio do DIA-ÂNCORA, da mesma série histórica que o snapshot consultou.
// `usdRate / (1 + usdChange/100)` é uma reconstrução a partir da variação
// intraday do provedor e responde outra pergunta ("quanto o dólar subiu nas
// últimas 24h"), então descolava do câmbio com que o patrimônio de ontem foi
// efetivamente gravado — sobrava um resíduo cambial no lugar de zero.
const previousFxMultiplier = (dollarized, usdRate, usdChange, anchorUsdRate) => {
    if (!dollarized) return 1;
    return anchorUsdRate > 0 ? anchorUsdRate : (usdRate / (1 + usdChange / 100));
};

const positionValueBr = (asset, currentPrice, accruedTotalValue, currentMultiplier) => {
    // Renda fixa/caixa: multiplica o TOTAL acumulado (preciso) pelo câmbio, em vez de
    // reconstruir via quantidade × preço unitário arredondado (que perdia centavos).
    //
    // Multiplicação CRUA (sem safeMult) pelo mesmo motivo da divisão em
    // `startValueBr`: safeMult passa por safeFloat e QUANTIZA o total a 4 casas antes
    // de ele ser arredondado a centavos na saída. Dois arredondamentos em sequência
    // não são um arredondamento: um accrual de 15.447,6949… virava 15.447,695 e daí
    // subia para 15.447,70 — um centavo acima do 15.447,69 que a mesma conta dá
    // quando arredondada UMA vez. Cai nessa faixa (x,xx495–x,xx4999) ~0,5% dos
    // valores, e sempre para CIMA: é patrimônio inflado, não ruído simétrico. E o
    // snapshot (`computeEquityAt`) acumula esse mesmo accrual com precisão integral —
    // quantizar só aqui é a divergência KPI × snapshot que a invariante 9 proíbe.
    if (accruedTotalValue !== null) return accruedTotalValue * currentMultiplier;
    const valueBase = asset.type === 'CASH' ? asset.quantity : safeValue(asset.quantity, currentPrice);
    return safeMult(valueBase, currentMultiplier);
};

// Valor de início do dia. Com âncora é o valor MEDIDO no dia-âncora (candle
// gravado / RF avaliada naquela data), o mesmo que compôs o snapshot — e é daí
// que vem a identidade "patrimônio de ontem + variação de hoje = hoje".
//
// Sem âncora, o caminho antigo: renda fixa/caixa deriva do TOTAL acumulado ÷
// fator do dia. Divisão CRUA (sem safeDiv) de propósito: o fator ~1,0005
// arredondado a 4 casas reintroduziria a perda de centavos; arredonda-se só o
// resultado monetário final.
const startValueBr = (asset, day, prevMultiplier) => {
    const { anchorValueNative, accruedTotalValue, dayChangePct, currentPrice } = day;
    if (anchorValueNative !== null) return safeMult(anchorValueNative, prevMultiplier);
    if (accruedTotalValue !== null) return safeMult(accruedTotalValue / (1 + dayChangePct / 100), prevMultiplier);
    // Considera tanto a variação do ativo quanto a variação cambial
    const priceStart = currentPrice / (1 + dayChangePct/100);
    return safeMult(safeValue(asset.quantity, priceStart), prevMultiplier);
};

const fallbackSector = (type) => {
    if (type === 'FIXED_INCOME') return 'Renda Fixa';
    return type === 'CASH' ? 'Caixa' : 'Outros';
};

// Nome, classe econômica e setor: dado ao vivo do mercado → dado salvo → padrão.
const describeAsset = (asset, market) => ({
    // Nome ao vivo (mercado) → nome salvo (cofrinho/renda fixa) → ticker.
    name: market?.name || asset.name || asset.ticker,
    // Classe econômica independente do veículo/moeda. O fallback em tempo de
    // leitura corrige posições legadas mesmo antes do backfill persistido.
    allocationClass: resolveAllocationClass({
        ticker: asset.ticker,
        type: asset.type,
        allocationClass: asset.allocationClass || market?.allocationClass,
        sector: market?.sector,
    }),
    sector: market?.sector || fallbackSector(asset.type),
});

// Renda fixa: como a posição foi precificada. 'MTM' = título público
// marcado pelo PU oficial; 'ACCRUAL' = valor na curva (RF privada, título
// com cupom semestral ou série indisponível). `accruedValue` acompanha
// sempre, para a UI poder mostrar mercado × curva lado a lado.
const fixedIncomePricingFields = (asset, pricing, currentMultiplier) => ({
    pricingSource: pricing ? pricing.source : null,
    accruedValue: pricing ? safeCurrency(safeMult(pricing.accrued, currentMultiplier)) : null,
    priceDate: pricing ? pricing.priceDate : null,
    // PU OFICIAL do título (hoje e o médio de compra) + a fração implícita.
    //
    // Existem porque `averagePrice`/`currentPrice` não servem para renda fixa:
    // são custo÷quantidade e saldo÷quantidade, e a quantidade da RF não segue
    // convenção — o cadastro manual pede só o valor investido e grava 1, o
    // extrato da B3 traz a fração real. O mesmo Tesouro IPCA+ 2032 aparecia
    // com "preço médio" R$ 735,92 numa carteira e R$ 2.943,68 na outra.
    // Derivados do PU oficial, estes três não dependem da digitação e batem
    // com o extrato do Tesouro Direto.
    //
    // Só existem no caminho MTM: sem PU público (CDB, LCI, cupom semestral)
    // não há preço de título para exibir, e a UI omite a coluna.
    treasuryUnitPrice: pricing?.unitPrice ? safeCurrency(pricing.unitPrice) : null,
    treasuryUnits: pricing?.units ? safeQuantity(pricing.units) : null,
    // `safePrice` e não `safeDiv`: a fração pode ter 8 casas, e safeDiv trunca
    // o divisor a 4 — numa fração pequena isso deslocaria o PU médio.
    treasuryAverageUnitPrice: pricing?.units ? safeCurrency(safePrice(asset.totalCost, pricing.units)) : null,
});

const buildProcessedCard = (asset, market, day, figures) => {
    const { currentPrice, dayChangeReason, matured, pricing } = day;
    const { totalValueBr, totalCostBr, positionTotalResult, profitPercent, combinedChangePct, dayChangeValueBr, currentMultiplier } = figures;
    const identity = describeAsset(asset, market);
    return {
        id: asset._id,
        ticker: asset.ticker,
        name: identity.name,
        type: asset.type,
        allocationClass: identity.allocationClass,
        quantity: asset.quantity,
        averagePrice: asset.quantity > 0 ? safePrice(asset.totalCost, asset.quantity) : 0,
        currentPrice: asset.type === 'CASH' ? 1 : currentPrice,
        currency: asset.currency,
        totalValue: safeCurrency(totalValueBr),
        totalCost: safeCurrency(totalCostBr),
        profit: safeCurrency(positionTotalResult),
        profitPercent: safeFloat(profitPercent),
        sector: identity.sector,
        dayChangePct: safeFloat(combinedChangePct),
        // Contribuição da posição para a Variação Hoje, em BRL. É o MESMO número
        // que `buildWalletPayload` acumula no total do card — exposto para o
        // detalhamento do dia poder explicar o total sem recalculá-lo por outra
        // régua, que é como as duas pontas voltariam a discordar.
        //
        // O arredondamento aqui é só de exibição: o total soma os valores CRUS e
        // arredonda uma vez. `reconcileRoundedParts` fecha o resíduo depois do laço.
        dayChangeValue: safeCurrency(dayChangeValueBr),
        // Qual régua produziu o número acima (utils/dayChangeReason.js). Sem ele,
        // o zero de "não temos cotação de hoje" é indistinguível do zero de "o
        // ativo fechou estável", e a tela some com a diferença.
        dayChangeReason,
        tags: asset.tags, // Return tags
        // Sub-tipos usados pela ramificação da Carteira Ideal (real vs meta):
        // RF → índice (IPCA/SELIC/CDI/PRE); Exterior → usSubType (STOCK/ETF/REIT/DOLLAR).
        fixedIncomeIndex: asset.fixedIncomeIndex || null,
        // Taxa contratada — o front usa junto com o índice para classificar o sub-tipo
        // (%CDI manual sem índice: rate > 50 → pós-fixado, espelhando o accrual).
        fixedIncomeRate: asset.fixedIncomeRate ?? null,
        usSubType: asset.usSubType || null,
        // C1: reserva separada. Fallback p/ posições ainda não migradas: CASH é
        // reserva por natureza (mantém o comportamento antigo até a migração rodar).
        isReserve: asset.isReserve ?? (asset.type === 'CASH'),
        // C2: vencimento da RF + flag VENCIDO (accrual congelado; UI sugere resgate).
        maturityDate: asset.maturityDate || null,
        matured,
        ...fixedIncomePricingFields(asset, pricing, currentMultiplier),
    };
};

// Processa um único ativo: resolve preço/variação e devolve o card pronto +
// as contribuições para os totais da carteira. Aritmética idêntica à original.
//
// ÂNCORA DO DIA (`anchorDayKey`/`anchorCloses`/`anchorUsdRate`): o "início do dia"
// de cada posição é o MESMO dado que o snapshot-âncora usou para gravar o
// patrimônio daquele dia — fechamento do candle e câmbio do dia-âncora. É isso
// que faz valer a identidade
//
//     patrimônio do último snapshot + Variação Hoje === patrimônio de hoje
//
// Antes cada ponta lia uma fonte: o snapshot marcava pelo candle gravado e o card
// reconstruía o início do dia por `preço ÷ (1 + change do provedor)`. As duas só
// coincidem quando o provedor não mexe na referência — e ele mexe. Em 01/09/2026,
// seis FIIs ficaram ex-provento e o Yahoo baixou `regularMarketPreviousClose` pelo
// valor do provento (TRXF11: candle 79,30 × prevClose 78,37 = exatamente os R$ 0,93
// que o fundo distribui todo mês), enquanto o candle guardava o fechamento cheio.
// Resultado: a queda do dia-ex entrava no patrimônio e sumia da variação, e a tela
// exibia "+R$ 7,97 hoje" com o patrimônio R$ 8,14 MENOR que o de ontem.
//
// Cripto sofria do mesmo mal por outro caminho: negocia 24h, e o `previousClose` do
// provedor corta o dia numa hora e o candle gravado noutra.
//
// Sem âncora (carteira nova, ativo sem candle no dia) cai no caminho antigo: um
// número reconstruído é melhor que zerar a variação da carteira inteira.
export const processWalletAsset = (asset, {
    assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing = EMPTY_TREASURY_PRICING,
    todayKey = brazilDateKey(), anchorDayKey = null, anchorCloses = null, anchorUsdRate = 0,
}) => {
    const day = resolveDayPosition(asset, {
        assetMap, macroRates, isTodayBusinessDay, treasuryPricing, todayKey, anchorDayKey, anchorCloses,
    });

    const dollarized = isDollarized(asset);
    const currentMultiplier = dollarized ? usdRate : 1;
    const prevMultiplier = previousFxMultiplier(dollarized, usdRate, usdChange, anchorUsdRate);
    const totalValueBr = positionValueBr(asset, day.currentPrice, day.accruedTotalValue, currentMultiplier);

    // Custo em BRL com o câmbio de CADA compra congelado. Reconverter o custo em
    // dólar pela cotação de hoje (comportamento anterior, hoje só fallback de
    // posição não migrada) cancelava o câmbio contra o saldo: o resultado passava
    // a ser o retorno em dólar, e um stablecoin ficava travado em 0,00% eterno.
    // safeFloat (4 casas) e não safeCurrency: o saldo do outro lado da conta
    // também é 4 casas, e arredondar só o custo criava um percentual fantasma de
    // ~0,05% em posições sem movimento. O arredondamento monetário acontece uma
    // única vez, na saída (`processed.totalCost`).
    const totalCostBr = safeFloat(positionCostBRL(asset, usdRate));

    // Cálculo robusto da variação diária em BRL
    const valueStartBr = startValueBr(asset, day, prevMultiplier);
    const dayChangeValueBr = safeSub(totalValueBr, valueStartBr);
    const combinedChangePct = valueStartBr > 0 ? ((totalValueBr / valueStartBr) - 1) * 100 : 0;

    // Subtração e soma CRUAS pelo mesmo motivo de `totalValueBr`: estes dois
    // números existem só para virar `processed.profit`, que já arredonda a
    // centavos. Passar por safeSub/safeAdd reintroduziria a quantização a 4 casas
    // no meio do caminho e o lucro voltaria a subir um centavo sozinho — no MESMO
    // valor em que `totalValue` não sobe mais, deixando saldo, custo e lucro
    // discordando por um centavo dentro da mesma linha da tela.
    const unrealizedProfitBr = totalValueBr - totalCostBr;
    // Cada venda convertida pelo câmbio do dia dela (não o de hoje).
    const realizedProfitBr = safeFloat(positionRealizedProfitBRL(asset, usdRate));
    const positionTotalResult = unrealizedProfitBr + realizedProfitBr;

    // calculatePercent(atual, inicial) = variação entre DOIS VALORES. Passar o
    // lucro como "atual" devolvia lucro/custo − 100 (um ativo com +10% saía
    // como −90%). O valor atual da posição é saldo + realizado.
    const profitPercent = totalCostBr > 0
        ? calculatePercent(safeAdd(totalValueBr, realizedProfitBr), totalCostBr)
        : 0;

    const processed = buildProcessedCard(asset, assetMap.get(asset.ticker), day, {
        totalValueBr, totalCostBr, positionTotalResult, profitPercent, combinedChangePct, dayChangeValueBr, currentMultiplier,
    });

    return { processed, totalValueBr, totalCostBr, dayChangeValueBr };
};
