import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Circle, PlayCircle, Lock, Award } from 'lucide-react';
import ReactPlayer from 'react-player';
const Player = ReactPlayer as any;
import { COURSES, LESSONS } from '../data/academy';
import { useAuth } from '../contexts/AuthContext';

export const CoursePlayer = () => {
    const { courseId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    
    const [course, setCourse] = useState<any>(null);
    const [lessons, setLessons] = useState<any[]>([]);
    const [currentLesson, setCurrentLesson] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [completedLessons, setCompletedLessons] = useState<string[]>([]);
    const [hasAccess, setHasAccess] = useState(true);
    const [showQuiz, setShowQuiz] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [useNativeIframe, setUseNativeIframe] = useState(true);

    const [quiz, setQuiz] = useState<any>(null);
    const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
    const [quizSubmitting, setQuizSubmitting] = useState(false);
    const [quizLoading, setQuizLoading] = useState(false);
    const [quizError, setQuizError] = useState('');
    const [quizResult, setQuizResult] = useState<any>(null);
    const [lastAttempt, setLastAttempt] = useState<any>(null);

    useEffect(() => {
        console.log("CoursePlayer: Current Lesson updated", currentLesson);
    }, [currentLesson]);

    useEffect(() => {
        const fetchCourseData = async () => {
            try {
                setLoading(true);
                const token = localStorage.getItem('token');
                
                // Buscar dados do curso e aulas do servidor
                console.log(`Fetching data for course: ${courseId}`);
                const courseRes = await fetch(`/api/academy/courses/${courseId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (!courseRes.ok) {
                    const errData = await courseRes.json();
                    throw new Error(errData.message || 'Erro ao carregar curso');
                } else {
                    const data = await courseRes.json();
                    console.log('Course data received from server:', data);
                    setCourse(data.course);
                    setLessons(data.lessons);
                    setHasAccess(data.hasAccess);
                    
                    if (data.lessons.length > 0) {
                        const lessonIdParam = searchParams.get('lesson');
                        const initialLesson = lessonIdParam ? data.lessons.find((l: any) => l._id === lessonIdParam) : data.lessons[0];
                        setCurrentLesson(initialLesson || data.lessons[0]);
                    }
                }

                // Buscar progresso do usuário do servidor
                if (courseId) {
                    console.log(`Fetching progress for course: ${courseId}`);
                    const progressRes = await fetch(`/api/academy/progress/${courseId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    
                    if (progressRes.ok) {
                        const data = await progressRes.json();
                        console.log('Progress data received:', data);
                        const completedIds = data.progress
                            .filter((p: any) => p.completed)
                            .map((p: any) => p.lessonId);
                        
                        console.log('Completed lesson IDs:', completedIds);
                        setCompletedLessons(completedIds);
                        
                        if (data.quizAttempts && data.quizAttempts.length > 0) {
                            setLastAttempt(data.quizAttempts[0]);
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching course data:', error);
                setError('Erro ao carregar curso. Tente recarregar a página.');
            } finally {
                setLoading(false);
            }
        };

        fetchCourseData();
    }, [courseId, searchParams]);

    const handleVideoEnded = () => {
        const currentIndex = lessons.findIndex(l => l._id === currentLesson._id);
        if (currentIndex < lessons.length - 1) {
            handleLessonSelect(lessons[currentIndex + 1]);
        } else if (allCompleted) {
            setShowQuiz(true);
            if (!quiz) fetchQuiz();
        }
    };

    const handleTestButtonClick = () => {
        if (!allCompleted) return;
        
        setShowQuiz(true);
        if (lastAttempt?.passed) {
            // Se já passou, mostra o resultado diretamente
            setQuizResult({
                passed: true,
                score: lastAttempt.score,
                passingScore: 70, // Valor padrão ou buscar do quiz se disponível
                attempt: lastAttempt
            });
        } else if (!quiz) {
            fetchQuiz();
        }
    };

    const handleProgress = async (state: any) => {
        if (!currentLesson || !user) return;
        
        // Mark as completed if watched 90%
        if (state.played > 0.9 && !completedLessons.includes(currentLesson._id)) {
            console.log(`Marking lesson ${currentLesson._id} as completed (90% watched)`);
            const token = localStorage.getItem('token');
            try {
                const res = await fetch('/api/academy/progress', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        lessonId: currentLesson._id,
                        watchTime: state.playedSeconds || 0,
                        completed: true
                    })
                });
                if (res.ok) {
                    setCompletedLessons(prev => {
                        if (prev.includes(currentLesson._id)) return prev;
                        return [...prev, currentLesson._id];
                    });
                }
            } catch (err) {
                console.error("Erro ao salvar progresso automático:", err);
            }
        }
    };

    const handleLessonSelect = (lesson: any) => {
        setCurrentLesson(lesson);
        setSearchParams({ lesson: lesson._id });
        setShowQuiz(false);
        setQuizResult(null);
    };

    const fetchQuiz = async () => {
        try {
            setQuizLoading(true);
            setQuizError('');
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/academy/quiz/${courseId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setQuiz(data);
                setQuizAnswers(new Array(data.questions.length).fill(-1));
            } else {
                const errData = await res.json();
                setQuizError(errData.message || 'Erro ao carregar o quiz.');
            }
        } catch (err) {
            console.error("Erro ao buscar quiz:", err);
            setQuizError('Erro de conexão ao carregar o quiz.');
        } finally {
            setQuizLoading(false);
        }
    };

    const handleQuizSubmit = async () => {
        if (quizAnswers.includes(-1)) {
            alert("Por favor, responda todas as perguntas.");
            return;
        }

        setQuizSubmitting(true);
        setQuizError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/academy/quiz/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    courseId,
                    answers: quizAnswers
                })
            });

            if (res.ok) {
                const data = await res.json();
                setQuizResult(data);
                setLastAttempt(data.attempt);
            } else {
                const errData = await res.json();
                setQuizError(errData.message || 'Erro ao enviar o quiz.');
            }
        } catch (err) {
            console.error("Erro ao enviar quiz:", err);
            setQuizError('Erro de conexão ao enviar o quiz.');
        } finally {
            setQuizSubmitting(false);
        }
    };

    const handleDownloadCertificate = async () => {
        console.log(`Attempting to download certificate. Lessons: ${lessons.length}, Completed: ${completedLessons.length}`);
        setDownloading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/academy/certificate/${courseId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Falha ao gerar certificado');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificado-${courseId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error(err);
            alert(`Erro ao baixar certificado: ${err.message || 'Verifique se você concluiu todas as aulas.'}`);
        } finally {
            setDownloading(false);
        }
    };

    const allCompleted = lessons.length > 0 && completedLessons.length >= lessons.length;

    if (loading) {
        return (
            <div className="min-h-screen bg-[#02040a] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#02040a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 max-w-md text-center">
                    <Lock className="w-16 h-16 text-slate-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Acesso Restrito</h2>
                    <p className="text-slate-400 mb-6">{error}</p>
                    <button 
                        onClick={() => navigate('/courses')}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors w-full"
                    >
                        Voltar para a Academia
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans flex flex-col md:flex-row">
            {/* Main Player Area */}
            <div className="flex-1 flex flex-col h-screen overflow-y-auto">
                {/* Header */}
                <div className="p-6 flex items-center gap-4 border-b border-white/5 bg-[#02040a]/80 backdrop-blur-md sticky top-0 z-30">
                    <button 
                        onClick={() => navigate('/courses')}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold">{course?.title}</h1>
                        <p className="text-sm text-slate-400">{currentLesson?.title}</p>
                    </div>
                </div>

                {/* Player Container */}
                <div className="p-6 max-w-5xl mx-auto w-full flex-1">
                    {!showQuiz ? (
                        <>
                            {currentLesson?.youtubeId ? (
                                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl relative group">
                                    {!useNativeIframe ? (
                                        <Player 
                                            key={currentLesson._id}
                                            url={`https://www.youtube.com/watch?v=${currentLesson.youtubeId}`}
                                            width="100%"
                                            height="100%"
                                            controls={true}
                                            playing={false}
                                            onProgress={handleProgress}
                                            onEnded={handleVideoEnded}
                                            onReady={() => console.log("ReactPlayer: Video is ready to play")}
                                            onStart={() => console.log("ReactPlayer: Video started playing")}
                                            onError={(e: any) => {
                                                console.error("ReactPlayer Error:", e);
                                                setUseNativeIframe(true);
                                            }}
                                            config={{
                                                youtube: {
                                                    playerVars: { 
                                                        origin: window.location.origin,
                                                        enablejsapi: 1
                                                    }
                                                }
                                            }}
                                        />
                                    ) : (
                                        <iframe
                                            width="100%"
                                            height="100%"
                                            src={`https://www.youtube.com/embed/${currentLesson.youtubeId}?rel=0&origin=${window.location.origin}`}
                                            title="YouTube video player"
                                            frameBorder="0"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                            allowFullScreen
                                        ></iframe>
                                    )}
                                    
                                    <button 
                                        onClick={() => setUseNativeIframe(!useNativeIframe)}
                                        className="absolute top-4 right-4 z-40 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        {useNativeIframe ? "Usar Player Avançado" : "Modo de Compatibilidade"}
                                    </button>
                                </div>
                            ) : (
                                <div className="w-full aspect-video bg-slate-900/50 rounded-2xl border border-slate-800 flex flex-col items-center justify-center text-center p-12">
                                    <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mb-6">
                                        <Lock className="text-blue-400" size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">Conteúdo em Produção</h3>
                                    <p className="text-slate-400 max-w-md">
                                        Esta aula está sendo preparada com o máximo de qualidade pela nossa equipe. 
                                        Em breve ela estará disponível para você.
                                    </p>
                                    <div className="mt-8 flex gap-4">
                                        <button 
                                            onClick={() => navigate('/courses')}
                                            className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm font-medium"
                                        >
                                            Ver outros cursos
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Lesson Info */}
                            <div className="mt-8 flex justify-between items-start">
                                <div className="flex-1">
                                    <h2 className="text-3xl font-bold mb-4">{currentLesson?.title}</h2>
                                    <p className="text-slate-400 leading-relaxed max-w-3xl mb-6">
                                        {currentLesson?.description}
                                    </p>
                                    
                                    {!completedLessons.includes(currentLesson?._id) && (
                                        <button 
                                            onClick={async () => {
                                                const token = localStorage.getItem('token');
                                                try {
                                                    await fetch('/api/academy/progress', {
                                                        method: 'POST',
                                                        headers: {
                                                            'Content-Type': 'application/json',
                                                            'Authorization': `Bearer ${token}`
                                                        },
                                                        body: JSON.stringify({
                                                            lessonId: currentLesson._id,
                                                            watchTime: currentLesson.duration,
                                                            completed: true
                                                        })
                                                    });
                                                    setCompletedLessons(prev => [...prev, currentLesson._id]);
                                                } catch (err) {
                                                    console.error("Erro ao salvar progresso:", err);
                                                }
                                            }}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 rounded-xl transition-all font-medium group"
                                        >
                                            <CheckCircle size={18} className="group-hover:scale-110 transition-transform" />
                                            Marcar esta aula como concluída
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="w-full max-w-3xl mx-auto">
                            {!quizResult ? (
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
                                        <div className="space-y-8">
                                            {quiz.questions.map((q: any, qIdx: number) => (
                                                <div key={qIdx} className="space-y-4">
                                                    <p className="text-lg font-medium text-white">
                                                        {qIdx + 1}. {q.text}
                                                    </p>
                                                    <div className="grid gap-3">
                                                        {q.options.map((opt: string, oIdx: number) => (
                                                            <button
                                                                key={oIdx}
                                                                onClick={() => {
                                                                    const newAnswers = [...quizAnswers];
                                                                    newAnswers[qIdx] = oIdx;
                                                                    setQuizAnswers(newAnswers);
                                                                }}
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
                                                onClick={handleQuizSubmit}
                                                disabled={quizSubmitting || quizAnswers.includes(-1)}
                                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                                            >
                                                {quizSubmitting ? (
                                                    <>
                                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                        Enviando...
                                                    </>
                                                ) : "Finalizar Teste"}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-center py-12">
                                            <button 
                                                onClick={fetchQuiz}
                                                className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                                            >
                                                Iniciar Teste
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-12 text-center">
                                    {quizResult.passed ? (
                                        <>
                                            <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                                <CheckCircle className="text-green-500" size={48} />
                                            </div>
                                            <h2 className="text-3xl font-bold mb-2 text-white">Aprovado!</h2>
                                            <p className="text-slate-400 mb-8">
                                                Sua pontuação: <span className="text-white font-bold">{quizResult.score.toFixed(0)}%</span> (Mínimo: {quizResult.passingScore}%)
                                            </p>
                                            <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl p-6 mb-8">
                                                <p className="text-blue-400 font-medium mb-4">
                                                    Parabéns! Você demonstrou domínio sobre o conteúdo. Seu certificado oficial já está disponível para download.
                                                </p>
                                                <button 
                                                    onClick={handleDownloadCertificate}
                                                    disabled={downloading}
                                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    {downloading ? (
                                                        <>
                                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
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
                                    ) : (
                                        <>
                                            <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                                <Lock className="text-red-500" size={48} />
                                            </div>
                                            <h2 className="text-3xl font-bold mb-2 text-white">Não foi desta vez</h2>
                                            <p className="text-slate-400 mb-4">
                                                Sua pontuação: <span className="text-red-400 font-bold">{quizResult.score.toFixed(0)}%</span> (Mínimo: {quizResult.passingScore}%)
                                            </p>
                                            
                                            {/* Review Section */}
                                            <div className="max-h-60 overflow-y-auto mb-8 bg-black/20 rounded-xl p-4 text-left border border-white/5">
                                                <h4 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">Revisão das Respostas</h4>
                                                <div className="space-y-4">
                                                    {quiz.questions.map((q: any, idx: number) => {
                                                        const isCorrect = quizAnswers[idx] === quizResult.correctAnswers[idx];
                                                        return (
                                                            <div key={idx} className="text-sm">
                                                                <p className="text-slate-300 mb-1">{idx + 1}. {q.text}</p>
                                                                <p className={isCorrect ? "text-green-500" : "text-red-400"}>
                                                                    Sua resposta: {q.options[quizAnswers[idx]]}
                                                                    {!isCorrect && (
                                                                        <span className="block text-slate-500 mt-1 italic">
                                                                            Resposta correta: {q.options[quizResult.correctAnswers[idx]]}
                                                                        </span>
                                                                    )}
                                                                </p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <p className="text-slate-500 mb-8">
                                                Revise o conteúdo das aulas e tente novamente. O conhecimento é uma jornada constante.
                                            </p>
                                            <button 
                                                onClick={() => {
                                                    setQuizResult(null);
                                                    setQuizAnswers(new Array(quiz.questions.length).fill(-1));
                                                }}
                                                className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors"
                                            >
                                                Tentar Novamente
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar - Lesson List */}
            <div className="w-full md:w-96 bg-slate-900/50 border-l border-white/5 h-screen overflow-y-auto flex flex-col">
                <div className="p-6 border-b border-white/5 sticky top-0 bg-slate-900/90 backdrop-blur-md z-10">
                    <h3 className="text-lg font-bold">Conteúdo do Curso</h3>
                    <p className="text-sm text-slate-400 mt-1">{lessons.length} aulas</p>
                </div>
                
                <div className="flex-1 p-4 space-y-2">
                    {lessons.map((lesson, idx) => {
                        const isActive = currentLesson?._id === lesson._id && !showQuiz;
                        const isCompleted = completedLessons.includes(lesson._id);
                        // Lock logic: first lesson is always unlocked, others are unlocked if previous is completed
                        const isLocked = idx > 0 && !completedLessons.includes(lessons[idx - 1]._id);

                        return (
                            <button
                                key={lesson._id}
                                onClick={() => !isLocked && handleLessonSelect(lesson)}
                                disabled={isLocked}
                                className={`w-full text-left p-4 rounded-xl transition-all flex gap-4 group ${
                                    isActive 
                                        ? 'bg-blue-600/20 border border-blue-500/30' 
                                        : isLocked
                                            ? 'opacity-50 cursor-not-allowed border border-transparent'
                                            : 'hover:bg-white/5 border border-transparent'
                                }`}
                            >
                                <div className="mt-1">
                                    {isCompleted ? (
                                        <CheckCircle size={20} className="text-green-500" />
                                    ) : isLocked ? (
                                        <Lock size={20} className="text-slate-600" />
                                    ) : isActive ? (
                                        <PlayCircle size={20} className="text-blue-400" />
                                    ) : (
                                        <Circle size={20} className="text-slate-600 group-hover:text-slate-400" />
                                    )}
                                </div>
                                <div>
                                    <p className={`font-medium ${isActive ? 'text-blue-400' : 'text-slate-300 group-hover:text-white'}`}>
                                        {idx + 1}. {lesson.title}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {Math.floor(lesson.duration / 60)} min
                                    </p>
                                </div>
                            </button>
                        );
                    })}

                    {/* Prova Final & Certificado Button */}
                    <button
                        onClick={handleTestButtonClick}
                        disabled={!allCompleted}
                        className={`w-full mt-4 text-left p-4 rounded-xl transition-all flex gap-4 group ${
                            showQuiz 
                                ? 'bg-blue-600/20 border border-blue-500/30' 
                                : !allCompleted
                                    ? 'opacity-50 cursor-not-allowed border border-transparent'
                                    : 'hover:bg-white/5 border border-transparent'
                        }`}
                    >
                        <div className="mt-1">
                            {lastAttempt?.passed ? (
                                <CheckCircle size={20} className="text-green-500" />
                            ) : allCompleted ? (
                                <Award size={20} className={showQuiz ? "text-blue-400" : "text-yellow-500"} />
                            ) : (
                                <Lock size={20} className="text-slate-600" />
                            )}
                        </div>
                        <div>
                            <p className={`font-medium ${showQuiz ? 'text-blue-400' : 'text-slate-300 group-hover:text-white'}`}>
                                {lastAttempt?.passed ? 'Certificado Disponível' : 'Teste Final & Certificado'}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                {lastAttempt?.passed ? 'Aprovado' : allCompleted ? 'Disponível' : 'Conclua todas as aulas para liberar'}
                            </p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CoursePlayer;
