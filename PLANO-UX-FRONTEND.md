# Plano de Melhorias — UX, Acessibilidade & Frontend

Continuação do `PLANO-MELHORIAS.md` (que estabilizou base, segurança, testes e A1–A12).
Este foca em **experiência**: consistência visual, acessibilidade avançada, mobile e polimento.

**Legenda:** `[ ]` pendente · `[x]` concluído · `[~]` dispensado (com motivo)

---

## Fase 1 — Fundação ✅

- [x] **C1** — Formatter central `client/src/utils/format.ts` (`formatCurrency`, `formatPercent`, `formatCompact`, `formatQuantity`, privacy-aware) + 14 testes; 23 consumidores refatorados (0 `Intl.NumberFormat` solto fora do util).
- [x] **C3** — `framer-motion` removido do `client/package.json`; stack corrigida na `CLAUDE.md`.
- [x] **C4** — Hook `useConfirm()` promise-based sobre `ConfirmModal` (`ConfirmProvider` montado no `App`) + 3 testes.
- [x] **X1** — `prefers-reduced-motion` global em `index.css` (neutraliza animações/transições/spin).

## Fase 2 — UX core ✅

- [x] **U1** — 14 `alert()`/`confirm()` nativos substituídos por `useConfirm`/`ConfirmModal` (confirmações) + `addToast` (erros/avisos). Restou só o `prompt()` nativo do PWA (legítimo).
- [x] **U2** — Mock `alert("rebalanceamento… (Mock)")` removido → `addToast` "em desenvolvimento, chega em breve. 🚧".
- [x] **U3** — Componente reutilizável `components/ui/EmptyState.tsx` criado + aplicado na **carteira vazia** (antes mostrava tabela vazia; agora convida a adicionar o 1º ativo). Proventos/sinais já tinham estados de vazio bons e contextuais — mantidos.
- [x] **C2** — Tokens Tailwind adotados em **49 arquivos** (`bg-base/card/panel/deep/elevated`, `text-gold`, `border-gold`); 0 hex de token solto. Cores não-token (shades pontuais) mantidas.
- [~] **C5** — Adiado: após o C2 centralizar as cores, consolidar classes em `.card-surface`/`.modal-panel` é indireção de baixo valor e exigiria nova varredura de ~49 arquivos (risco > ganho). Reabrir se a repetição de className incomodar.

## Fase 3 — Mobile ✅

- [x] **M1** — `components/layout/BottomNav.tsx`: barra inferior fixa (Terminal/Carteira/Research/Radar/Mais) com `safe-area-inset-bottom`, montada no layout protegido. `main` ganhou padding inferior no mobile pra não ser coberto.
- [x] **M2** — Drawer hambúrguer do Header removido; navegação mobile vive na BottomNav, com botão "Mais" abrindo bottom sheet (Indicadores/Calculadora/Cursos/Planos/Perfil/Admin + Sair).
- [x] **M3** — `components/ui/Modal.tsx` agora cola embaixo (bottom sheet com puxador) no mobile e centraliza no desktop.
- [x] **M4** — `AssetList`: tabela larga (`min-w-[900px]`) fica só no desktop (`hidden md:block`); no mobile vira cards empilhados por classe (sem scroll horizontal).

## Fase 4 — Polimento ✅

- [x] **U4** — Hook `hooks/useCountUp.ts` (RAF + easeOutCubic, respeita reduced-motion); patrimônio "conta" até o valor no `EquitySummary` e `WalletSummary`.
- [x] **U5** — Research: spinner de página trocado por skeletons (`SkeletonCard` + `SkeletonTableRows`). Radar e Dashboard já usavam skeleton.
- [~] **U6** — Adiado: o "Desfazer" da remoção exige soft-delete no servidor (hoje a remoção é definitiva); o "copiar ticker" isolado é de baixo valor. Reabrir junto com soft-delete no backend.
- [x] **X3** — `:focus-visible` global em `index.css` (anel azul só no foco por teclado, não no clique de mouse).
- [x] **X4** — `aria-live="polite"` + `aria-atomic` no patrimônio (mudanças anunciadas a leitores de tela).
- [x] **P1** — `PerformanceCard` memoizado; gráficos (Evolution/Performance/Allocation) já eram `React.memo`.

## Fase 5 — A11y final ✅

- [x] **X2** — Skip link "Pular para o conteúdo" no `Header` (1º Tab, `sr-only` + `focus:not-sr-only`) apontando para `#main-content`; `id="main-content" tabIndex={-1}` adicionado nas 8 páginas com `<main>`. Landmarks (`<nav>`/`<main>`) já presentes.
- [~] **X5** — Adiado (= A8): auditoria mostrou `text-slate-500` (318 usos, ~3,85:1) e `text-slate-600` (80 usos, ~2,3:1) sobre `bg-base` — abaixo de AA 4,5:1 para texto normal. Subir para `slate-400` passaria, mas afeta **398 pontos** e é a cor base de "texto suave" de todo o produto → decisão de design + Lighthouse, fora de um sweep automático seguro.
- [x] **P2** — Bundle auditado: `framer-motion` removido (sem chunk). Maiores: `index` 589 KB (183 KB gzip), `recharts` 350 KB (98 KB gzip, **já lazy** nas abas secundárias). Split adicional de vendor é otimização futura.
- [~] **P3** — Desnecessário: as listas longas (`AssetTransactionsModal`, `CashFlowHistory`) já são **paginadas** (load-more), sem render de 100+ linhas de uma vez. Reabrir só se virar render único grande.

---

## Resumo final

Fases 1–5 concluídas. Itens adiados com motivo: **C5** (indireção pós-C2), **U6** (undo exige soft-delete), **X5** (contraste = decisão de design), **P3** (listas já paginadas). Tudo verificado: typecheck limpo, **62 testes**, **0 erros** de lint, build OK, desktop intacto.

---

## Verificação por fase

- **C1:** `vitest` em `format.ts`; `grep` confirma 0 `Intl.NumberFormat` solto fora do util.
- **U1/U2:** `grep "\b(alert|confirm)\("` em `client/src` retorna só o `prompt()` do PWA.
- **C3:** ausente do `package.json`; `npm run build` ok.
- **X1:** DevTools "Emulate prefers-reduced-motion" → animações cessam.
- **M1:** viewport ≤768px mostra a barra; some no desktop; `safe-area` ok.
- **Geral:** `npm run typecheck` + `lint` limpos; `test:client` verde.
