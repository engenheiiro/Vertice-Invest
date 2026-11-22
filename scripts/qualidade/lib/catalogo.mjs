/**
 * Catálogo das métricas da catraca. Cada entrada diz COMO o número é julgado;
 * o valor-limite de cada uma mora em docs/metricas.json.
 *
 * tipo:
 *   max   — número que só desce (limite = teto)
 *   min   — número que só sobe (limite = piso; `passo` arredonda o piso para baixo)
 *   mapa  — { item: número } com teto por item; item novo usa `padrao` como teto
 *   lista — conjunto permitido; item novo reprova, item que sai aperta a lista
 *   info  — só informa (aparece no placar, nunca reprova)
 * fixo:   o limite não acompanha a medição (regra absoluta, ex.: zero `.only`)
 * folga:  o limite é a medição × folga (bundle: +10%)
 * modo:   'sempre' (check rápido e completo) ou 'completo' (só no completo)
 */

export const AREAS_SERVER = [
  'config', 'controllers', 'middleware', 'models', 'routes', 'schemas',
  'services', 'services/engines', 'utils',
];
export const AREAS_CLIENT = [
  'src/components', 'src/contexts', 'src/hooks', 'src/pages', 'src/services', 'src/utils',
];

const m = (chave, tipo, descricao, quem, extra = {}) => ({ chave, tipo, descricao, quem, modo: 'sempre', ...extra });
const zero = { fixo: true, limiteFixo: 0 };

const cobertura = (parte, area) => m(
  `cobertura.${parte}.${area.replace('src/', '')}`, 'min',
  `Cobertura de linhas — ${parte}/${area} (%)`, 'metricas (testes com cobertura)', { passo: 0.5 },
);

export const CATALOGO = [
  ...AREAS_SERVER.map((a) => cobertura('server', a)),
  ...AREAS_CLIENT.map((a) => cobertura('client', a)),
  m('testes.server', 'min', 'Casos de teste do server', 'metricas'),
  m('testes.client', 'min', 'Casos de teste do client', 'metricas'),
  m('tempo.testes.server', 'max', 'Suíte do server com cobertura (s)', 'check', { fixo: true, limiteFixo: 60 }),
  m('tempo.testes.client', 'max', 'Suíte do client com cobertura (s)', 'check', { fixo: true, limiteFixo: 60 }),
  m('arquivosGrandes', 'mapa', 'Arquivos acima de 600 linhas (teto = tamanho de hoje)', 'metricas', { padrao: 600 }),
  m('linhasLongas', 'max', 'Linhas com mais de 160 caracteres', 'metricas'),
  m('eslintDisable', 'max', 'Supressões eslint-disable', 'metricas'),
  m('eslintDisableSemMotivo', 'max', 'eslint-disable sem "-- motivo" na linha', 'metricas'),
  m('asAny', 'max', 'Ocorrências de "as any" (TS)', 'metricas'),
  m('tsDiretivas', 'max', 'Diretivas de supressão do TypeScript (ignore / expect-error / nocheck)', 'metricas', zero),
  m('naoNulo', 'max', 'Asserções de não-nulo "x!" (TS)', 'metricas'),
  m('focoEmTeste', 'max', 'Testes com .only / fit / fdescribe', 'metricas', zero),
  m('testesComData', 'lista', 'Arquivos de teste que leem o relógio sem fixá-lo', 'metricas'),
  m('testesEmQuarentena', 'info', 'Testes pulados em quarentena (0 no fim da semana)', 'fechar'),
  m('quarentenaIrregular', 'max', 'Teste pulado sem data, vencido ou com prazo > 7 dias', 'metricas', zero),
  m('cssSemUso', 'lista', 'Classes do CSS próprio sem uso', 'metricas'),
  m('imgSemSrcset', 'max', '<img> sem srcSet', 'metricas'),
  m('bundleGzipKB', 'max', 'Bundle do client, JS+CSS com gzip (KB)', 'metricas (build)', { folga: 1.1 }),
  m('lint.erros', 'max', 'Erros do ESLint', 'lint', zero),
  m('lint.avisos', 'max', 'Avisos do ESLint (fora a11y e complexidade)', 'lint'),
  m('lint.a11y', 'max', 'Avisos de acessibilidade (jsx-a11y)', 'lint'),
  m('complexidade', 'mapa', 'Funções com complexidade > 15, por arquivo', 'lint', { padrao: 0 }),
  m('complexidadeMax', 'max', 'Maior complexidade ciclomática de uma função', 'lint'),
  m('duplicacaoPct', 'max', 'Linhas duplicadas (%) — jscpd', 'check completo', { modo: 'completo' }),
  m('codigoMorto', 'lista', 'Arquivos/exports sem uso de produção', 'metricas'),
  m('vulnAltas', 'max', 'Vulnerabilidades altas/críticas (npm audit)', 'check completo', { ...zero, modo: 'completo' }),
  m('depsMajorAtras', 'max', 'Dependências mais de uma versão maior atrás', 'check completo', { modo: 'completo' }),
  m('depsSemUso', 'max', 'Dependências declaradas sem uso', 'metricas', zero),
  m('segredos', 'max', 'Segredos aparentes em arquivos versionados', 'metricas + pre-commit', zero),
  m('foraStrict', 'max', 'Arquivos TS fora do modo strict', 'metricas', zero),
  m('marcadoresSemDono', 'max', 'TODO/FIXME sem (dono, AAAA-MM-DD)', 'metricas', zero),
];

export const POR_CHAVE = new Map(CATALOGO.map((d) => [d.chave, d]));
