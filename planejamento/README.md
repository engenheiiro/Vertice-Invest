# planejamento/

Documentos de planejamento e operação do Vértice Invest. **Só o que tem
pendência** — o histórico do que já foi entregue vive no git e no
[`CHANGELOG.md`](../CHANGELOG.md).

| Arquivo | O que é |
|---|---|
| [`BACKLOG.md`](BACKLOG.md) | Fonte única do trabalho pendente (correções, evoluções, DevOps, observabilidade, operações de prod). Organizado por tema, com complexidade e qual IA usar. |
| [`COMANDOS.md`](COMANDOS.md) | Cheat sheet dos scripts npm, verificado contra `package.json`. |
| [`ANALISE-RANKINGS-PROMPT.txt`](ANALISE-RANKINGS-PROMPT.txt) | Prompt reutilizável para gerar uma nova análise do motor de rankings. Peça à IA para lê-lo e produzir um `analise-rankings-AAAA-MM.txt` novo. |
| [`analise-rankings-2026-06.txt`](analise-rankings-2026-06.txt) | Baseline: última análise profunda do motor de rankings (jun/2026). Referência técnica; o roadmap (§2.10) alimenta o BACKLOG. |

## Auditorias (na raiz do repo)

- [`../AUDITORIA-PROMPT.md`](../AUDITORIA-PROMPT.md) — prompt reutilizável para
  auditoria técnica completa.
- [`../RESULTADO-AUDITORIA.md`](../RESULTADO-AUDITORIA.md) — resultado da última
  auditoria + baseline para as próximas.

## Manutenção deste diretório

Ao concluir um item: **remova-o** do `BACKLOG.md` (não marque como feito e
deixe acumular) e registre no commit/`CHANGELOG.md`. Ao abrir uma nova frente,
adicione ao `BACKLOG.md` com complexidade e IA sugerida.
