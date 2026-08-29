/**
 * Separa um lote de Tesouro que foi lançado DENTRO da posição de outro título.
 *
 * Existe por causa de um defeito de origem, não de cálculo: o Investidor10 não
 * exporta histórico de negócios, então a carteira colada de lá entra como uma
 * compra por linha, na data de início informada. Quando o usuário tem dois
 * títulos do Tesouro que vencem no mesmo ano, é fácil os dois virarem lotes da
 * MESMA posição — foi o que aconteceu com "Tesouro IPCA+ 2032", que carregava
 * junto o lote do "Tesouro Prefixado 2032".
 *
 * O estrago não é só cosmético: `resolveTreasuryTitleKey` casa o título pelo
 * NOME da posição, então os dois lotes eram marcados a mercado pela curva do
 * IPCA+ — o Prefixado valorizava por um PU que não é o dele.
 *
 * O que o script faz: reaponta o lançamento do lote para um ticker próprio,
 * recalcula as duas posições e reconstrói o histórico da carteira. O VALOR do
 * lote é preservado como está — separar não é reprecificar; corrigir custo é
 * outra decisão, e ela é do dono da carteira.
 *
 * Dry-run por padrão (não escreve nada):
 *   node server/scripts/splitTreasuryLot.js --email=x@y.com --wallet="Minha carteira" \
 *     --from="TESOURO IPCA+ 2032" --to="TESOURO PREFIXADO 2032" --date=2026-07-06 \
 *     --name="Tesouro Prefixado 2032" --maturity=2032-01-01 --rate=14.57 [--apply]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { financialService } = await import('../services/financialService.js');
const { default: UserAsset } = await import('../models/UserAsset.js');
const { default: AssetTransaction } = await import('../models/AssetTransaction.js');
const { default: User } = await import('../models/User.js');
const { default: Wallet } = await import('../models/Wallet.js');
const { toDateKey } = await import('../utils/dateUtils.js');

const arg = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};
const APPLY = process.argv.includes('--apply');

const email = arg('email');
const walletRef = arg('wallet');
const fromTicker = arg('from');
const toTicker = arg('to');
const lotDate = arg('date');
const newName = arg('name');
const maturity = arg('maturity');
const rate = arg('rate');

if (!email || !walletRef || !fromTicker || !toTicker || !lotDate) {
    console.error('Uso: --email= --wallet= --from= --to= --date=YYYY-MM-DD [--name=] [--maturity=YYYY-MM-DD] [--rate=] [--apply]');
    process.exit(1);
}

const brl = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const showPosition = async (userId, walletId, ticker, label) => {
    const a = await UserAsset.findOne({ user: userId, wallet: walletId, ticker }).lean();
    if (!a) { console.log(`  ${label} ${ticker}: (não existe)`); return; }
    console.log(`  ${label} ${ticker}: qty=${a.quantity} custo=${brl(a.totalCost)} lotes=[${a.taxLots.map((l) => `${toDateKey(l.date)} ${l.quantity}×${l.price}`).join(' | ')}]`);
};

const run = async () => {
    await connectScriptDb({ label: 'splitTreasuryLot' });

    const user = await User.findOne({ email }).lean();
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    const wallets = await Wallet.find({ user: user._id }).lean();
    const wallet = wallets.find((w) => String(w._id) === walletRef || w.name === walletRef);
    if (!wallet) throw new Error(`Carteira não encontrada: ${walletRef} (tem: ${wallets.map((w) => w.name).join(', ')})`);

    // O lote é identificado pelo DIA, não pelo _id: é o que o dono da carteira
    // enxerga na tela. Mais de um lançamento no mesmo dia é ambiguidade real —
    // aborta em vez de escolher um.
    const candidates = await AssetTransaction.find({ user: user._id, wallet: wallet._id, ticker: fromTicker }).sort({ date: 1 });
    const matches = candidates.filter((t) => toDateKey(t.date) === lotDate);
    if (matches.length === 0) throw new Error(`Nenhum lançamento de ${fromTicker} em ${lotDate} (tem: ${candidates.map((t) => toDateKey(t.date)).join(', ')})`);
    if (matches.length > 1) throw new Error(`${matches.length} lançamentos de ${fromTicker} em ${lotDate} — desambigue manualmente.`);
    const tx = matches[0];

    console.log(`\n=== ${wallet.name} (${wallet._id}) — ${APPLY ? 'APLICANDO' : 'DRY-RUN'} ===`);
    console.log(`Lote a separar: ${toDateKey(tx.date)} ${tx.type} ${tx.quantity} × ${tx.price} = ${brl(tx.quantity * tx.price)}`);
    console.log('\nANTES:');
    await showPosition(user._id, wallet._id, fromTicker, ' ');
    await showPosition(user._id, wallet._id, toTicker, ' ');

    if (!APPLY) {
        console.log('\n(dry-run — nada foi escrito. Repita com --apply)');
        await mongoose.disconnect();
        return;
    }

    tx.ticker = toTicker;
    if (newName) tx.notes = `Nome: ${newName}`;
    await tx.save();

    // Ordem importa: a posição de destino primeiro (o lançamento já é dela), e a
    // de origem depois — assim nenhuma das duas fica com o lote contado duas vezes
    // se o processo morrer no meio.
    await financialService.recalculatePosition(user._id, toTicker, 'FIXED_INCOME', null, 'BRL', wallet._id);
    await financialService.recalculatePosition(user._id, fromTicker, 'FIXED_INCOME', null, 'BRL', wallet._id);

    // Metadado do título novo. `recalculatePosition` só reconstrói quantidade e
    // custo; nome, vencimento e taxa são cadastro, e sem eles a marcação a
    // mercado cai no accrual (ou, pior, casa o título errado).
    const created = await UserAsset.findOne({ user: user._id, wallet: wallet._id, ticker: toTicker });
    if (created) {
        if (newName) created.name = newName;
        if (maturity) created.maturityDate = new Date(`${maturity}T00:00:00.000Z`);
        if (rate) created.fixedIncomeRate = Number(rate);
        created.fixedIncomeIndex = null;   // prefixado: sem indexador
        created.fixedIncomeSpread = 0;
        created.isReserve = false;
        await created.save();
    }

    await financialService.rebuildUserHistory(user._id, wallet._id);

    console.log('\nDEPOIS:');
    await showPosition(user._id, wallet._id, fromTicker, ' ');
    await showPosition(user._id, wallet._id, toTicker, ' ');

    await mongoose.disconnect();
};

run().catch((e) => { console.error(e.message); process.exit(1); });
