// Mensagem de commit em português, no formato "Área: o que mudou".
//   Carteira: corrige provento no dia-ex
//   Qualidade: adiciona catraca de métricas
// A área vem de uma lista fixa (abaixo) para o histórico continuar pesquisável
// por assunto. Área nova entra aqui, num commit "Qualidade: ...".
export const AREAS = [
  'Carteira', 'Pesquisa', 'Sinais', 'Macro', 'Sync', 'Suporte', 'Auth',
  'Pagamento', 'Admin', 'Infra', 'Qualidade', 'Docs', 'Deps', 'Tela', 'Academy',
];

export default {
  parserPreset: {
    parserOpts: {
      // "Área: assunto" → type = Área, subject = assunto. Sem escopo entre parênteses.
      headerPattern: /^([A-ZÀ-Ú][\wÀ-ú]*): (.+)$/u,
      headerCorrespondence: ['type', 'subject'],
    },
  },
  rules: {
    'header-max-length': [2, 'always', 100],
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', AREAS],
    'type-case': [0],
    'subject-empty': [2, 'never'],
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'body-leading-blank': [1, 'always'],
  },
};
