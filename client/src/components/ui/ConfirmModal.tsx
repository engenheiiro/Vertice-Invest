
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen, onClose, onConfirm, title, message, confirmText = "Confirmar", isDestructive = false
}) => {
    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[200]" aria-labelledby="modal-title" aria-describedby="modal-description" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
                    <div className={`relative transform overflow-hidden rounded-2xl bg-base border border-slate-800 text-left shadow-2xl transition-all w-full max-w-sm animate-fade-in border-t-4 ${isDestructive ? 'border-t-red-500' : 'border-t-blue-500'}`}>

                        <div className="p-6">
                            <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full mb-4 ${isDestructive ? 'bg-red-900/20' : 'bg-blue-900/20'}`}>
                                {isDestructive
                                    ? <AlertTriangle className="h-7 w-7 text-red-400" aria-hidden="true" />
                                    : <Info className="h-7 w-7 text-blue-400" aria-hidden="true" />
                                }
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-bold leading-6 text-white" id="modal-title">{title}</h3>
                                <div className="mt-3">
                                    <p id="modal-description" className={`text-sm leading-relaxed ${isDestructive ? 'text-slate-300' : 'text-slate-400'}`}>
                                        {message}
                                    </p>
                                </div>
                                {isDestructive && (
                                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 border border-red-800/40 rounded-lg">
                                        <AlertTriangle size={12} className="text-red-400 shrink-0" />
                                        <span className="text-xs font-bold text-red-400">Esta ação não pode ser desfeita</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-panel px-4 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:px-6">
                            <button
                                type="button"
                                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-transparent border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300 shadow-sm hover:bg-slate-800 sm:w-auto transition-all"
                                onClick={onClose}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm sm:w-auto transition-all active:scale-95 ${isDestructive ? 'bg-red-600 hover:bg-red-500 shadow-red-900/30' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/30'}`}
                                onClick={() => {
                                    onConfirm();
                                    onClose();
                                }}
                            >
                                {confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
