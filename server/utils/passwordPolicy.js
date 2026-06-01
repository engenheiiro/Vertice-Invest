/**
 * Política de senha compartilhada (S6).
 * Centraliza a regra antes duplicada em register/reset/change do authController:
 * mínimo 8 caracteres, com minúscula, maiúscula e dígito — agora também rejeita
 * senhas comuns/previsíveis.
 */

// Lista (lowercase) das senhas mais vazadas/previsíveis. Comparação case-insensitive,
// então variações como "Senha123" também são bloqueadas via toLowerCase().
export const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'senha123', 'senha1234', 'qwerty123', 'qwertyuiop', '12345678a', 'abcd1234',
  'iloveyou', 'admin123', 'administrator', '000000000', 'aaaaaaaa', '11111111',
  '1q2w3e4r', '1qaz2wsx', 'senhasenha', 'mudar123', 'trocar123', 'brasil123',
  'vertice123', 'invest123', 'football1', 'baseball1', 'sunshine1',
]);

const COMPLEXITY = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const GENERIC_MSG = 'Senha deve ter no mínimo 8 caracteres, uma letra maiúscula e um número.';

/**
 * Valida a força da senha. Retorna a mensagem de erro (string) se inválida,
 * ou `null` se a senha for aceitável.
 */
export const getPasswordError = (password) => {
  if (!password || password.length < 8 || !COMPLEXITY.test(password)) {
    return GENERIC_MSG;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Senha muito comum ou previsível. Escolha uma combinação mais forte.';
  }
  return null;
};

/** Conveniência booleana para uso em validadores (ex.: Zod refine). */
export const isStrongPassword = (password) => getPasswordError(password) === null;
