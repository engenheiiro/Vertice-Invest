// Conventional Commits — valida mensagens (feat:, fix:, chore:, docs:, etc.).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Permite subject capitalizado (mensagens em PT-BR começam com maiúscula, ex.: "Fase 2 ...").
    'subject-case': [0],
  },
};
