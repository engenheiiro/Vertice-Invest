
// Testes de acessibilidade automatizados (item 4.1 do plano de melhorias).
// Usa axe-core via jest-axe para detectar violações WCAG nas regras estruturais.
//
// Nota: color-contrast é desabilitado — requer CSS computado pelo browser real
// (jsdom não executa Tailwind). Use Lighthouse CI (lighthouse.yml) para contraste.

import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';

const AXE_CONFIG = {
    rules: { 'color-contrast': { enabled: false } },
};

describe('a11y — axe-core', () => {
    it('Button primário não viola WCAG estrutural', async () => {
        const { container } = render(<Button>Confirmar</Button>);
        expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
    });

    it('Button outline não viola WCAG estrutural', async () => {
        const { container } = render(<Button variant="outline">Cancelar</Button>);
        expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
    });

    it('ConfirmModal informativo não viola WCAG estrutural', async () => {
        render(
            <ConfirmModal
                isOpen
                title="Confirmar ação"
                message="Tem certeza que deseja continuar?"
                onConfirm={() => {}}
                onClose={() => {}}
            />
        );
        expect(await axe(document.body, AXE_CONFIG)).toHaveNoViolations();
    });

    it('ConfirmModal destrutivo não viola WCAG estrutural', async () => {
        render(
            <ConfirmModal
                isOpen
                isDestructive
                title="Remover ativo"
                message="Esta ação não pode ser desfeita."
                confirmText="Remover"
                onConfirm={() => {}}
                onClose={() => {}}
            />
        );
        expect(await axe(document.body, AXE_CONFIG)).toHaveNoViolations();
    });
});
