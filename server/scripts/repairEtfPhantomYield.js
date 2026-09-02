/**
 * Reparo — dividend yield fantasma em ETF nacional.
 *
 * Contexto do bug: `config/brEtfList.js` carregava um `seedYield` curado à mão para
 * BOVA11 (4,5%), DIVO11 (6,0%) e SMAL11 (2,0%), usado como fallback final quando
 * nenhuma fonte viva devolvia `dy`. Como o Yahoo nunca devolve provento de fundo em
 * ticker `.SA`, o fallback era na prática a ÚNICA fonte — e a premissa era falsa: os
 * três são ETFs de ACUMULAÇÃO, reinvestem os proventos na cota e não pagam nada ao
 * cotista. Efeito medido numa carteira real: R$ 4,53/mês de renda projetada em 7 cotas
 * de BOVA11 (39% da "Média Mensal Est.") vindos de um ativo com ZERO eventos de
 * provento no razão, além de um bônus de +12 DEFENSIVE por "ETF de Renda" no ranking.
 *
 * A remoção do seed conserta a ORIGEM, mas só age no próximo refresh de fundamentos —
 * até lá o `dy` fantasma segue gravado em `MarketAsset` e continua entrando em qualquer
 * ranking publicado. Este script limpa o que já está no banco.
 *
 * Estratégia (fail-closed): para os ETFs que a lista curada declara de acumulação,
 * zera o `dy` e remove todo `DividendEvent` PROVISÓRIO — esses fundos reinvestem os
 * rendimentos e não podem gerar crédito ao cotista. Para ETFs BRL fora dessa lista,
 * mantém a regra anterior: `dy > 0` sem evento corroborando é zerado.
 *
 * Idempotente: reexecutar depois do conserto não altera nada.
 *
 * Uso:
 *   node server/scripts/repairEtfPhantomYield.js --dry
 *   node server/scripts/repairEtfPhantomYield.js --ticker=IVVB11
 *   node server/scripts/repairEtfPhantomYield.js
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';
import MarketAsset from '../models/MarketAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import { isAccumulatingBrEtf } from '../config/brEtfList.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.slice(2).includes('--dry');
const tickerArg = process.argv.slice(2).find((arg) => arg.startsWith('--ticker='));
const onlyTicker = tickerArg
    ? tickerArg.slice('--ticker='.length).trim().toUpperCase().replace(/\.SA$/, '')
    : null;

const run = async () => {
    try {
        await connectScriptDb({ label: 'repairEtfPhantomYield' });
        console.log(`🔧 Reparo de yield fantasma em ETF ${dryRun ? '(DRY RUN)' : ''}...\n`);

        // ETF nacional (BRL). ETF/REIT americano tem yield de fonte viva confiável e
        // fica fora — o defeito era específico do `.SA`, sem cobertura de proventos.
        const etfs = await MarketAsset.find({
            type: 'ETF',
            currency: 'BRL',
            ...(onlyTicker ? { ticker: onlyTicker } : {}),
        })
            .select('ticker dy lastPrice')
            .lean();

        if (onlyTicker && etfs.length === 0) {
            throw new Error(`ETF BRL não encontrado: ${onlyTicker}`);
        }

        const phantom = [];
        const invalidDerived = [];
        let corroborated = 0;
        let alreadyZero = 0;

        for (const etf of etfs) {
            const dy = Number(etf.dy) || 0;

            if (isAccumulatingBrEtf(etf.ticker)) {
                const derivedEvents = await DividendEvent.countDocuments({ ticker: etf.ticker, source: 'DERIVED' });
                if (derivedEvents > 0) invalidDerived.push({ ticker: etf.ticker, count: derivedEvents });
                if (dy > 0) phantom.push({ ticker: etf.ticker, dy });
                else alreadyZero++;
                continue;
            }

            if (dy <= 0) { alreadyZero++; continue; }

            const events = await DividendEvent.countDocuments({ ticker: etf.ticker });
            if (events > 0) { corroborated++; continue; }
            phantom.push({ ticker: etf.ticker, dy });
        }

        for (const p of phantom) {
            console.log(`   ✓ ${p.ticker.padEnd(8)} dy ${p.dy} → 0  (nenhum evento de provento no razão)`);
            if (!dryRun) {
                await MarketAsset.updateOne({ ticker: p.ticker }, { $set: { dy: 0 } });
            }
        }

        for (const p of invalidDerived) {
            console.log(`   ✓ ${p.ticker.padEnd(8)} ${p.count} provento(s) provisório(s) inválido(s) → removido(s)`);
            if (!dryRun) {
                await DividendEvent.deleteMany({ ticker: p.ticker, source: 'DERIVED' });
            }
        }

        console.log(
            `\n📊 Resumo: ${etfs.length} ETFs BRL | ${alreadyZero} já com dy=0 | ` +
            `${corroborated} com yield corroborado pelo razão | ${phantom.length} yield(s) fantasma(s) zerado(s) | ` +
            `${invalidDerived.reduce((sum, item) => sum + item.count, 0)} provento(s) provisório(s) inválido(s) removido(s)${dryRun ? ' (dry)' : ''}`
        );

        if (phantom.length) {
            console.log('\n   Obs.: rankings JÁ PUBLICADOS mantêm o score antigo (o bônus de "ETF de Renda"');
            console.log('   ficou congelado no MarketAnalysis salvo). O próximo run do pipeline recalcula');
            console.log('   sem o bônus. O KPI de proventos da carteira já está imune: a projeção passou');
            console.log('   a ser medida no próprio razão, não em `dy` (ver financialService).');
        }

        console.log(dryRun ? '\n✅ DRY RUN concluído (nada foi gravado).' : '\n✅ Reparo concluído.');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
