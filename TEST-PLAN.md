# Plano de Cobertura de Testes

## Objetivo

Ampliar a cobertura de testes do Vértice de forma incremental, priorizando regras financeiras, segurança e jornadas que impactam diretamente o usuário. Cada etapa deve estar estável antes do avanço para a próxima.

## Etapa 1 — Linha de base

- Executar as suítes atuais de servidor, cliente e E2E.
- Gerar relatórios de cobertura separados para `server` e `client`.
- Registrar falhas, testes instáveis e módulos críticos ainda sem cobertura.
- Definir a cobertura atual por domínio, sem usar um percentual global isolado como indicador de qualidade.

**Conclusão:** relatório de linha de base versionado e lista priorizada de lacunas.

## Etapa 2 — Fundações puras

- Cobrir `mathUtils`, validações Zod, sanitização e utilitários de data, moeda e formatação.
- Incluir valores nulos, ausentes, inválidos, extremos e precisão decimal em cálculos financeiros.
- Criar casos de regressão para bugs já corrigidos.

**Conclusão:** regras determinísticas críticas têm testes unitários rápidos e independentes de rede ou banco.

## Etapa 3 — Engines financeiros e research

- Cobrir `scoringEngine`, `portfolioEngine`, `signalEngine` e `aiResearchService`.
- Validar invariantes: threshold global de 70 para `BUY`/`WAIT`, ordenação por score, desempate estrutural, perfil único por ativo e deltas de posição.
- Exercitar elegibilidade, limites por setor/gestor, penalidades de concentração, dados incompletos e baixa confiança.

**Conclusão:** decisões de ranking e recomendação possuem cenários positivos, negativos e de borda protegidos.

## Etapa 4 — Backend e segurança

- Testar controllers e rotas de autenticação, MFA, autorização por plano e rate limiting por usuário.
- Cobrir carteira, snapshots, dividendos, impostos, metas, pagamentos e webhooks idempotentes.
- Usar mocks determinísticos para provedores externos, banco e relógio; manter integrações reais fora da suíte unitária.

**Conclusão:** fluxos de escrita, permissão e cobrança são validados de ponta a ponta no backend.

## Etapa 5 — Frontend

- Cobrir contexts, hooks, páginas e componentes prioritários de Dashboard, Wallet, Research, autenticação e checkout.
- Verificar estados de carregamento, erro, vazio, dados parciais, modo demo e feature gating por plano.
- Manter testes de acessibilidade para componentes interativos e modais.

**Conclusão:** a interface responde corretamente às principais variações de dados e permissões.

## Etapa 6 — Jornadas E2E

- Ampliar Playwright para login/MFA, adicionar e editar ativo, acompanhar carteira, consultar research e concluir assinatura.
- Cobrir redirecionamentos, bloqueio por plano e mensagens de falha relevantes.
- Usar massa de dados controlada e seletores estáveis para evitar flakiness.

**Conclusão:** as jornadas essenciais passam de forma confiável em ambiente de teste.

## Etapa 7 — Qualidade contínua

- Definir metas de cobertura por domínio e níveis de criticidade.
- Executar testes, lint, typecheck e cobertura no CI.
- Impedir redução injustificada de cobertura em pull requests.
- Publicar relatório periódico de lacunas e novos riscos.

**Conclusão:** a cobertura evolui continuamente e regressões são bloqueadas antes do merge.

## Ordem de execução

1. Etapa 1
2. Etapa 2
3. Etapa 3
4. Etapa 4
5. Etapa 5
6. Etapa 6
7. Etapa 7

## Linha de base — 12/07/2026

| Camada | Comando | Resultado |
| --- | --- | --- |
| Backend | `npm.cmd run test:ci --prefix server` | 329 testes em 33 arquivos passaram. O comando falha somente pelos gates de cobertura. Cobertura medida: 72,08% linhas/statements, 73,05% branches e 70,22% funções. |
| Frontend | `npm.cmd run test:coverage --prefix client` | 295 testes em 28 arquivos passaram. Cobertura medida: 23,22% linhas/statements, 77,08% branches e 42,46% funções. |
| E2E | `npm.cmd run test:e2e --prefix client` | O único fluxo (`wallet-flow.spec.ts`) falhou ao iniciar e o processo excedeu 60 segundos durante a finalização. Requer diagnóstico do runner/ambiente antes de ampliar a suíte. |

### Lacunas priorizadas

1. `server/services/engines/scoringEngine.js`: funções em 76,19%, abaixo do gate de 90%.
2. `server/services/engines/signalEngine.js`: 58,39% de linhas/statements, 66,66% de funções e 29,85% de branches, abaixo dos gates de 60%/70%/30%.
3. Frontend: a cobertura de linhas está em 23,22%; priorizar componentes e páginas de fluxos financeiros ainda não exercitados.
4. E2E: estabilizar o runner existente antes de adicionar novos cenários.
5. Estabilidade dos testes de UI: avisos de `act(...)` em Research e Wallet, além de dimensões nulas em gráficos Recharts.
