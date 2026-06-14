/**
 * Valida CPF pelo algoritmo Módulo 11.
 * Retorna false para sequências triviais (ex: 111.111.111-11).
 */
export const validateCpf = (cpf) => {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;

  let add = 0;
  for (let i = 0; i < 9; i++) add += parseInt(digits[i]) * (10 - i);
  let rev = 11 - (add % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(digits[9])) return false;

  add = 0;
  for (let i = 0; i < 10; i++) add += parseInt(digits[i]) * (11 - i);
  rev = 11 - (add % 11);
  if (rev >= 10) rev = 0;
  return rev === parseInt(digits[10]);
};
