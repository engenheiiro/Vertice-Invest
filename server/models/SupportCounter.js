import mongoose from 'mongoose';

/**
 * Contador do código legível do ticket ("VT-0042").
 *
 * Coleção de um documento só. Existe porque o número precisa ser sequencial e
 * sem buraco entre dois pedidos simultâneos: `findOneAndUpdate` com `$inc` e
 * `upsert` é atômico no servidor do Mongo, enquanto "conta quantos tickets
 * existem e soma 1" repete o mesmo número quando duas pessoas abrem ao mesmo
 * tempo — e o índice único de `code` derrubaria uma das duas aberturas.
 */
const SupportCounterSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'TICKET' },
    seq: { type: Number, default: 0 },
});

const SupportCounter = mongoose.models.SupportCounter
    || mongoose.model('SupportCounter', SupportCounterSchema);

export default SupportCounter;
