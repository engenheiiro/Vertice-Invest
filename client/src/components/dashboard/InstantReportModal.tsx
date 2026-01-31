
import React from 'react';
import { createPortal } from 'react-dom';
import { X, Bot, FileText, Calendar } from 'lucide-react';
import { Button } from '../ui/Button';

interface InstantReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    reportText: string;
    date: string;
    isLoading: boolean;
}

export const InstantReportModal: React.FC<InstantReportModalProps> = ({ isOpen, onClose, reportText, date, isLoading }) => {
    if (!isOpen) return null;

    // Renderizador simples de markdown para o texto da IA
    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="relative">
                        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                        <Bot size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white" />
                    </div>
                    <p className="text-slate-400 text-sm animate-pulse">Compilando inteligência de mercado...</p>
                </div>
            );
        }

        if (!reportText) {
            return (
                <div className="text-center py-10 text-slate-500">
                    <FileText size={40} className="mx-auto mb-2 opacity-50" />
                    <p>Nenhum relatório disponível para o momento.</p>
                </div>
            );
        }

        return reportText.split('\n').map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={i} className="h-3"></div>;
            
            if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                return <h4 key={i} className="text-white font-bold text-sm mt-4 mb-2">{trimmed.replace(/\*\*/g, '')}</h4>;
            }
            if (trimmed.startsWith('- ')) {
                return (
                    <div key={i} className="flex gap-2 text-slate-300 text-xs mb-1.5 leading-relaxed">
                        <span className="text-blue-500 mt-1.5">•</span>
                        <span>{trimmed.substring(2)}</span>
                    </div>
                );
            }
            return <p key={i} className="text-slate-400 text-xs leading-relaxed mb-2 text-justify">{trimmed}</p>;
        });
    };

    return createPortal(
        <div className="relative z-[200]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl bg-[#080C14] border border-slate-700 rounded-2xl shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
                        
                        <div className="p-6 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                                    <Bot size={24} className="text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white uppercase tracking-tight">Morning Call IA</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
                                        <Calendar size={10} /> {date}
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#05070A]">
                            {renderContent()}
                        </div>

                        <div className="p-4 border-t border-slate-800 bg-[#0B101A] flex justify-end">
                            <Button variant="outline" onClick={onClose} className="w-auto px-6 h-10 text-xs">
                                Fechar
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
