/**
 * Converte erros técnicos (mensagens de API, status HTTP, exceções de rede)
 * em frases compreensíveis para o usuário final em português.
 *
 * Uso:  catch (e) { addToast(friendlyError(e), 'error'); }
 */

const HTTP_MESSAGES: Record<number, string> = {
  400: 'Os dados informados são inválidos. Verifique os campos e tente novamente.',
  401: 'Sessão expirada. Faça login novamente.',
  403: 'Você não tem permissão para realizar esta ação.',
  404: 'O recurso solicitado não foi encontrado.',
  409: 'Já existe um registro com essas informações.',
  422: 'Não foi possível processar os dados. Verifique os campos.',
  429: 'Muitas tentativas em pouco tempo. Aguarde alguns instantes.',
  500: 'O servidor encontrou um problema. Tente novamente em alguns minutos.',
  502: 'O serviço está temporariamente indisponível. Tente novamente em breve.',
  503: 'Sistema em manutenção. Volte em alguns minutos.',
  504: 'A operação demorou demais para responder. Tente novamente.',
};

const PATTERN_MESSAGES: Array<[RegExp, string]> = [
  [/network\s*error|failed to fetch|net::err/i, 'Sem conexão com a internet. Verifique sua rede e tente novamente.'],
  [/timeout|timed?\s*out/i, 'A operação demorou demais. Tente novamente.'],
  [/email.*already|já.*cadastrado|duplicate.*email/i, 'Este e-mail já está cadastrado. Use outro ou faça login.'],
  [/senha.*incorret|password.*incorrect|invalid.*credent/i, 'E-mail ou senha incorretos. Verifique e tente novamente.'],
  [/token.*invalid|invalid.*token|jwt/i, 'Sua sessão expirou. Faça login novamente.'],
  [/cpf.*inválido|invalid.*cpf/i, 'CPF inválido. Verifique os dígitos.'],
  [/quota.*exceeded|limit.*exceeded/i, 'Limite de uso atingido. Aguarde antes de tentar novamente.'],
  [/not found/i, 'Nenhum resultado encontrado.'],
  [/unauthorized/i, 'Você não tem autorização para realizar esta ação.'],
  [/forbidden/i, 'Acesso negado.'],
];

const FALLBACK = 'Algo deu errado. Tente novamente ou contate o suporte.';

export function friendlyError(error: unknown): string {
  if (!error) return FALLBACK;

  // Objetos com status HTTP (axios, fetch-wrapper)
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const status = (e['status'] ?? e['statusCode']) as number | undefined;
    if (status && HTTP_MESSAGES[status]) return HTTP_MESSAGES[status];

    const resp = e['response'] as Record<string, unknown> | undefined;
    const respStatus = resp?.['status'] as number | undefined;
    if (respStatus && HTTP_MESSAGES[respStatus]) return HTTP_MESSAGES[respStatus];

    const respData = resp?.['data'] as Record<string, unknown> | undefined;
    const msg = (e['message'] ?? respData?.['message'] ?? '') as string;
    if (msg) return matchPattern(msg) ?? msg;
  }

  if (typeof error === 'string') return matchPattern(error) ?? error;
  if (error instanceof Error) return matchPattern(error.message) ?? error.message;

  return FALLBACK;
}

function matchPattern(msg: string): string | null {
  for (const [pattern, friendly] of PATTERN_MESSAGES) {
    if (pattern.test(msg)) return friendly;
  }
  return null;
}
