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
| Métrica | Limite | 2026-11-22 |
|---|---|---|
| `cobertura.server.config` — Cobertura de linhas — server/config (%) | 89.5 | 89.6 |
| `cobertura.server.controllers` — Cobertura de linhas — server/controllers (%) | 44 | 44.3 |
| `cobertura.server.middleware` — Cobertura de linhas — server/middleware (%) | 93.5 | 93.9 |
| `cobertura.server.models` — Cobertura de linhas — server/models (%) | 91 | 91.3 |
| `cobertura.server.routes` — Cobertura de linhas — server/routes (%) | 81.5 | 81.6 |
| `cobertura.server.schemas` — Cobertura de linhas — server/schemas (%) | 94 | 94.2 |
| `cobertura.server.services` — Cobertura de linhas — server/services (%) | 68.5 | 68.5 |
| `cobertura.server.services/engines` — Cobertura de linhas — server/services/engines (%) | 93.5 | 93.6 |
| `cobertura.server.utils` — Cobertura de linhas — server/utils (%) | 96 | 96.1 |
| `cobertura.client.components` — Cobertura de linhas — client/src/components (%) | 51 | 51.1 |
| `cobertura.client.contexts` — Cobertura de linhas — client/src/contexts (%) | 46.5 | 46.6 |
| `cobertura.client.hooks` — Cobertura de linhas — client/src/hooks (%) | 17 | 17.3 |
| `cobertura.client.pages` — Cobertura de linhas — client/src/pages (%) | 29 | 29.2 |
| `cobertura.client.services` — Cobertura de linhas — client/src/services (%) | 20 | 20.4 |
| `cobertura.client.utils` — Cobertura de linhas — client/src/utils (%) | 82.5 | 82.5 |
| `testes.server` — Casos de teste do server | 3070 | 3070 |
| `testes.client` — Casos de teste do client | 1091 | 1091 |
| `tempo.testes.server` — Suíte do server com cobertura (s) | 60 | 29.4 |
| `tempo.testes.client` — Suíte do client com cobertura (s) | 60 | 21.9 |
| `arquivosGrandes` — Arquivos acima de 600 linhas (teto = tamanho de hoje) | 43 | 43 |
| `linhasLongas` — Linhas com mais de 160 caracteres | 1259 | 1259 |
| `eslintDisable` — Supressões eslint-disable | 16 | 16 |
| `eslintDisableSemMotivo` — eslint-disable sem "-- motivo" na linha | 16 | 16 |
| `asAny` — Ocorrências de "as any" (TS) | 145 | 145 |
| `tsDiretivas` — Diretivas de supressão do TypeScript (ignore / expect-error / nocheck) | 0 | 0 |
| `naoNulo` — Asserções de não-nulo "x!" (TS) | 68 | 68 |
| `focoEmTeste` — Testes com .only / fit / fdescribe | 0 | 0 |
| `testesComData` — Arquivos de teste que leem o relógio sem fixá-lo | 41 | 41 |
| `testesEmQuarentena` — Testes pulados em quarentena (0 no fim da semana) | info | 0 |
| `quarentenaIrregular` — Teste pulado sem data, vencido ou com prazo > 7 dias | 0 | 0 |
| `cssSemUso` — Classes do CSS próprio sem uso | 9 | 9 |
| `imgSemSrcset` — <img> sem srcSet | 23 | 23 |
| `bundleGzipKB` — Bundle do client, JS+CSS com gzip (KB) | 747 | 679 |
| `lint.erros` — Erros do ESLint | 0 | 0 |
| `lint.avisos` — Avisos do ESLint (fora a11y e complexidade) | 15 | 15 |
| `lint.a11y` — Avisos de acessibilidade (jsx-a11y) | 200 | 200 |
| `complexidade` — Funções com complexidade > 15, por arquivo | 120 | 120 |
| `complexidadeMax` — Maior complexidade ciclomática de uma função | 190 | 190 |
| `duplicacaoPct` — Linhas duplicadas (%) — jscpd | 0.64 | 0.64 |
| `codigoMorto` — Arquivos/exports sem uso de produção | 34 | 34 |
| `vulnAltas` — Vulnerabilidades altas/críticas (npm audit) | 0 | 0 |
| `depsMajorAtras` — Dependências mais de uma versão maior atrás | 9 | 9 |
| `depsSemUso` — Dependências declaradas sem uso | 0 | 0 |
| `segredos` — Segredos aparentes em arquivos versionados | 0 | 0 |
| `foraStrict` — Arquivos TS fora do modo strict | 0 | 0 |
| `marcadoresSemDono` — TODO/FIXME sem (dono, AAAA-MM-DD) | 0 | 0 |
<!-- placar:fim -->

## Afrouxamentos

Um limite só afrouxa com o motivo escrito aqui, numa linha que cite a chave da
métrica entre crases, como `` `linhasLongas` ``. O `npm run metricas` compara a
base com a versão publicada (`@{u}`) e reprova o afrouxamento que não tiver
linha nesta seção.

Formato: `- AAAA-MM-DD` seguido de `` `chave` ``, do que mudou e do porquê.

_(nenhum até agora)_

## Fora do portão (medido à mão)

- **Lighthouse (LCP, maior travada da tela, acessibilidade):** o workflow
  `lighthouse.yml` só roda em PR, e a `main` recebe push direto. A medição
  conta quando há 3 rodadas no mesmo dia. Anote a mediana aqui.
- **Erros em produção (Sentry):** taxa por versão, anotada a cada publicação.
