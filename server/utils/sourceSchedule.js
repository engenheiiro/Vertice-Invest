/**
 * QUANDO CADA FONTE VOLTA A RODAR.
 *
 * Nasceu de uma pergunta concreta diante do painel: "tem muito card cinza — que
 * horas eles rodam?". Cinza sem previsão é indistinguível de cinza abandonado, e
 * quem olha não sabe se espera dez minutos ou o dia inteiro.
 *
 * Duas naturezas bem diferentes se escondiam sob o mesmo cinza, e separá-las é
 * metade da resposta:
 *
 *  - **Agendada** (`scheduled`): tem hora marcada. Cinza aqui significa "ainda não
 *    chegou a vez dela desde o último reinício" — e o painel diz qual é a vez.
 *  - **De reserva** (`onFailure`): só é chamada quando a fonte anterior da cadeia
 *    falha. Cinza aqui é BOA notícia: ninguém precisou dela. Marcar isso de
 *    amarelo seria alarmar por um sistema funcionando como projetado.
 *
 * Sem dependência de parser de cron: as formas usadas são poucas e conhecidas, e
 * o horário do Brasil não tem horário de verão desde 2019 — então a distância até
 * o próximo disparo pode ser contada em minutos de relógio de parede, sem
 * conversão de fuso.
 */

/** Hora e minuto correntes no fuso de São Paulo, sem depender do relógio do host. */
export const brNow = (now = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(now));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    return { hour: get('hour') % 24, minute: get('minute') };
};

const doisDigitos = (n) => String(n).padStart(2, '0');

/**
 * Minutos até o próximo disparo, ou `null` para fonte de reserva.
 *
 * @param {object|null} schedule `{kind:'minutes', at:[5,20,35,50]}` |
 *   `{kind:'dailyTimes', at:['09:00','18:30']}` | `{kind:'onFailure'}`
 * @param {Date} [now]
 */
export const minutesUntilNextRun = (schedule, now = new Date()) => {
    if (!schedule || schedule.kind === 'onFailure') return null;
    const { hour, minute } = brNow(now);

    if (schedule.kind === 'minutes') {
        const alvos = [...(schedule.at || [])].sort((a, b) => a - b);
        if (!alvos.length) return null;
        const proximo = alvos.find((m) => m > minute);
        // Nenhum alvo depois do minuto atual: o primeiro da próxima hora.
        return proximo !== undefined ? proximo - minute : (60 - minute) + alvos[0];
    }

    if (schedule.kind === 'dailyTimes') {
        const agora = hour * 60 + minute;
        const alvos = (schedule.at || [])
            .map((t) => {
                const [h, m] = String(t).split(':').map(Number);
                return h * 60 + m;
            })
            .filter((v) => Number.isFinite(v))
            .sort((a, b) => a - b);
        if (!alvos.length) return null;
        const proximo = alvos.find((v) => v > agora);
        return proximo !== undefined ? proximo - agora : (24 * 60 - agora) + alvos[0];
    }

    return null;
};

/**
 * Frase curta do próximo disparo ("em 7 min", "hoje às 18:30", "amanhã às 09:00").
 *
 * Para o que roda de 15 em 15 minutos, a distância diz mais que o horário — ninguém
 * decora que o macro-sync cai no minuto 20. Para o que roda uma ou duas vezes por
 * dia, o horário diz mais que a distância: "em 4h12" obriga a fazer a conta que
 * "hoje às 18:30" já entrega.
 */
export const nextRunLabel = (schedule, now = new Date()) => {
    const minutos = minutesUntilNextRun(schedule, now);
    if (minutos === null) return null;

    if (schedule.kind === 'minutes') {
        return minutos <= 1 ? 'em instantes' : `em ${minutos} min`;
    }

    const { hour, minute } = brNow(now);
    const alvo = (hour * 60 + minute + minutos) % (24 * 60);
    const relogio = `${doisDigitos(Math.floor(alvo / 60))}:${doisDigitos(alvo % 60)}`;
    const viraODia = hour * 60 + minute + minutos >= 24 * 60;
    return `${viraODia ? 'amanhã' : 'hoje'} às ${relogio}`;
};

/** Frase da periodicidade, para o detalhe da fonte. */
export const cadenceLabel = (schedule) => {
    if (!schedule || schedule.kind === 'onFailure') {
        return 'Só é chamada quando a fonte anterior da cadeia falha';
    }
    if (schedule.kind === 'minutes') {
        const n = (schedule.at || []).length;
        if (n === 4) return 'A cada 15 minutos';
        if (n === 2) return 'A cada 30 minutos';
        return `${n}× por hora`;
    }
    if (schedule.kind === 'dailyTimes') {
        const horas = (schedule.at || []).join(' e ');
        return `Todo dia às ${horas}`;
    }
    return null;
};
