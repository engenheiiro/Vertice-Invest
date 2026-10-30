import { z } from 'zod';

/**
 * Data VALIDADA mas NÃO convertida.
 *
 * O `validate()` passou a devolver ao controller o resultado do parse (trim,
 * toLowerCase, coerce de número, defaults). Para datas isso seria um defeito:
 * `z.coerce.date('2026-10-30')` vira meia-noite UTC, que em Brasília é o dia
 * ANTERIOR — e os controllers tratam o texto `YYYY-MM-DD` como dia civil
 * (`parseCalendarDate`). Aqui só se confere que o valor é interpretável; o
 * controller continua recebendo exatamente o que o cliente mandou.
 */
export const calendarDate = (message) => z.custom(
    (value) => (typeof value === 'string' || typeof value === 'number' || value instanceof Date)
        && !Number.isNaN(new Date(value).getTime()),
    { message },
);
