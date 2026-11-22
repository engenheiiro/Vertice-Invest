/**
 * Testes do ExplainableAIRenderer (texto "Explainable IA" do relatório).
 *
 * O texto da IA chega em markdown-lite: cabeçalhos de qualquer nível com
 * emoji de seção, bullets 🟢/🟡 viram selos COMPRAR/AGUARDAR, **negrito**
 * inline, bullet genérico, parágrafo e linha em branco.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExplainableAIRenderer } from './ExplainableAIRenderer';

const TEXT = [
  '### 🟦 Cenário Macro',
  'Selic em **15%** e inflação cedendo.',
  '',
  '## 🏆 Destaques',
  '- 🟢 **TAEE11** — dividendos previsíveis',
  '• 🟡 **MGLU3** — aguardar balanço',
  '- Setor elétrico **resiliente**',
  '# Sem emoji',
].join('\n');

describe('ExplainableAIRenderer', () => {
  it('cabeçalhos de qualquer nível perdem os # e ganham a cor da seção', () => {
    render(<ExplainableAIRenderer text={TEXT} />);
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
    expect(screen.getByText('🟦 Cenário Macro')).toHaveClass('text-blue-400');
    expect(screen.getByText('🏆 Destaques')).toHaveClass('text-emerald-400');
    expect(screen.getByText('Sem emoji')).toHaveClass('text-slate-300');
  });

  it('bullets 🟢/🟡 viram selos e o negrito vira <strong>', () => {
    const { container } = render(<ExplainableAIRenderer text={TEXT} />);
    expect(screen.getByText('COMPRAR').nextElementSibling).toHaveTextContent('TAEE11 — dividendos previsíveis');
    expect(screen.getByText('AGUARDAR').nextElementSibling).toHaveTextContent('MGLU3 — aguardar balanço');
    const bold = Array.from(container.querySelectorAll('strong')).map((s) => s.textContent);
    expect(bold).toEqual(['15%', 'TAEE11', 'MGLU3', 'resiliente']);
    expect(screen.getByText('resiliente').closest('p')).toHaveTextContent('Setor elétrico resiliente');
    expect(container.querySelectorAll('.h-2')).toHaveLength(1);
  });

  it('texto puro vira parágrafo sem selo', () => {
    render(<ExplainableAIRenderer text="Apenas uma frase." />);
    expect(screen.getByText('Apenas uma frase.').closest('p')).toHaveClass('text-slate-400');
    expect(screen.queryByText('COMPRAR')).not.toBeInTheDocument();
  });
});
