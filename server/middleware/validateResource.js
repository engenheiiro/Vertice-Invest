const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  } catch (e) {
    // Retorna o primeiro erro encontrado de forma amigável
    const errorMessage = e.errors && e.errors.length > 0 
      ? e.errors[0].message 
      : 'Dados inválidos';
      
    return res.status(400).json({ message: errorMessage });
  }
};

export default validate;