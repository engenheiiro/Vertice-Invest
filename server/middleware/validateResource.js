const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Devolve à requisição o que o schema PRODUZIU (trim, toLowerCase, coerce de
// número, defaults). Antes o resultado do parse era descartado: o controller
// recebia o corpo cru e toda normalização declarada nos schemas era só promessa.
//
// Mescla em vez de substituir: `z.object` remove chaves não declaradas, e há
// rotas cujo handler (ou middleware anterior, como o resolveWallet) lê campos
// que o schema não lista. Substituir quebraria esses fluxos em silêncio.
const applyParsed = (original, parsed) => {
  if (parsed === undefined) return original;
  if (isPlainObject(original) && isPlainObject(parsed)) return { ...original, ...parsed };
  return parsed;
};

const validate = (schema) => (req, res, next) => {
  let result;
  try {
    result = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
  } catch (e) {
    // Retorna o primeiro erro encontrado de forma amigável
    const errorMessage = e.errors && e.errors.length > 0
      ? e.errors[0].message
      : 'Dados inválidos';

    return res.status(400).json({ message: errorMessage });
  }

  if (isPlainObject(result)) {
    if ('body' in result) req.body = applyParsed(req.body, result.body);
    if ('query' in result) req.query = applyParsed(req.query, result.query);
    if ('params' in result) req.params = applyParsed(req.params, result.params);
  }
  next();
};

export default validate;
