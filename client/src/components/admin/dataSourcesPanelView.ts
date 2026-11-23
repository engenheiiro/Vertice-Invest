import type React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldCheck, XCircle } from 'lucide-react';
import type { ChainFlow, DataSource, SourceStatus } from '../../services/health';

/**
 * Regras puras do painel "De onde vêm os dados": paleta, rótulo curto do rodapé,
 * relógios e a leitura do trajeto por ativo.
 *
 * O SERVIDOR decide os estados (status, `idleReason`, vocabulário da cadeia). Nada
 * aqui rededuz estado: só escolhe a palavra curta e a cor de um estado já decidido.
 */

/**
 * A paleta dos cards, e por que ela é o que é.
 *
 * Todo estado com NOTÍCIA tem tom próprio — borda tingida, fundo lavado na mesma
 * cor, hover que acende a borda. "Recebendo" ficava fora dessa receita: só o ponto
 * e o rótulo eram verdes, o card em si era cinza neutro. Ao lado da reserva em
 * azul, a fonte que está de fato sustentando o dado parecia a mais apagada da
 * tela — exatamente o contrário do que ela é.
 *
 * O PESO é que separa: verde e azul são lavados (fundo /10, sem anel); amarelo e
 * vermelho vêm com fundo mais forte e anel. Se tudo pesasse igual, a cor deixaria
 * de fazer triagem numa grade de quinze cards — que é a razão de a grade existir.
 *
 * O único estado sem cor é o `UNKNOWN` agendado: a fonte que ainda não teve a vez.
 * Ausência de notícia não é notícia, e cinza é o que diz isso. A reserva parada não
 * cai aqui — ela tem cor própria (ver STANDBY_UI).
 */
const STATUS_UI: Record<SourceStatus, {
    dot: string; text: string; label: string; card: string; band: string; Icon: React.ElementType;
}> = {
    OK: {
        dot: 'bg-emerald-500',
        text: 'text-emerald-400',
        label: 'Recebendo',
        card: 'border-emerald-900/50 bg-emerald-900/10 hover:border-emerald-800',
        band: 'border-emerald-900/50 bg-emerald-900/10',
        Icon: CheckCircle2,
    },
    WARN: {
        dot: 'bg-yellow-500',
        text: 'text-yellow-400',
        label: 'Instável',
        card: 'border-yellow-800/60 bg-yellow-900/20 ring-1 ring-yellow-900/30 hover:border-yellow-700',
        band: 'border-yellow-900/50 bg-yellow-900/10',
        Icon: AlertTriangle,
    },
    CRITICAL: {
        dot: 'bg-red-500',
        text: 'text-red-400',
        label: 'Sem receber',
        card: 'border-red-800/60 bg-red-900/20 ring-1 ring-red-900/40 hover:border-red-700',
        band: 'border-red-900/50 bg-red-900/10',
        Icon: XCircle,
    },
    UNKNOWN: {
        dot: 'bg-slate-600',
        text: 'text-slate-500',
        label: 'Aguardando',
        card: 'border-slate-800/70 bg-panel/50 hover:border-slate-700',
        band: 'border-slate-800 bg-base',
        Icon: HelpCircle,
    },
};

/**
 * A RESERVA EM ESPERA TEM COR PRÓPRIA.
 *
 * Ela caía no mesmo cinza de `UNKNOWN` da fonte agendada que ainda não teve a vez,
 * e os dois estados não são a mesma coisa: a agendada é uma pendência (tem hora
 * marcada e ainda não cumpriu), enquanto a reserva parada é o SISTEMA FUNCIONANDO —
 * ninguém precisou dela. Cinza lê como apagado, quase defeito; azul lê como
 * "em posição, sem nada a fazer", que é o que de fato está acontecendo.
 *
 * Azul e não verde de propósito: verde é o "recebendo" de quem está entregando
 * AGORA, e usar o mesmo tom apagaria a diferença entre a fonte que sustenta o dado
 * e a que só está de prontidão.
 */
const STANDBY_UI = {
    dot: 'bg-blue-500',
    text: 'text-blue-400',
    label: 'Em espera',
    card: 'border-blue-900/50 bg-blue-900/10 hover:border-blue-800',
    band: 'border-blue-900/50 bg-blue-900/10',
    Icon: ShieldCheck,
};

/** Reserva que ninguém precisou acionar ≠ fonte sem notícia. Ver STANDBY_UI. */
const isStandby = (source: DataSource) => source.status === 'UNKNOWN' && source.trigger === 'onFailure';

/**
 * Reserva que FOI chamada, e só para ativo que ninguém precificou.
 *
 * Mesma cor da reserva em espera (nada aqui é problema da fonte), rótulo
 * diferente: dizer "Em espera" a quem acabou de ser chamada três vezes é uma
 * mentira pequena que corrói a confiança no painel inteiro. O servidor já decidiu
 * o ESTADO e escreveu a frase em `detail`; aqui só se escolhe o rótulo curto do
 * rodapé, que é onde o card não tem espaço para a frase.
 */
const isSemAlvoVivo = (source: DataSource) =>
    // `idleReason` é a decisão do SERVIDOR, e ela manda. A regra local abaixo é
    // fallback para um servidor mais antigo que o cliente — e ela é frouxa de
    // propósito conhecido: checa só `reached > 0`, enquanto a regra de verdade
    // exige que ninguém tenha resolvido aquele assunto. Foi essa folga que fez o
    // card da PTAX dizer "Sem alvo vivo" no feriado de 07/09/2026 enquanto o
    // modal, com a frase do servidor, dizia "não foi chamada: feriado".
    (source.idleReason
        ? source.idleReason === 'NO_LIVE_SUBJECT'
        : isStandby(source) && (source.escalated?.reached ?? 0) > 0);

export const visualFor = (source: DataSource) => (isStandby(source) ? STANDBY_UI : STATUS_UI[source.status]);

/**
 * Relógio do rodapé do card, na ordem de quem responde melhor à pergunta "esta
 * fonte está viva?": a entrega, quando ela é medível; a última resposta, quando
 * não é (Yahoo de cotações não deixa carimbo por fonte no MarketAsset).
 *
 * Não é o mesmo que trocar um pelo outro no servidor — lá os dois são campos
 * distintos, e o detalhe da fonte nomeia qual está mostrando. Aqui, no espaço de
 * um card, o que importa é não deixar o canto vazio quando há informação.
 */
const clockHours = (source: DataSource): number | null =>
    source.lastDeliveryHours ?? source.lastResponseHours ?? null;

/**
 * O rodapé do card responde "e agora?" — e a resposta depende da natureza da
 * fonte, não só do estado dela.
 *
 * Cinza escondia duas coisas opostas: a fonte agendada que ainda não teve a vez
 * (pendência, com hora marcada) e a de reserva, que só é chamada quando a
 * anterior falha (silêncio ali é o sistema funcionando). Sem separar, "que horas
 * isso roda?" não tinha resposta — e metade dos cards nem tem horário para dar.
 */
export const footerInfo = (source: DataSource): { label: string; time: string } => {
    if (source.status !== 'UNKNOWN') {
        return { label: STATUS_UI[source.status].label, time: sinceLabel(clockHours(source)) };
    }
    if (source.idleReason === 'SKIPPED') {
        // Não é "em espera" nem "aguardando": ninguém vai chamá-la hoje, e dizer
        // que ela espera a vez sugere que o silêncio se resolve sozinho.
        return { label: 'Não chamada hoje', time: 'por decisão nossa' };
    }
    if (isSemAlvoVivo(source)) {
        return { label: 'Sem alvo vivo', time: 'reserva' };
    }
    if (isStandby(source)) {
        return { label: STANDBY_UI.label, time: 'reserva' };
    }
    return { label: 'Aguardando', time: source.nextRun ?? '—' };
};

/**
 * Palavras da cadeia, quando ela não veio no payload.
 *
 * Só entra em cena entre um deploy do cliente e um do servidor. Fala de "assunto"
 * de propósito: um default que dissesse "ativo" mentiria no bloco do câmbio, e
 * palavra genérica é melhor que palavra errada.
 */
export const VOCAB_PADRAO = {
    noun: 'assunto',
    none: 'Nenhum assunto',
    escalatedLine: 'precisaram de reserva',
    escalatedNone: 'precisou de reserva',
    escalatedTitle: 'Quem precisou de reserva',
    backupOf: 'Esta é reserva de',
    skippedLine: 'passaram pela cadeia sem que esta fonte fosse consultada',
    rescued: 'foram resolvidos por esta fonte',
    allFromPrimary: 'esta fonte resolveu todos',
    missingBadge: 'sem dado',
    missingLong: 'sem dado em nenhuma',
    expectedBadge: 'esperado',
    expectedLong: 'ausência esperada',
};

export type ChainVocab = ChainFlow['vocabulary'];

/** "Ativos", "Moedas" — o substantivo da cadeia em início de frase. */
export const capitalizar = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * "há 7h" — a idade da escalada mais recente da cadeia.
 *
 * Calculada no cliente, e é o único lugar do painel onde isso acontece: a idade
 * dos cards vem pronta do servidor. Aqui o dado transportado é o instante, e a
 * diferença entre o relógio do navegador e o do host não muda nada numa régua
 * que arredonda para minutos e horas.
 */
export const agoLabel = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return sinceLabel((Date.now() - d.getTime()) / 3600000);
};

export const sinceLabel = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 0.02) return 'agora';
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
};

/** "1ª", "2ª"… O ordinal só existe dentro de uma cadeia; fora dela não há ordem. */
export const ORDINAL = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'];

/** Data e hora absolutas, no fuso de quem lê. Relativo sozinho ("há 3h") perde o dia. */
export const absoluteTime = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
};

/** Data curta com hora — o ledger vive no processo, então o dia raramente varia. */
export const shortTime = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Fonte sem ninguém atrás e sem ser reserva de ninguém: ponto único de falha. */
export const hasNoBackup = (source: DataSource) => (source.backups?.length ?? 0) === 0 && !source.covers;

/**
 * Três destinos possíveis para quem passou por esta fonte, e eles se leem por
 * LINHA do ledger, não pelo estado geral da fonte: a mesma Brapi salva um ticker
 * e falha no seguinte no mesmo minuto.
 *
 * Quem a rotina decidiu não consultar não "passou" por lugar nenhum: listar o
 * ativo aqui faria a fonte responder por uma chamada que nunca recebeu.
 */
export const chainPassage = (source: DataSource, flow?: ChainFlow) => {
    const passaram = (flow?.items ?? []).filter(
        (i) => i.tried.includes(source.id) && !(i.skipped ?? []).includes(source.id),
    );
    return {
        salvos: passaram.filter((i) => i.resolvedBy === source.id).map((i) => i.subject),
        seguiram: passaram.filter((i) => i.resolvedBy && i.resolvedBy !== source.id).map((i) => i.subject),
        semPreco: passaram.filter((i) => !i.resolvedBy).map((i) => i.subject),
    };
};

/**
 * A frase de quando NENHUM assunto chegou até a fonte.
 *
 * TRÊS silêncios, não um. "Não fui chamada" é o estado normal desta fonte de
 * terça a sexta, e dizer no lugar dele "resolveu todos" contradiz, na mesma tela,
 * a linha que acabou de contar mil ativos sem fechamento na série.
 *
 * `naoPerguntados` é contado no servidor sobre o ledger INTEIRO, não sobre a
 * amostra que veio para a tela: é afirmação de quantidade, e amostra não sustenta.
 */
export const quietPassageText = (source: DataSource, vocab: ChainVocab, naoPerguntados: number) => {
    if (naoPerguntados > 0) {
        return `${naoPerguntados} ${vocab.noun}(s) ${vocab.skippedLine ?? VOCAB_PADRAO.skippedLine}.`;
    }
    if (source.chainPosition === 1) {
        return `${vocab.none} ${vocab.escalatedNone ?? VOCAB_PADRAO.escalatedNone}: ${vocab.allFromPrimary}.`;
    }
    return `${vocab.none} chegou até aqui — a fonte anterior deu conta de todos.`;
};

/** O que vem depois do número de quem chegou: na 1ª da cadeia, "desceram"; nas outras, o balanço. */
export const reachedPassageText = (
    source: DataSource,
    vocab: ChainVocab,
    escalated: { rescued: number; missed: number },
) => (source.chainPosition === 1
    ? ` ${vocab.noun}(s) ficaram ${vocab.missingBadge} aqui e desceram para a reserva`
    : ` ${vocab.noun}(s) chegaram até aqui · ${escalated.rescued} ${vocab.rescued} · ${escalated.missed} não`);
