# Medições

Placar da catraca de qualidade. Os limites vivem em `docs/metricas.json`; as
regras, no `CLAUDE.md` (seção "Qualidade: portão e catraca").

- `npm run metricas`: mostra o placar e reprova se algo piorou.
- `npm run metricas -- --apertar`: trava os ganhos e grava a coluna do dia aqui.
- `npm run metricas -- --registrar`: só grava a coluna do dia, sem mexer nos limites.

A primeira coluna (22/11/2026) é a base: **o limite inicial de cada métrica é o
valor medido nesse dia**, não uma meta. Regras absolutas (zero `.only`, zero
segredo, zero erro de lint, suíte abaixo de 60 s etc.) têm limite fixo.

Os números vêm do check completo (`npm run check`). Mapas e listas, como
arquivos grandes, complexidade por arquivo e testes com data, aparecem aqui
como contagem. O detalhe item a item está em `docs/metricas.json`.

## Placar

<!-- placar:inicio (gerado por npm run metricas -- --registrar; não edite à mão) -->
| Métrica | Limite | 2026-11-22 | 2026-11-23 |
|---|---|---|---|
| `cobertura.server.config` — Cobertura de linhas — server/config (%) | 90 | 90.2 | 90.2 |
| `cobertura.server.controllers` — Cobertura de linhas — server/controllers (%) | 71.5 | 71.7 | 71.8 |
| `cobertura.server.middleware` — Cobertura de linhas — server/middleware (%) | 93.5 | 93.9 | 93.9 |
| `cobertura.server.models` — Cobertura de linhas — server/models (%) | 91 | 91.3 | 91.3 |
| `cobertura.server.routes` — Cobertura de linhas — server/routes (%) | 81.5 | 81.6 | 81.6 |
| `cobertura.server.schemas` — Cobertura de linhas — server/schemas (%) | 94 | 94.2 | 94.2 |
| `cobertura.server.services` — Cobertura de linhas — server/services (%) | 76.5 | 76.5 | 76.9 |
| `cobertura.server.services/engines` — Cobertura de linhas — server/services/engines (%) | 93.5 | 93.7 | 93.7 |
| `cobertura.server.utils` — Cobertura de linhas — server/utils (%) | 96 | 96.4 | 96.4 |
| `cobertura.client.components` — Cobertura de linhas — client/src/components (%) | 82.5 | 82.4 | 82.9 |
| `cobertura.client.contexts` — Cobertura de linhas — client/src/contexts (%) | 97 | 97.4 | 97.4 |
| `cobertura.client.hooks` — Cobertura de linhas — client/src/hooks (%) | 100 | 100 | 100 |
| `cobertura.client.pages` — Cobertura de linhas — client/src/pages (%) | 89 | 89.3 | 89.3 |
| `cobertura.client.services` — Cobertura de linhas — client/src/services (%) | 87 | 87.1 | 87.1 |
| `cobertura.client.utils` — Cobertura de linhas — client/src/utils (%) | 89 | 89.1 | 89.1 |
| `testes.server` — Casos de teste do server | 3422 | 3404 | 3422 |
| `testes.client` — Casos de teste do client | 2140 | 2110 | 2140 |
| `tempo.testes.server` — Suíte do server com cobertura (s) | 60 | 36 | 45.5 |
| `tempo.testes.client` — Suíte do client com cobertura (s) | 60 | 44.8 | 54.9 |
| `arquivosGrandes` — Arquivos acima de 600 linhas (teto = tamanho de hoje) | 36 | 37 | 36 |
| `linhasLongas` — Linhas com mais de 160 caracteres | 1059 | 1079 | 1059 |
| `eslintDisable` — Regras do ESLint desligadas por comentário | 14 | 14 | 14 |
| `eslintDisableSemMotivo` — Regra do ESLint desligada sem "-- motivo" na linha | 0 | 0 | 0 |
| `asAny` — Ocorrências de "as any" (TS) | 145 | 145 | 145 |
| `tsDiretivas` — Diretivas de supressão do TypeScript (ignore / expect-error / nocheck) | 0 | 0 | 0 |
| `naoNulo` — Asserções de não-nulo "x!" (TS) | 49 | 49 | 49 |
| `focoEmTeste` — Testes com .only / fit / fdescribe | 0 | 0 | 0 |
| `testesComData` — Arquivos de teste que leem o relógio sem fixá-lo | 0 | 0 | 0 |
| `testesEmQuarentena` — Testes pulados em quarentena (0 no fim da semana) | info | 0 | 0 |
| `quarentenaIrregular` — Teste pulado sem data, vencido ou com prazo > 7 dias | 0 | 0 | 0 |
| `cssSemUso` — Classes do CSS próprio sem uso | 9 | 9 | 9 |
| `imgSemSrcset` — <img> sem srcSet | 23 | 23 | 23 |
| `bundleGzipKB` — Bundle do client, JS+CSS com gzip (KB) | 747 | 705 | 706 |
| `lint.erros` — Erros do ESLint | 0 | 0 | 0 |
| `lint.avisos` — Avisos do ESLint (fora a11y e complexidade) | 11 | 13 | 11 |
| `lint.a11y` — Avisos de acessibilidade (jsx-a11y) | 0 | 0 | 0 |
| `complexidade` — Funções com complexidade > 15, por arquivo | 103 | 105 | 103 |
| `complexidadeMax` — Maior complexidade ciclomática de uma função | 44 | 45 | 44 |
| `duplicacaoPct` — Linhas duplicadas (%) — jscpd | 0.47 | 0.49 | 0.47 |
| `codigoMorto` — Arquivos/exports sem uso de produção | 0 | 0 | 0 |
| `vulnAltas` — Vulnerabilidades altas/críticas (npm audit) | 0 | 0 | 0 |
| `depsMajorAtras` — Dependências mais de uma versão maior atrás | 0 | 0 | 0 |
| `depsSemUso` — Dependências declaradas sem uso | 0 | 0 | 0 |
| `segredos` — Segredos aparentes em arquivos versionados | 0 | 0 | 0 |
| `foraStrict` — Arquivos TS fora do modo strict | 0 | 0 | 0 |
| `marcadoresSemDono` — TODO/FIXME sem (dono, AAAA-MM-DD) | 0 | 0 | 0 |
<!-- placar:fim -->

## Afrouxamentos

Um limite só afrouxa com o motivo escrito aqui, numa linha que cite a chave da
métrica entre crases, como `` `linhasLongas` ``. O `npm run metricas` compara a
base com a versão publicada (`@{u}`) e reprova o afrouxamento que não tiver
linha nesta seção.

Formato: `- AAAA-MM-DD` seguido de `` `chave` ``, do que mudou e do porquê.

- 2026-11-22 `complexidade`: o `walletController.js` (8 funções acima de 15)
  foi dividido em seis módulos, só movendo código. As mesmas 8 funções foram
  para os módulos novos: walletTransactionsController 3,
  walletPerformanceController 2, walletKpis 1, walletPayload 1 e
  walletAssetProcessor 1. O walletController.js caiu para 0. O total não
  mudou: é redistribuição, não piora. Mover código não reduz complexidade;
  baixar essas 8 é trabalho à parte.
- 2026-11-23 `duplicacaoPct`: 0,49 → 0,5. O 0,49 foi travado a partir de uma
  medição local (Windows, cópia de trabalho em CRLF); o CI (Linux, LF) mediu 0,50
  no mesmo código e reprovou o `ce74e42`. É diferença de medição entre as
  máquinas, não duplicação nova: o limite volta ao valor que o CI confirma.

## Fora do portão (medido à mão)

- **Lighthouse (LCP, maior travada da tela, acessibilidade):** o workflow
  `lighthouse.yml` só roda em PR, e a `main` recebe push direto. A medição
  conta quando há 3 rodadas no mesmo dia. Anote a mediana aqui.
- **Erros em produção (Sentry):** taxa por versão, anotada a cada publicação.
