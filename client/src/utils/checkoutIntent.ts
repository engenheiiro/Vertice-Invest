import { SELLABLE_PLANS, type BillingCycle } from '../constants/subscription';
import type { UserPlan } from '../contexts/AuthContext';

/**
 * A escolha de plano atravessando o cadastro.
 *
 * Quem chega pela busca escolhe "Pro anual", clica em assinar e descobre que
 * precisa de conta. Até aqui o caminho era: cadastro → login → carteira — e a
 * decisão que ele já tinha tomado se perdia no meio. Voltar à vitrine e escolher
 * de novo é atrito posto exatamente no ponto mais caro do funil.
 *
 * A intenção viaja em `sessionStorage`, não na URL: ela precisa sobreviver a
 * três navegações (cadastro, login, redirecionamento) e um parâmetro perdido em
 * qualquer uma delas quebraria a corrente em silêncio. Some ao fechar a aba, que
 * é o tempo de vida certo para "o que eu ia comprar agora".
 */

const KEY = 'vertice_checkout_intent';

export type CheckoutIntent = { plan: UserPlan; cycle: BillingCycle };

/**
 * Leitura FECHADA: `sessionStorage` é escrito pelo navegador, e o que sai daqui
 * vai indexar tabela de preço e virar chave de checkout. Plano fora da lista de
 * venda — inclusive um aposentado deixado para trás — é descartado, não corrigido.
 */
export const readCheckoutIntent = (): CheckoutIntent | null => {
    try {
        const bruto = sessionStorage.getItem(KEY);
        if (!bruto) return null;

        const { plan, cycle } = JSON.parse(bruto) as Partial<CheckoutIntent>;
        if (!plan || !SELLABLE_PLANS.includes(plan)) return null;
        if (cycle !== 'MONTHLY' && cycle !== 'ANNUAL') return null;

        return { plan, cycle };
    } catch {
        return null;
    }
};

export const saveCheckoutIntent = (intent: CheckoutIntent) => {
    if (!SELLABLE_PLANS.includes(intent.plan)) return;
    try {
        sessionStorage.setItem(KEY, JSON.stringify(intent));
    } catch {
        // Storage bloqueado: o visitante segue para o cadastro sem a lembrança.
        // Perder a comodidade é aceitável; travar o cadastro não é.
    }
};

/** Chamada quando a intenção é consumida (checkout iniciado), quando o usuário
 *  desiste dela e no logout — para não oferecer a compra de alguém a outra
 *  pessoa que entre na mesma aba. */
export const clearCheckoutIntent = () => {
    try { sessionStorage.removeItem(KEY); } catch { /* nada a limpar */ }
};
