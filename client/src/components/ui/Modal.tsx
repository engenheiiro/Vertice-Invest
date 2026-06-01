import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Classe Tailwind de largura máxima (default `max-w-lg`). */
  maxWidth?: string;
  /** Mostra o botão de fechar no canto (default `true`). */
  showClose?: boolean;
  /** Cor da borda superior de destaque (ex.: `border-t-blue-500`). */
  accent?: string;
}

/**
 * Modal base do design system (M11). Padroniza:
 * - `createPortal` para `document.body` + backdrop `blur` (CLAUDE.md).
 * - Fechar com `Escape` e clique no backdrop (A3).
 * - Focus trap com ciclo de `Tab` e restauração de foco ao fechar (A3/A9).
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` no título (A4).
 *
 * Use no lugar de reimplementar o boilerplate de portal/backdrop em cada modal.
 */
export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  showClose = true,
  accent,
}: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Bloqueia scroll do body enquanto o modal está aberto.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => el.offsetParent !== null)
        : [];

    // Foca o primeiro elemento interativo (ou o próprio painel).
    const first = focusables()[0];
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="relative z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        className="fixed inset-0 bg-black/95 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-10 overflow-y-auto">
        {/* (M3) No mobile o painel cola embaixo (bottom sheet); no desktop centraliza. */}
        <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
          <div
            ref={panelRef}
            tabIndex={-1}
            className={`relative w-full ${maxWidth} transform overflow-hidden rounded-t-2xl sm:rounded-2xl bg-panel border border-slate-800 text-left shadow-2xl transition-all animate-fade-in outline-none ${
              accent ? `border-t-4 ${accent}` : ''
            }`}
          >
            {/* Puxador visual do bottom sheet (só mobile). */}
            <div className="sm:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-slate-700" aria-hidden="true" />
            {(title || showClose) && (
              <div className="flex items-center justify-between gap-4 p-6 border-b border-slate-800">
                {title ? (
                  <h3 id={titleId} className="text-lg font-bold text-white">
                    {title}
                  </h3>
                ) : (
                  <span />
                )}
                {showClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="text-slate-500 hover:text-white transition-colors rounded-lg p-1"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
