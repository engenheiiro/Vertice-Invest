import React from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { useCoursePlayer } from '../hooks/useCoursePlayer';
import { CourseLessonView } from '../components/Academy/CourseLessonView';
import { CourseQuizPanel } from '../components/Academy/CourseQuizPanel';
import { CourseSidebar } from '../components/Academy/CourseSidebar';

const CourseLoading = () => (
    <div className="min-h-screen bg-deep flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
    </div>
);

const CourseError = ({ error, onBack }: { error: string; onBack: () => void }) => (
    <div className="min-h-screen bg-deep flex flex-col items-center justify-center text-white p-6">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 max-w-md text-center">
            <Lock className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Acesso Restrito</h2>
            <p className="text-slate-400 mb-6">{error}</p>
            <button
                onClick={onBack}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors w-full"
            >
                Voltar para a Academia
            </button>
        </div>
    </div>
);

export const CoursePlayer = () => {
    const p = useCoursePlayer();

    if (p.loading) return <CourseLoading />;
    if (p.error) return <CourseError error={p.error} onBack={p.goToCourses} />;

    return (
        <div className="min-h-screen bg-deep text-white font-sans flex flex-col md:flex-row pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
            {/* Main Player Area */}
            <div className="flex-1 flex flex-col h-screen overflow-y-auto">
                {/* Header */}
                <div className="p-6 flex items-center gap-4 border-b border-white/5 bg-deep/80 backdrop-blur-md sticky top-0 z-30">
                    <button aria-label="Voltar aos cursos"
                        onClick={p.goToCourses}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold">{p.course?.title}</h1>
                        <p className="text-sm text-slate-400">{p.currentLesson?.title}</p>
                    </div>
                </div>

                {/* Player Container */}
                <div className="p-6 max-w-5xl mx-auto w-full flex-1">
                    {!p.showQuiz ? (
                        <CourseLessonView
                            lesson={p.currentLesson}
                            isCompleted={p.completedLessons.includes(p.currentLesson?._id as string)}
                            onMarkDone={p.markLessonDone}
                            onBack={p.goToCourses}
                            useNativeIframe={p.useNativeIframe}
                            onToggle={p.toggleNativeIframe}
                            onProgress={p.handleProgress}
                            onEnded={p.handleVideoEnded}
                            onPlayerError={p.handlePlayerError}
                        />
                    ) : (
                        <CourseQuizPanel
                            quiz={p.quiz}
                            quizAnswers={p.quizAnswers}
                            quizSubmitting={p.quizSubmitting}
                            quizLoading={p.quizLoading}
                            quizError={p.quizError}
                            quizResult={p.quizResult}
                            downloading={p.downloading}
                            onSelect={p.selectAnswer}
                            onSubmit={p.handleQuizSubmit}
                            onStart={p.fetchQuiz}
                            onRetry={p.retryQuiz}
                            onDownload={p.handleDownloadCertificate}
                        />
                    )}
                </div>
            </div>

            {/* Sidebar - Lesson List */}
            <CourseSidebar
                lessons={p.lessons}
                currentLessonId={p.currentLesson?._id}
                completedLessons={p.completedLessons}
                showQuiz={p.showQuiz}
                allCompleted={p.allCompleted}
                lastAttempt={p.lastAttempt}
                onSelectLesson={p.handleLessonSelect}
                onTestClick={p.handleTestButtonClick}
            />
        </div>
    );
};

export default CoursePlayer;
