import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal (UI base — M11 / A3 / A4)', () => {
  it('não renderiza nada quando fechado', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Oi">
        conteúdo
      </Modal>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renderiza título e conteúdo quando aberto, com aria de diálogo', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Nova Transação">
        corpo do modal
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Nova Transação')).toBeInTheDocument();
    expect(screen.getByText('corpo do modal')).toBeInTheDocument();
  });

  it('fecha ao pressionar Escape (A3)', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="X">
        c
      </Modal>
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fecha ao clicar no botão de fechar', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="X">
        c
      </Modal>
    );
    await userEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
