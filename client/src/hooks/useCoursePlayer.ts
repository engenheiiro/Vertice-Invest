import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { authService } from '../services/auth';
import { getErrorMessage } from '../utils/errorMessages';
import {
    areAllCompleted,
    completedIdsFrom,
    emptyAnswers,
    passedAttemptResult,
    pickInitialLesson,
    withAnswer,
} from '../components/Academy/coursePlayerRules';
import type { CourseLesson, CourseQuiz, QuizAttempt, QuizResult } from '../components/Academy/coursePlayerRules';

type Setter<T> = Dispatch<SetStateAction<T>>;
type AddToast = ReturnType<typeof useToast>['addToast'];

interface CourseSetters {
    setCourse: Setter<{ title?: string } | null>;
    setLessons: Setter<CourseLesson[]>;
    setCurrentLesson: Setter<CourseLesson | null>;
    setCompletedLessons: Setter<string[]>;
    setLastAttempt: Setter<QuizAttempt | null>;
}

/** Curso e aulas; falha do servidor vira exceção (a tela mostra acesso restrito). */
async function loadCourse(courseId: string | undefined, lessonId: string | null, s: CourseSetters) {
    // authService.api renova o token num 401 (o fetch cru de antes virava "Erro ao carregar curso").
    const courseRes = await authService.api(`/api/academy/courses/${courseId}`);
    if (!courseRes.ok) {
        const errData = await courseRes.json();
        throw new Error(errData.message || 'Erro ao carregar curso');
    }
    const data = await courseRes.json();
    s.setCourse(data.course);
    s.setLessons(data.lessons);
    if (data.lessons.length > 0) s.setCurrentLesson(pickInitialLesson(data.lessons, lessonId));
}

/** Progresso do usuário; resposta recusada deixa o progresso vazio. */
async function loadProgress(courseId: string, s: CourseSetters) {
    const progressRes = await authService.api(`/api/academy/progress/${courseId}`);
    if (!progressRes.ok) return;
    const data = await progressRes.json();
    s.setCompletedLessons(completedIdsFrom(data.progress));
    if (data.quizAttempts && data.quizAttempts.length > 0) s.setLastAttempt(data.quizAttempts[0]);
}

function useCourseData(courseId: string | undefined, searchParams: URLSearchParams) {
    const [course, setCourse] = useState<{ title?: string } | null>(null);
    const [lessons, setLessons] = useState<CourseLesson[]>([]);
    const [currentLesson, setCurrentLesson] = useState<CourseLesson | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [completedLessons, setCompletedLessons] = useState<string[]>([]);
    const [lastAttempt, setLastAttempt] = useState<QuizAttempt | null>(null);

    useEffect(() => {
        const setters = { setCourse, setLessons, setCurrentLesson, setCompletedLessons, setLastAttempt };
        const fetchCourseData = async () => {
            try {
                setLoading(true);
                await loadCourse(courseId, searchParams.get('lesson'), setters);
                if (courseId) await loadProgress(courseId, setters);
            } catch (error) {
                console.error('Error fetching course data:', error);
                setError('Erro ao carregar curso. Tente recarregar a página.');
            } finally {
                setLoading(false);
            }
        };
        fetchCourseData();
    }, [courseId, searchParams]);

    return {
        course, lessons, currentLesson, setCurrentLesson, loading, error,
        completedLessons, setCompletedLessons, lastAttempt, setLastAttempt,
    };
}

function useCourseQuiz(courseId: string | undefined, addToast: AddToast, setLastAttempt: Setter<QuizAttempt | null>) {
    const [quiz, setQuiz] = useState<CourseQuiz | null>(null);
    const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
    const [quizSubmitting, setQuizSubmitting] = useState(false);
    const [quizLoading, setQuizLoading] = useState(false);
    const [quizError, setQuizError] = useState('');
    const [quizResult, setQuizResult] = useState<QuizResult | null>(null);

    const fetchQuiz = async () => {
        try {
            setQuizLoading(true);
            setQuizError('');
            const res = await authService.api(`/api/academy/quiz/${courseId}`);
            if (res.ok) {
                const data = await res.json();
                setQuiz(data);
                setQuizAnswers(emptyAnswers(data.questions.length));
            } else {
                const errData = await res.json();
                setQuizError(errData.message || 'Erro ao carregar o quiz.');
            }
        } catch (err) {
            console.error('Erro ao buscar quiz:', err);
            setQuizError('Erro de conexão ao carregar o quiz.');
        } finally {
            setQuizLoading(false);
        }
    };

    const handleQuizSubmit = async () => {
        if (quizAnswers.includes(-1)) {
            addToast('Por favor, responda todas as perguntas.', 'info');
            return;
        }
        setQuizSubmitting(true);
        setQuizError('');
        try {
            const res = await authService.api('/api/academy/quiz/submit', {
                method: 'POST',
                body: JSON.stringify({ courseId, answers: quizAnswers }),
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
            console.error('Erro ao enviar quiz:', err);
            setQuizError('Erro de conexão ao enviar o quiz.');
        } finally {
            setQuizSubmitting(false);
        }
    };

    const selectAnswer = (questionIdx: number, optionIdx: number) => setQuizAnswers(withAnswer(quizAnswers, questionIdx, optionIdx));

    const retryQuiz = () => {
        setQuizResult(null);
        setQuizAnswers(emptyAnswers(quiz ? quiz.questions.length : 0));
    };

    return {
        quiz, quizAnswers, quizSubmitting, quizLoading, quizError, quizResult, setQuizResult,
        fetchQuiz, handleQuizSubmit, selectAnswer, retryQuiz,
    };
}

async function saveCompletion(lessonId: string, watchTime: number | undefined) {
    return authService.api('/api/academy/progress', {
        method: 'POST',
        body: JSON.stringify({ lessonId, watchTime, completed: true }),
    });
}

function useCertificateDownload(courseId: string | undefined, addToast: AddToast) {
    const [downloading, setDownloading] = useState(false);

    const handleDownloadCertificate = async () => {
        setDownloading(true);
        try {
            const response = await authService.api(`/api/academy/certificate/${courseId}`);
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
        } catch (err: unknown) {
            console.error(err);
            addToast(`Erro ao baixar certificado: ${getErrorMessage(err, 'Verifique se você concluiu todas as aulas.')}`, 'error');
        } finally {
            setDownloading(false);
        }
    };

    return { downloading, handleDownloadCertificate };
}

/** Estado e ações do player de curso: aulas, progresso, teste final e certificado. */
export function useCoursePlayer() {
    const { courseId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { addToast } = useToast();

    const data = useCourseData(courseId, searchParams);
    const quizState = useCourseQuiz(courseId, addToast, data.setLastAttempt);
    const certificate = useCertificateDownload(courseId, addToast);
    const [showQuiz, setShowQuiz] = useState(false);
    const [useNativeIframe, setUseNativeIframe] = useState(true);

    const { lessons, currentLesson, completedLessons, setCompletedLessons, lastAttempt } = data;
    const { quiz, fetchQuiz, setQuizResult } = quizState;
    const allCompleted = areAllCompleted(lessons, completedLessons);

    const handleLessonSelect = (lesson: CourseLesson) => {
        data.setCurrentLesson(lesson);
        setSearchParams({ lesson: lesson._id });
        setShowQuiz(false);
        setQuizResult(null);
    };

    const openQuiz = () => {
        setShowQuiz(true);
        if (!quiz) fetchQuiz();
    };

    const handleVideoEnded = () => {
        const currentIndex = lessons.findIndex((l) => l._id === currentLesson?._id);
        if (currentIndex < lessons.length - 1) {
            handleLessonSelect(lessons[currentIndex + 1]);
        } else if (allCompleted) {
            openQuiz();
        }
    };

    const handleTestButtonClick = () => {
        if (!allCompleted) return;
        if (lastAttempt?.passed) {
            setShowQuiz(true);
            setQuizResult(passedAttemptResult(lastAttempt));
        } else {
            openQuiz();
        }
    };

    const addCompleted = (lessonId: string) =>
        setCompletedLessons((prev) => (prev.includes(lessonId) ? prev : [...prev, lessonId]));

    const handleProgress = async (state: { played: number; playedSeconds?: number }) => {
        if (!currentLesson || !user) return;
        // Conclui a aula quando 90% foi assistido.
        const watchedEnough = state.played > 0.9 && !completedLessons.includes(currentLesson._id);
        if (!watchedEnough) return;
        try {
            const res = await saveCompletion(currentLesson._id, state.playedSeconds || 0);
            if (res.ok) addCompleted(currentLesson._id);
        } catch (err) {
            console.error('Erro ao salvar progresso automático:', err);
        }
    };

    const markLessonDone = async () => {
        try {
            // Curso sem aulas também mostra o botão: sem aula, ler `_id` lança e cai no catch, sem gravar nada.
            const lesson = currentLesson as CourseLesson;
            await saveCompletion(lesson._id, lesson.duration);
            setCompletedLessons((prev) => [...prev, lesson._id]);
        } catch (err) {
            console.error('Erro ao salvar progresso:', err);
        }
    };

    const handlePlayerError = (e: unknown) => {
        console.error('ReactPlayer Error:', e);
        setUseNativeIframe(true);
    };

    return {
        ...data, ...quizState, ...certificate, allCompleted, showQuiz, useNativeIframe,
        goToCourses: () => navigate('/courses'),
        toggleNativeIframe: () => setUseNativeIframe(!useNativeIframe),
        handleLessonSelect, handleVideoEnded, handleTestButtonClick, handleProgress, markLessonDone, handlePlayerError,
    };
}
