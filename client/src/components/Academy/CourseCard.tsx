import React from 'react';
import { Lock, PlayCircle, Clock, BookOpen } from 'lucide-react';

interface CourseCardProps {
    course: any;
    userPlanLevel: number;
    onSelect: (courseId: string) => void;
    onUpgrade: (requiredPlan: string) => void;
}

const PLAN_LEVELS: Record<string, number> = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'BLACK': 3
};

const PLAN_COLORS: Record<string, string> = {
    'GUEST': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'ESSENTIAL': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'PRO': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'BLACK': 'bg-zinc-800/80 text-zinc-300 border-zinc-600'
};

export const CourseCard: React.FC<CourseCardProps> = ({ course, userPlanLevel, onSelect, onUpgrade }) => {
    const requiredLevel = PLAN_LEVELS[course.requiredPlan] || 0;
    const isPlanLocked = userPlanLevel < requiredLevel;
    const isGlobalLocked = course.isLocked;

    const handleClick = () => {
        if (isGlobalLocked) return;
        if (isPlanLocked) {
            onUpgrade(course.requiredPlan);
        } else {
            onSelect(course._id);
        }
    };

    const badgeColor = PLAN_COLORS[course.requiredPlan] || PLAN_COLORS['GUEST'];

    return (
        <div 
            className={`relative min-w-[280px] md:min-w-[340px] aspect-video rounded-lg overflow-hidden cursor-pointer group transition-all duration-500 hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-500/10 bg-[#0a0a0a] border border-white/5 flex flex-col ${isGlobalLocked ? 'opacity-60 grayscale cursor-not-allowed' : ''}`}
            onClick={handleClick}
        >
            {/* Background Image */}
            <div className="absolute inset-0 w-full h-full">
                <img 
                    src={course.thumbnail || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1000&auto=format&fit=crop'} 
                    alt={course.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                />
            </div>

            {/* Cinematic Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent opacity-70 group-hover:opacity-90 transition-opacity duration-500"></div>
            
            {/* Plan Badge */}
            <div className={`absolute top-3 left-3 px-2 py-0.5 rounded-full backdrop-blur-md border text-[9px] font-bold uppercase tracking-widest z-30 ${badgeColor}`}>
                {course.requiredPlan}
            </div>

            {/* Locked Overlay */}
            {isGlobalLocked && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <Lock className="text-white/80 mb-2" size={32} />
                    <span className="text-white font-bold uppercase tracking-widest text-[10px] bg-black/60 px-3 py-1 rounded-full border border-white/10">
                        Em Produção
                    </span>
                </div>
            )}

            {isPlanLocked && !isGlobalLocked && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/20 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Lock className="text-white/80 mb-2" size={24} />
                    <span className="text-white font-bold uppercase tracking-widest text-[10px]">
                        Upgrade Necessário
                    </span>
                </div>
            )}

            {/* Content (Bottom) */}
            <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col z-20">
                <h3 className="text-lg md:text-xl font-bold text-white mb-0.5 leading-tight drop-shadow-lg truncate">
                    {course.title}
                </h3>
                <p className="text-xs text-white/60 line-clamp-1 mb-2 drop-shadow-md font-medium max-w-[95%]">
                    {course.description}
                </p>

                {/* Meta */}
                <div className="flex items-center gap-3 text-[9px] text-white/40 font-bold uppercase tracking-widest">
                    <div className="flex items-center gap-1">
                        <BookOpen size={10} className="text-blue-500" />
                        <span>Trilha</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Clock size={10} className="text-blue-500" />
                        <span>{course.requiredPlan}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

