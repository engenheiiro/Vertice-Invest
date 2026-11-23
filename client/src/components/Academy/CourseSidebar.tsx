import React from 'react';
import { Award, CheckCircle, Circle, Lock, PlayCircle } from 'lucide-react';
import { isLessonLocked } from './coursePlayerRules';
import type { CourseLesson, QuizAttempt } from './coursePlayerRules';

const ACTIVE = 'bg-blue-600/20 border border-blue-500/30';
const LOCKED = 'opacity-50 cursor-not-allowed border border-transparent';
const IDLE = 'hover:bg-white/5 border border-transparent';

const stateClass = (isActive: boolean, isLocked: boolean) => {
    if (isActive) return ACTIVE;
    return isLocked ? LOCKED : IDLE;
};

interface LessonItemProps {
    lesson: CourseLesson;
    idx: number;
    isActive: boolean;
    isCompleted: boolean;
    isLocked: boolean;
    onSelect: (lesson: CourseLesson) => void;
}

const LessonIcon = ({ isActive, isCompleted, isLocked }: Pick<LessonItemProps, 'isActive' | 'isCompleted' | 'isLocked'>) => {
    if (isCompleted) return <CheckCircle size={20} className="text-green-500" />;
    if (isLocked) return <Lock size={20} className="text-slate-600" />;
    if (isActive) return <PlayCircle size={20} className="text-blue-400" />;
    return <Circle size={20} className="text-slate-600 group-hover:text-slate-400" />;
};

const LessonItem = ({ lesson, idx, isActive, isCompleted, isLocked, onSelect }: LessonItemProps) => (
    <button
        onClick={() => !isLocked && onSelect(lesson)}
        disabled={isLocked}
        className={`w-full text-left p-4 rounded-xl transition-all flex gap-4 group ${stateClass(isActive, isLocked)}`}
    >
        <div className="mt-1">
            <LessonIcon isActive={isActive} isCompleted={isCompleted} isLocked={isLocked} />
        </div>
        <div>
            <p className={`font-medium ${isActive ? 'text-blue-400' : 'text-slate-300 group-hover:text-white'}`}>
                {idx + 1}. {lesson.title}
            </p>
            <p className="text-xs text-slate-500 mt-1">
                {Math.floor((lesson.duration as number) / 60)} min
            </p>
        </div>
    </button>
);

interface FinalTestProps {
    showQuiz: boolean;
    allCompleted: boolean;
    passed: boolean;
    onClick: () => void;
}

const FinalTestIcon = ({ showQuiz, allCompleted, passed }: Omit<FinalTestProps, 'onClick'>) => {
    if (passed) return <CheckCircle size={20} className="text-green-500" />;
    if (allCompleted) return <Award size={20} className={showQuiz ? "text-blue-400" : "text-yellow-500"} />;
    return <Lock size={20} className="text-slate-600" />;
};

const finalTestStatus = (passed: boolean, allCompleted: boolean) => {
    if (passed) return 'Aprovado';
    return allCompleted ? 'Disponível' : 'Conclua todas as aulas para liberar';
};

const FinalTestButton = ({ showQuiz, allCompleted, passed, onClick }: FinalTestProps) => (
    <button
        onClick={onClick}
        disabled={!allCompleted}
        className={`w-full mt-4 text-left p-4 rounded-xl transition-all flex gap-4 group ${stateClass(showQuiz, !allCompleted)}`}
    >
        <div className="mt-1">
            <FinalTestIcon showQuiz={showQuiz} allCompleted={allCompleted} passed={passed} />
        </div>
        <div>
            <p className={`font-medium ${showQuiz ? 'text-blue-400' : 'text-slate-300 group-hover:text-white'}`}>
                {passed ? 'Certificado Disponível' : 'Teste Final & Certificado'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
                {finalTestStatus(passed, allCompleted)}
            </p>
        </div>
    </button>
);

interface SidebarProps {
    lessons: CourseLesson[];
    currentLessonId: string | undefined;
    completedLessons: string[];
    showQuiz: boolean;
    allCompleted: boolean;
    lastAttempt: QuizAttempt | null;
    onSelectLesson: (lesson: CourseLesson) => void;
    onTestClick: () => void;
}

/** Lista de aulas com a trava sequencial e o botão do teste final. */
export const CourseSidebar = ({
    lessons, currentLessonId, completedLessons, showQuiz, allCompleted, lastAttempt, onSelectLesson, onTestClick,
}: SidebarProps) => (
    <div className="w-full md:w-96 bg-slate-900/50 border-l border-white/5 h-screen overflow-y-auto flex flex-col">
        <div className="p-6 border-b border-white/5 sticky top-0 bg-slate-900/90 backdrop-blur-md z-10">
            <h3 className="text-lg font-bold">Conteúdo do Curso</h3>
            <p className="text-sm text-slate-400 mt-1">{lessons.length} aulas</p>
        </div>

        <div className="flex-1 p-4 space-y-2">
            {lessons.map((lesson, idx) => (
                <LessonItem
                    key={lesson._id}
                    lesson={lesson}
                    idx={idx}
                    isActive={currentLessonId === lesson._id && !showQuiz}
                    isCompleted={completedLessons.includes(lesson._id)}
                    isLocked={isLessonLocked(lessons, idx, completedLessons)}
                    onSelect={onSelectLesson}
                />
            ))}

            {/* Prova Final & Certificado Button */}
            <FinalTestButton showQuiz={showQuiz} allCompleted={allCompleted} passed={!!lastAttempt?.passed} onClick={onTestClick} />
        </div>
    </div>
);
