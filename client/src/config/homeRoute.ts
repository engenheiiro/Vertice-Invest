// ---------------------------------------------------------------------------
// Rota "casa" do app autenticado.
//
// A casa é a CARTEIRA. O Terminal continua existindo, continua no menu e continua
// em /dashboard — o que mudou é qual página o usuário encontra quando entra sem
// pedir destino: login, clique na logo, saída de uma área restrita. A Carteira é a
// única tela que fala do dinheiro DELE; o Terminal fala do mercado, que ele
// consulta quando quiser.
//
// As constantes existem para que "onde é a casa" seja UMA decisão, e não uma
// string repetida em oito arquivos que saem de sincronia no dia em que ela mudar.
// ---------------------------------------------------------------------------

export const HOME_ROUTE = '/wallet';

/** Onde o Terminal mora. Também onde o tour de boas-vindas começa. */
export const TERMINAL_ROUTE = '/dashboard';

/**
 * Destino de entrada de um usuário.
 *
 * Exceção ÚNICA: no primeiro acesso o destino é o Terminal, porque é lá que o tour
 * de boas-vindas nasce — o `DemoContext` só o dispara em /dashboard e os passos
 * iniciais apontam para elementos que só existem naquela página. O tour termina na
 * Carteira, então o usuário chega na casa dele de qualquer forma. Mandar o usuário
 * novo direto para a casa mataria o onboarding em silêncio.
 */
export const homeRouteFor = (user?: { hasSeenTutorial?: boolean } | null): string =>
    user?.hasSeenTutorial === false ? TERMINAL_ROUTE : HOME_ROUTE;
