import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, ChevronRight, PlayCircle, ArrowLeft, BookOpen, Clock, Lock } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { CourseCard } from '../components/Academy/CourseCard';
import { useAuth } from '../contexts/AuthContext';

const PLAN_LEVELS: Record<string, number> = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'BLACK': 3
};

const LessonCard = ({ lesson, onClick, isLocked: propIsLocked }: { lesson: any, onClick: () => void, isLocked?: boolean }) => {
    const isLocked = true; // Bloqueio global para manutenção
    return (
        <div 
            className={`relative min-w-[260px] md:min-w-[280px] aspect-[2/3] rounded-xl overflow-hidden cursor-pointer group bg-[#0a0a0a] border border-white/5 flex flex-col transition-all duration-300 ${isLocked ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-500/10'}`}
            onClick={() => !isLocked && onClick()}
        >
        <div className="absolute inset-0 w-full h-full">
            <img 
                src={lesson.thumbnail || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1000&auto=format&fit=crop'} 
                alt={lesson.title}
                className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-700"
                referrerPolicy="no-referrer"
            />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent opacity-90"></div>
        
        {isLocked ? (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-black/60 text-white/60 border border-white/10 text-[10px] font-bold uppercase tracking-widest backdrop-blur-md flex items-center gap-1">
                <Lock size={12} />
                Bloqueado
            </div>
        ) : (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold uppercase tracking-widest backdrop-blur-md flex items-center gap-1">
                <PlayCircle size={12} />
                Assistir
            </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col z-20">
            <h3 className="text-xl font-bold text-white/90 mb-2 leading-tight drop-shadow-lg group-hover:text-blue-400 transition-colors">
                {lesson.title}
            </h3>
            <p className="text-sm text-white/50 line-clamp-2 mb-4 font-medium">
                {lesson.description}
            </p>
            <div className="flex items-center gap-4 text-xs text-white/30 font-medium">
                <div className="flex items-center gap-1.5">
                    <Clock size={14} />
                    <span>{Math.floor(lesson.duration / 60)} min</span>
                </div>
            </div>
            </div>
        </div>
    );
};

export const Courses = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
    const [courses, setCourses] = useState<any[]>([]);
    const [lessons, setLessons] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchCourses = async () => {
            try {
                setLoading(true);
                const token = localStorage.getItem('token');
                const res = await fetch('/api/academy/courses', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setCourses(data);
                } else {
                    setError('Erro ao carregar cursos.');
                }
            } catch (err) {
                console.error("Fetch courses error:", err);
                setError('Erro de conexão.');
            } finally {
                setLoading(false);
            }
        };
        fetchCourses();
    }, []);

    useEffect(() => {
        if (selectedCourseId) {
            const fetchCourseDetails = async () => {
                try {
                    const token = localStorage.getItem('token');
                    const res = await fetch(`/api/academy/courses/${selectedCourseId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setLessons(data.lessons);
                    }
                } catch (err) {
                    console.error("Fetch lessons error:", err);
                }
            };
            fetchCourseDetails();
        } else {
            setLessons([]);
        }
    }, [selectedCourseId]);

    const userPlanLevel = PLAN_LEVELS[user?.plan || 'GUEST'] || 0;
    const selectedCourse = courses.find(c => c._id === selectedCourseId);

    if (loading && courses.length === 0) {
        return (
            <div className="min-h-screen bg-[#02040a] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            
            {/* Hero Banner */}
            <div className="relative w-full h-[60vh] md:h-[70vh] flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0">
                    <img 
                        src={selectedCourse?.thumbnail || "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1920&auto=format&fit=crop"} 
                        alt="Hero" 
                        className="w-full h-full object-cover opacity-40 transition-all duration-1000"
                        referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#02040a] via-[#02040a]/80 to-transparent"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-[#02040a] via-[#02040a]/50 to-transparent"></div>
                </div>

                <div className="relative z-10 max-w-[1600px] w-full px-6 md:px-12 flex flex-col items-start">
                    {selectedCourseId && (
                        <button 
                            onClick={() => setSelectedCourseId(null)}
                            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8 group"
                        >
                            <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                            <span className="font-bold uppercase tracking-widest text-xs">Voltar ao Catálogo</span>
                        </button>
                    )}
                    <div className="flex items-center gap-2 text-blue-400 font-semibold tracking-wider uppercase text-sm mb-4">
                        <GraduationCap size={20} />
                        <span>{selectedCourseId ? "Trilha de Formação" : "Vértice Academy"}</span>
                    </div>
                    <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 max-w-2xl leading-tight">
                        {selectedCourse?.title || "Domine o mercado com a inteligência Vértice."}
                    </h1>
                    <p className="text-base md:text-lg text-slate-300 max-w-xl mb-8 leading-relaxed">
                        {selectedCourse?.description || "Trilhas de aprendizado masterclass, cobrindo desde Análise Fundamentalista até Macroeconomia Global e IA."}
                    </p>
                    <div className="flex items-center gap-4">
                        {!selectedCourseId ? (
                            <button 
                                className="px-8 py-4 bg-white/10 text-white font-bold rounded-full hover:bg-white/20 transition-colors backdrop-blur-md border border-white/10"
                                onClick={() => {
                                    const el = document.getElementById('catalog');
                                    el?.scrollIntoView({ behavior: 'smooth' });
                                }}
                            >
                                Explorar Trilhas
                            </button>
                        ) : (
                            <div className="flex items-center gap-4">
                                <div className="px-6 py-3 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-bold uppercase tracking-widest backdrop-blur-md">
                                    {lessons.length} Aulas Disponíveis
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <main id="catalog" className="max-w-[1600px] mx-auto px-6 md:px-12 pb-24 -mt-20 relative z-20">
                {/* Maintenance Banner */}
                <div className="mb-12 p-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 backdrop-blur-md flex flex-col md:flex-row items-center gap-6 text-center md:text-left">
                    <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0 animate-pulse">
                        <Lock size={32} />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-amber-500 mb-1">Área em Manutenção</h3>
                        <p className="text-amber-500/70 text-sm max-w-2xl">
                            Estamos atualizando nossas trilhas com conteúdos exclusivos e vídeos em alta definição. 
                            O acesso às aulas está temporariamente suspenso para garantir a melhor experiência de aprendizado. Voltaremos em breve!
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center">
                        {error}
                    </div>
                )}

                {!selectedCourseId ? (
                    <div className="space-y-16">
                        <div className="space-y-8">
                            <div className="flex flex-col gap-4">
                                <div className="space-y-2">
                                    <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                                        Trilha de Formação Inicial
                                        <ChevronRight className="text-blue-500 w-6 h-6" />
                                    </h2>
                                    <p className="text-slate-400 text-xs md:text-sm max-w-xl">
                                        Explore os fundamentos essenciais para se tornar um investidor de elite.
                                    </p>
                                </div>
                                
                                {/* Responsive Grid for Main Tracks */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                                    {courses.map(course => (
                                        <div key={course._id} className="w-full pointer-events-none opacity-60 grayscale">
                                            <CourseCard 
                                                course={course} 
                                                userPlanLevel={userPlanLevel} 
                                                onSelect={(id) => setSelectedCourseId(id)}
                                                onUpgrade={() => navigate('/subscription')}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-12">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                                Conteúdo da Trilha
                                <ChevronRight className="text-slate-500" />
                            </h2>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
                            {lessons.map((lesson, idx) => (
                                <LessonCard 
                                    key={idx} 
                                    lesson={lesson} 
                                    onClick={() => navigate(`/courses/${selectedCourseId}?lesson=${lesson._id}`)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <style dangerouslySetInnerHTML={{__html: `
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}} />
        </div>
    );
};

export default Courses;
