/**
 * Clona uma carteira inteira (posições, lançamentos, histórico e metas) para uma
 * carteira NOVA do mesmo usuário.
 *
 * Existe para uma coisa: tirar um retrato antes de mexer numa carteira real. As
 * correções de carteira (separar uma posição, refazer custo, reimportar extrato)
 * mexem em `AssetTransaction` e disparam `rebuildUserHistory` — não têm desfazer.
 * Com o clone, o desfazer é apagar a carteira corrigida e renomear a cópia.
 *
 * O que NÃO é copiado, de propósito:
 *  - `publicToken`/`isPublic`: o índice único é parcial sobre token string, e
 *    duas carteiras com o mesmo token colidiriam. Além disso, clonar um link
 *    compartilhado publicaria a cópia sem ninguém pedir.
 *  - `isDefault`: a carteira padrão do usuário continua sendo a original.
 *  - `User.activeWalletId`: a carteira ativa não muda.
 *
 * Os snapshots são COPIADOS em vez de reconstruídos: o objetivo é um retrato
 * fiel, e `rebuildUserHistory` recalcularia a série com os preços de hoje.
 *
 * Uso (dry-run por padrão — não escreve nada):
 *   node scripts/cloneWallet.js --email=x@y.com --from="ToInvestindo!" --name="Cópia"
 *   node scripts/cloneWallet.js --email=x@y.com --from="ToInvestindo!" --name="Cópia" --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const arg = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};
const APPLY = process.argv.includes('--apply');

const email = arg('email');
const fromName = arg('from');
const newName = arg('name');

if (!email || !fromName || !newName) {
    console.error('Uso: node scripts/cloneWallet.js --email=<email> --from="<carteira origem>" --name="<nome da cópia>" [--apply]');
    process.exit(1);
}

// Schemas soltos: o script copia documentos como estão, sem impor o schema da
// aplicação (que preencheria defaults e mascararia um campo legado).
const loose = (collection) => mongoose.model(collection, new mongoose.Schema({}, { strict: false, collection }));
const User = loose('users');
const Wallet = loose('wallets');
const UserAsset = loose('userassets');
const AssetTransaction = loose('assettransactions');
const WalletSnapshot = loose('walletsnapshots');

/** Documento pronto para reinserção: sem `_id`/`__v` e apontando para a cópia. */
const reparent = (doc, walletId) => {
    const { _id, __v, ...rest } = doc;
    return { ...rest, wallet: walletId };
};

const run = async () => {
    await connectScriptDb({ label: 'cloneWallet' });

    const user = await User.findOne({ email }).lean();
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    const source = await Wallet.findOne({ user: user._id, name: fromName }).lean();
    if (!source) throw new Error(`Carteira não encontrada: "${fromName}"`);

    const clash = await Wallet.findOne({ user: user._id, name: newName }).lean();
    if (clash) throw new Error(`Já existe uma carteira chamada "${newName}" — escolha outro nome.`);

    const [assets, transactions, snapshots] = await Promise.all([
        UserAsset.find({ wallet: source._id }).lean(),
        AssetTransaction.find({ wallet: source._id }).lean(),
        WalletSnapshot.find({ wallet: source._id }).lean(),
    ]);

    console.log(`\nOrigem : "${source.name}" (${source._id})`);
    console.log(`Destino: "${newName}"`);
    console.log(`  ${assets.length} posições · ${transactions.length} lançamentos · ${snapshots.length} snapshots`);

    if (!APPLY) {
        console.log('\nDRY-RUN — nada foi escrito. Repita com --apply para clonar.\n');
        return;
    }

    const { _id, __v, name, isDefault, publicToken, isPublic, createdAt, ...targets } = source;
    const [copy] = await Wallet.insertMany([{
        ...targets,
        user: user._id,
        name: newName,
        isDefault: false,
        publicToken: null,
        isPublic: false,
        createdAt: new Date(),
    }]);

    // Em lotes: um `insertMany` de milhares de snapshots estoura o limite de 16MB
    // do comando. 500 é folgado para qualquer um dos três documentos.
    const insertAll = async (model, docs) => {
        for (let i = 0; i < docs.length; i += 500) {
            await model.insertMany(docs.slice(i, i + 500).map((d) => reparent(d, copy._id)), { ordered: true });
        }
    };

    await insertAll(UserAsset, assets);
    await insertAll(AssetTransaction, transactions);
    await insertAll(WalletSnapshot, snapshots);

    console.log(`\n✔ Carteira "${newName}" criada: ${copy._id}`);
    console.log('  A carteira ativa e a padrão do usuário não foram alteradas.\n');
};

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Falhou:', error.message);
        process.exit(1);
    });
