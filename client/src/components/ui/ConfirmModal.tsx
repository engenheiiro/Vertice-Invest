
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';

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
        <div className="relative z-[200]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
                    <div className="relative transform overflow-hidden rounded-2xl bg-[#080C14] border border-slate-800 text-left shadow-2xl transition-all w-full max-w-sm animate-fade-in border-t-4 border-t-red-500">
                        
                        <div className="p-6">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/20 mb-4">
                                <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-bold leading-6 text-white" id="modal-title">{title}</h3>
                                <div className="mt-2">
                                    <p className="text-sm text-slate-400">
                                        {message}
                                    </p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="bg-[#0F131E] px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 gap-2">
                            <button
                                type="button"
                                className={`inline-flex w-full justify-center rounded-xl px-3 py-2 text-sm font-bold text-white shadow-sm sm:w-auto transition-all ${isDestructive ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                                onClick={() => {
                                    onConfirm();
                                    onClose();
                                }}
                            >
                                {confirmText}
                            </button>
                            <button
                                type="button"
                                className="mt-3 inline-flex w-full justify-center rounded-xl bg-transparent border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 shadow-sm hover:bg-slate-800 sm:mt-0 sm:w-auto transition-all"
                                onClick={onClose}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
