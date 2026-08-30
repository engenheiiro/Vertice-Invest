/**
 * Escapa metacaracteres para uso literal dentro de uma RegExp.
 *
 * Texto digitado pelo usuário não é padrão de busca. Sem escapar, "Tesouro IPCA+
 * 2037" vira a regex `IPCA+ 2037` — "IPC" seguido de um ou mais "A" — que não casa
 * nenhum título do catálogo: quem digitava o nome exato como aparece na tela não
 * achava nada. E um padrão patológico (`(a+)+$`) vira trabalho exponencial do lado
 * do banco.
 */
export const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default escapeRegex;
