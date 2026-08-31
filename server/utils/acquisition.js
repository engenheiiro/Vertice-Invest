/**
 * Origem da conta — saneamento da única entrada de funil que vem do cliente.
 *
 * O visitante chega com `?utm_source=youtube` na URL e o navegador informa o
 * referenciador. Isso é dado do NAVEGADOR, ou seja: escrito por quem quiser,
 * inclusive por um link montado de propósito. Ele entra no banco e depois é
 * exibido no painel admin e agrupado em relatório — então precisa entrar
 * podado, e não como o cliente mandou.
 *
 * Três limites, todos deliberados:
 *  - conjunto FIXO de campos (nada de objeto aberto virando documento);
 *  - alfabeto restrito, que exclui quebra de linha (linha de log forjada) e
 *    sinais de marcação;
 *  - comprimento curto, porque campanha legítima não tem 400 caracteres.
 *
 * O caminho de origem é gravado sem query string de propósito: `?token=`,
 * `?email=` e afins passeiam por links de divulgação e virariam dado pessoal
 * guardado para sempre num campo de marketing.
 */

const MAX_LEN = 80;
const MAX_PATH_LEN = 120;

/** Letras, números e a pontuação que campanhas de verdade usam. Fora daqui,
 *  vira '-': o objetivo é agrupar origem, não preservar o texto do atacante. */
const limpar = (valor, max) => {
    if (typeof valor !== 'string') return undefined;
    const podado = valor
        .trim()
        .slice(0, max)
        .replace(/[^\w\s./:@+-]/gu, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return podado || undefined;
};

const minusculo = (valor) => {
    const limpo = limpar(valor, MAX_LEN);
    return limpo ? limpo.toLowerCase() : undefined;
};

/** Só o host do referenciador: a URL inteira carrega caminho e query de outro
 *  site, que não nos dizem nada de útil e podem carregar dado de terceiro. */
const hostDoReferrer = (valor) => {
    if (typeof valor !== 'string' || !valor.trim()) return undefined;
    try {
        return minusculo(new URL(valor).hostname);
    } catch {
        // Já veio como host puro (ou como lixo) — o saneamento comum resolve.
        return minusculo(valor);
    }
};

const caminho = (valor) => {
    if (typeof valor !== 'string' || !valor.startsWith('/')) return undefined;
    return limpar(valor.split('?')[0].split('#')[0], MAX_PATH_LEN);
};

/**
 * @returns {object|undefined} documento pronto para gravar, ou `undefined`
 *          quando não sobrou nenhum campo aproveitável — campo ausente é mais
 *          honesto que um objeto de origem vazio em toda conta.
 */
export const sanitizeAcquisition = (bruto) => {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return undefined;

    const limpo = {
        source: minusculo(bruto.source),
        medium: minusculo(bruto.medium),
        campaign: minusculo(bruto.campaign),
        referrerHost: hostDoReferrer(bruto.referrer ?? bruto.referrerHost),
        landingPath: caminho(bruto.landingPath),
    };

    const preenchidos = Object.entries(limpo).filter(([, v]) => v !== undefined);
    if (preenchidos.length === 0) return undefined;

    return { ...Object.fromEntries(preenchidos), capturedAt: new Date() };
};
