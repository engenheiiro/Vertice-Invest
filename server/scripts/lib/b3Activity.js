/**
 * ATIVIDADE REAL NA B3 — o ticker teve NEGÓCIO nos últimos pregões?
 *
 * Por que existe: o probe ao vivo (`lib/quoteProbe.js`) pergunta "alguma fonte
 * devolve preço?", e essa pergunta tem um falso positivo caro. O `chart` do Yahoo
 * responde com o último candle dentro da janela pedida, então um papel que saiu
 * da bolsa continua "recuperando" por semanas; o Google serve o último preço
 * conhecido por tempo indeterminado. Em 04/09/2026 esse eco disse que NGRD3,
 * TRAD3 e HSRE11 estavam vivos — o arquivo oficial da B3 mostrou ZERO negócios
 * nos 10 pregões anteriores para os três.
 *
 * O arquivo diário da B3 é a única fonte que responde a pergunta certa: ele lista
 * o que foi NEGOCIADO no pregão, não o que alguém guardou em cache. Um símbolo
 * ausente de 10 pregões seguidos não é papel ilíquido — papel ilíquido aparece em
 * alguns dias com 2 ou 3 negócios (EQMA3B, no mesmo levantamento, apareceu em
 * 6 de 10). Ausência total é símbolo que deixou de existir.
 *
 * A inversão que isto permite vale nos DOIS sentidos:
 *   - negociou → NUNCA aposentar, mesmo que todas as fontes falhem (é lacuna de
 *     fonte, não morte);
 *   - não negociou em N pregões → aposentar, mesmo que uma fonte ecoe preço.
 */
import { fetchB3DailyCloses } from '../../services/b3DailyFileService.js';

/** Tipos que negociam na B3 — só para eles esta evidência existe. */
export const isB3Type = (type) => type === 'STOCK' || type === 'FII' || type === 'ETF';

/**
 * Carrega os últimos `sessions` pregões publicados.
 *
 * Anda para trás no calendário até juntar N arquivos: fim de semana, feriado e
 * pregão ainda em apuração devolvem `null` e simplesmente não contam. `lookback`
 * limita a varredura para o script não cavar meses se a B3 estiver fora do ar.
 */
export const loadB3Window = async ({ sessions = 10, lookback = 25 } = {}) => {
    const dias = [];
    for (let i = 0; i < lookback && dias.length < sessions; i += 1) {
        const dia = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
         
        const closes = await fetchB3DailyCloses(dia);
        if (closes) dias.push({ dia, closes });
    }
    return dias;
};

/**
 * Veredito de atividade para um ticker dentro da janela.
 *
 * `conclusive: false` quando a janela veio vazia (B3 fora do ar, feriado longo):
 * sem evidência, quem decide volta a ser o probe — nunca o silêncio desta função.
 */
export const b3Activity = (ticker, janela = []) => {
    if (!janela.length) return { conclusive: false, sessions: 0, traded: 0, lastPrice: null, avgTrades: 0 };
    const hits = janela.filter((d) => d.closes.has(ticker)).map((d) => d.closes.get(ticker));
    const trades = hits.reduce((s, h) => s + (h.trades || 0), 0);
    return {
        conclusive: true,
        sessions: janela.length,
        traded: hits.length,
        lastPrice: hits[0]?.close ?? null,
        avgTrades: hits.length ? Math.round(trades / hits.length) : 0,
    };
};

/** Frase pronta para a tela do script. */
export const b3Label = (a) => {
    if (!a.conclusive) return 'sem arquivo da B3 na janela — evidência indisponível';
    if (a.traded === 0) return `⛔ ZERO negócios em ${a.sessions} pregões da B3`;
    return `✅ negociou em ${a.traded}/${a.sessions} pregões · ~${a.avgTrades} negócios/dia · último R$ ${a.lastPrice}`;
};
