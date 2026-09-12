import mongoose from 'mongoose';

/**
 * Imagem anexada a uma mensagem de ticket, guardada FORA do ticket.
 *
 * A separação não é organizacional, é de custo. Se o base64 morasse dentro de
 * `SupportTicket.messages[]`, toda listagem do Admin arrastaria megabytes de
 * imagem para montar uma tabela que só mostra assunto e status — e uma thread
 * longa com prints caminharia para o teto de 16MB por documento do Mongo. Aqui
 * o ticket carrega só os ids, e o byte é buscado uma imagem por vez.
 *
 * `data` é a data-URL completa (`data:image/png;base64,...`), validada por
 * regex em `supportRules.js` antes de chegar aqui — mesmo padrão do avatar.
 *
 * Sem TTL: o anexo vive e morre com o ticket, e ticket é registro de
 * atendimento, não sinal operacional como o ErrorLog.
 */
const SupportAttachmentSchema = new mongoose.Schema({
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
    // Dono do anexo. Duplicado em relação ao ticket de propósito: a rota que
    // serve a imagem autoriza sem precisar carregar a thread inteira.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    mimeType: { type: String, required: true },
    // Tamanho da data-URL em bytes — é o que ocupa o banco, e o que o painel mostra.
    size: { type: Number, required: true },
    data: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

const SupportAttachment = mongoose.models.SupportAttachment
    || mongoose.model('SupportAttachment', SupportAttachmentSchema);

export default SupportAttachment;
