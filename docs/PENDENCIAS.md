# Pendências

O que ficou para depois, com dono e data. Item resolvido sai da lista no
mesmo commit que o resolve.

## Abertas

- **(dono, 2026-11-22) Publicar os commits da instalação do portão.** Eles
  estão só no ramo local `main`: lockfile do server, commitlint, catraca,
  check, ganchos, fechar e CI. O CI da `main` está vermelho desde 16/11, e
  esses commits o consertam.
- **(dono, 2026-11-22) Limpar ramos e worktrees antigos.** São 28 ramos já
  mesclados na `main` e 7 worktrees parados em `.claude/worktrees/`. O
  `npm run fechar` lista todos. O ramo `fix/audit-shell-quote` (15/06) não foi
  mesclado: decidir se morre.
- **(dono, 2026-11-22) `marketing/posts-lancamento.md` fora de commit.**
  Decidir se entra no repositório ou no `.gitignore`.
- **(dono, 2026-11-22) Confirmar o número "12.000 investidores".** Aparece em
  3 lugares de `client/src/pages/Landing.tsx`.
- **(dono, 2026-11-22) IFIX pela brapi responde 400.** Conferir o token e o
  plano da brapi.
- **(dono, 2026-11-22) Plano de melhoria da catraca.** São as 10 melhorias da
  Fase 4, ainda não começadas.
