/**
 * Mensagens de tipo no formato da Zod 4.
 *
 * A Zod 4 removeu `required_error`, `invalid_type_error` e `errorMap` — e os
 * IGNORA em silêncio: o schema continua validando, mas a mensagem em português
 * vira "Invalid input: expected string, received undefined" na cara do usuário.
 * Este helper reproduz a semântica da Zod 3 com o parâmetro `error` novo:
 *
 *   - campo ausente (`undefined`)  → `required`
 *   - tipo errado                  → `invalid`
 *   - mensagem não informada       → `undefined`, que cede ao padrão da Zod
 *
 * Uso: `z.string(typeMessages({ required: 'Nome é obrigatório' }))`.
 */
export const typeMessages = ({ required, invalid } = {}) => ({
    error: (issue) => (issue.input === undefined ? required : invalid),
});
