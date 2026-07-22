// Alguns controllers legados respondem diretamente a erros 5xx. Em produção,
// garante uma última barreira contra vazamento de mensagens, stack traces ou
// dados de provedores, mesmo quando o erro não passa pelo errorHandler.
export const productionErrorSanitizer = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (process.env.NODE_ENV === 'production' && res.statusCode >= 500) {
      const error = {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno no servidor.',
      };
      if (req.requestId) error.requestId = req.requestId;
      return originalJson({ message: error.message, error });
    }
    return originalJson(body);
  };

  next();
};

export default productionErrorSanitizer;
