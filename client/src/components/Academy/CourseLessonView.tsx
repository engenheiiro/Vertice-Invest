import React from 'react';
import type { ComponentType } from 'react';
import { CheckCircle, Lock } from 'lucide-react';
import ReactPlayer from 'react-player';
import type { CourseLesson } from './coursePlayerRules';

interface PlayerProps {
    url: string;
    width: string;
    height: string;
    controls: boolean;
    playing: boolean;
    onProgress: (state: { played: number; playedSeconds?: number }) => void;
    onEnded: () => void;
    onError: (e: unknown) => void;
    config: { youtube: { playerVars: Record<string, unknown> } };
}

const Player = ReactPlayer as unknown as ComponentType<PlayerProps>;

interface VideoProps {
    lesson: CourseLesson;
    useNativeIframe: boolean;
    onToggle: () => void;
    onProgress: PlayerProps['onProgress'];
    onEnded: () => void;
    onPlayerError: (e: unknown) => void;
}

const LessonVideo = ({ lesson, useNativeIframe, onToggle, onProgress, onEnded, onPlayerError }: VideoProps) => (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl relative group">
        {!useNativeIframe ? (
            <Player
                key={lesson._id}
                url={`https://www.youtube.com/watch?v=${lesson.youtubeId}`}
                width="100%"
                height="100%"
                controls={true}
                playing={false}
                onProgress={onProgress}
                onEnded={onEnded}
                onError={onPlayerError}
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
                src={`https://www.youtube.com/embed/${lesson.youtubeId}?rel=0&origin=${window.location.origin}`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
            ></iframe>
        )}

        <button
            onClick={onToggle}
            className="absolute top-4 right-4 z-40 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
        >
            {useNativeIframe ? "Usar Player Avançado" : "Modo de Compatibilidade"}
        </button>
    </div>
);

const LessonInProduction = ({ onBack }: { onBack: () => void }) => (
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
                onClick={onBack}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm font-medium"
            >
                Ver outros cursos
            </button>
        </div>
    </div>
);

interface LessonViewProps extends Omit<VideoProps, 'lesson'> {
    lesson: CourseLesson | null;
    isCompleted: boolean;
    onMarkDone: () => void;
    onBack: () => void;
}

/** Aula em exibição: vídeo (ou aviso de conteúdo em produção) e descrição. */
export const CourseLessonView = ({ lesson, isCompleted, onMarkDone, onBack, ...video }: LessonViewProps) => (
    <>
        {lesson?.youtubeId ? <LessonVideo lesson={lesson} {...video} /> : <LessonInProduction onBack={onBack} />}

        {/* Lesson Info */}
        <div className="mt-8 flex justify-between items-start">
            <div className="flex-1">
                <h2 className="text-3xl font-bold mb-4">{lesson?.title}</h2>
                <p className="text-slate-400 leading-relaxed max-w-3xl mb-6">
                    {lesson?.description}
                </p>

                {!isCompleted && (
                    <button
                        onClick={onMarkDone}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 rounded-xl transition-all font-medium group"
                    >
                        <CheckCircle size={18} className="group-hover:scale-110 transition-transform" />
                        Marcar esta aula como concluída
                    </button>
                )}
            </div>
        </div>
    </>
);
