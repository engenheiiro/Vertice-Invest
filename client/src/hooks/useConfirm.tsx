import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmModal } from '../components/ui/ConfirmModal';

/**
 * (C4) Confirmação imperativa, promise-based, sobre o `ConfirmModal`.
 *
 * Substitui o `window.confirm()` nativo (não-branded, sem foco/Escape) por um
 * modal do design system com a mesma ergonomia:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Remover ativo?', message: '…', isDestructive: true })) {
 *     // usuário confirmou
 *   }
 *
 * O `<ConfirmProvider>` mantém UM único modal montado e resolve a Promise
 * conforme o usuário confirma (true) ou cancela/fecha (false).
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  isDestructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({ isOpen: false, title: '', message: '' });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    // Encerra qualquer confirmação pendente como "cancelada" antes de abrir outra.
    settle(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...options, isOpen: true });
    });
  }, [settle]);

  // ConfirmModal chama onConfirm() e depois onClose(): resolvemos true no
  // onConfirm e fechamos no onClose (a Promise já está resolvida).
  const handleConfirm = useCallback(() => settle(true), [settle]);

  const handleClose = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
    settle(false); // no-op se já resolvido pelo confirm
  }, [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        isOpen={state.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        isDestructive={state.isDestructive}
      />
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>.');
  return ctx;
};
