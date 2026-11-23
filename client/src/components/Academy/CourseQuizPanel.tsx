import React from 'react';
import { Award, CheckCircle, Lock } from 'lucide-react';
import type { CourseQuiz, QuizResult } from './coursePlayerRules';

const Spinner = () => <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>;

interface QuizFormProps {
    quiz: CourseQuiz;
    quizAnswers: number[];
    quizSubmitting: boolean;
    onSelect: (questionIdx: number, optionIdx: number) => void;
    onSubmit: () => void;
}

const QuizForm = ({ quiz, quizAnswers, quizSubmitting, onSelect, onSubmit }: QuizFormProps) => (
    <div className="space-y-8">
        {quiz.questions.map((q, qIdx) => (
            <div key={qIdx} className="space-y-4">
                <p className="text-lg font-medium text-white">
                    {qIdx + 1}. {q.text}
                </p>
                <div className="grid gap-3">
                    {q.options.map((opt, oIdx) => (
                        <button
                            key={oIdx}
                            onClick={() => onSelect(qIdx, oIdx)}
                            className={`p-4 rounded-xl text-left transition-all border ${
                                quizAnswers[qIdx] === oIdx
                                    ? 'bg-blue-600/20 border-blue-500 text-white'
                                    : 'bg-black/40 border-white/5 text-slate-400 hover:bg-white/5'
                            }`}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            </div>
        ))}

        <button
            onClick={onSubmit}
            disabled={quizSubmitting || quizAnswers.includes(-1)}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
        >
            {quizSubmitting ? (
                <>
                    <Spinner />
                    Enviando...
                </>
            ) : "Finalizar Teste"}
        </button>
    </div>
);

interface QuizBodyProps extends Omit<QuizFormProps, 'quiz'> {
    quiz: CourseQuiz | null;
    quizLoading: boolean;
    quizError: string;
    onStart: () => void;
}

const QuizCard = ({ quiz, quizLoading, quizError, onStart, ...form }: QuizBodyProps) => (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-8">
        <div className="flex items-center gap-4 mb-8">
            <div className="p-3 bg-blue-500/20 rounded-xl">
                <Award className="text-blue-400" size={32} />
            </div>
            <div>
                <h2 className="text-2xl font-bold">Teste Final de Formação</h2>
                <p className="text-slate-400">Responda as perguntas para liberar seu certificado.</p>
            </div>
        </div>

        {quizError && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {quizError}
            </div>
        )}

        {quizLoading ? (
            <div className="py-12 flex flex-col items-center justify-center">
                <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                <p className="text-slate-400">Carregando perguntas...</p>
            </div>
        ) : quiz ? (
            <QuizForm quiz={quiz} {...form} />
        ) : (
            <div className="text-center py-12">
                <button
                    onClick={onStart}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                >
                    Iniciar Teste
                </button>
            </div>
        )}
    </div>
);

interface PassedProps {
    result: QuizResult;
    downloading: boolean;
    onDownload: () => void;
}

const QuizPassed = ({ result, downloading, onDownload }: PassedProps) => (
    <>
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-green-500" size={48} />
        </div>
        <h2 className="text-3xl font-bold mb-2 text-white">Aprovado!</h2>
        <p className="text-slate-400 mb-8">
            Sua pontuação: <span className="text-white font-bold">{result.score.toFixed(0)}%</span> (Mínimo: {result.passingScore}%)
        </p>
        <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl p-6 mb-8">
            <p className="text-blue-400 font-medium mb-4">
                Parabéns! Você demonstrou domínio sobre o conteúdo. Seu certificado oficial já está disponível para download.
            </p>
            <button
                onClick={onDownload}
                disabled={downloading}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {downloading ? (
                    <>
                        <Spinner />
                        Gerando...
                    </>
                ) : (
                    <>
                        <Award size={20} />
                        Baixar Certificado
                    </>
                )}
            </button>
        </div>
    </>
);

interface FailedProps {
    result: QuizResult;
    quiz: CourseQuiz;
    quizAnswers: number[];
    onRetry: () => void;
}

const QuizFailed = ({ result, quiz, quizAnswers, onRetry }: FailedProps) => (
    <>
        <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="text-red-500" size={48} />
        </div>
        <h2 className="text-3xl font-bold mb-2 text-white">Não foi desta vez</h2>
        <p className="text-slate-400 mb-4">
            Sua pontuação: <span className="text-red-400 font-bold">{result.score.toFixed(0)}%</span> (Mínimo: {result.passingScore}%)
        </p>

        {/* Review Section */}
        <div className="max-h-60 overflow-y-auto mb-8 bg-black/20 rounded-xl p-4 text-left border border-white/5">
            <h4 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">Revisão das Respostas</h4>
            <div className="space-y-4">
                {/* O servidor só devolve o gabarito a quem passou: na
                    reprovação a revisão mostra as próprias respostas, sem
                    apontar certo/errado (senão a tentativa seguinte vira cópia). */}
                {quiz.questions.map((q, idx) => (
                    <div key={idx} className="text-sm">
                        <p className="text-slate-300 mb-1">{idx + 1}. {q.text}</p>
                        <p className="text-slate-400">
                            Sua resposta: {q.options[quizAnswers[idx]]}
                        </p>
                    </div>
                ))}
            </div>
        </div>

        <p className="text-slate-500 mb-8">
            Revise o conteúdo das aulas e tente novamente. O conhecimento é uma jornada constante.
        </p>
        <button
            onClick={onRetry}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors"
        >
            Tentar Novamente
        </button>
    </>
);

interface QuizPanelProps extends QuizBodyProps {
    quizResult: QuizResult | null;
    downloading: boolean;
    onDownload: () => void;
    onRetry: () => void;
}

/** Teste final: perguntas, ou o resultado (aprovado com certificado, reprovado com revisão). */
export const CourseQuizPanel = ({ quizResult, downloading, onDownload, onRetry, ...body }: QuizPanelProps) => (
    <div className="w-full max-w-3xl mx-auto">
        {!quizResult ? (
            <QuizCard {...body} />
        ) : (
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-12 text-center">
                {quizResult.passed ? (
                    <QuizPassed result={quizResult} downloading={downloading} onDownload={onDownload} />
                ) : (
                    <QuizFailed result={quizResult} quiz={body.quiz as CourseQuiz} quizAnswers={body.quizAnswers} onRetry={onRetry} />
                )}
            </div>
        )}
    </div>
);
