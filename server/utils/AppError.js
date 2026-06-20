/**
 * (6.1) Erro de aplicação estruturado.
 *
 * Padroniza os erros lançados por controllers/serviços com um trio:
 *   - status:  código HTTP (ex.: 400, 404, 500)
 *   - code:    string legível por máquina (ex.: 'BAD_REQUEST') — o cliente pode
 *              ramificar comportamento sem depender da mensagem traduzida.
 *   - message: texto legível por humano (exibido ao usuário).
 * E um `details` opcional para contexto extra (campos inválidos, ids, etc.).
 *
 * O error handler global (middleware/errorHandler.js) entende esses campos e
 * monta uma resposta JSON consistente. Erros "comuns" (new Error, Mongoose,
 * JWT) continuam funcionando: o handler infere status/code a partir deles.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code || AppError.codeForStatus(status);
    this.details = details;
    // Marca que a mensagem foi escrita para o usuário (não vazamento acidental).
    this.isOperational = true;
  }

  static codeForStatus(status) {
    return STATUS_CODE[status] || 'INTERNAL_ERROR';
  }
}

/** Mapa status HTTP → code padrão legível por máquina. */
export const STATUS_CODE = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

// Atalhos de conveniência para os status mais frequentes.
AppError.badRequest = (message, details) => new AppError(message, { status: 400, details });
AppError.unauthorized = (message = 'Não autenticado.', details) => new AppError(message, { status: 401, details });
AppError.forbidden = (message = 'Acesso negado.', details) => new AppError(message, { status: 403, details });
AppError.notFound = (message = 'Recurso não encontrado.', details) => new AppError(message, { status: 404, details });
AppError.conflict = (message, details) => new AppError(message, { status: 409, details });

export default AppError;
