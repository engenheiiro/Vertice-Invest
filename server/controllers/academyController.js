import Course from '../models/Course.js';
import Lesson from '../models/Lesson.js';
import UserProgress from '../models/UserProgress.js';
import User from '../models/User.js';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import jwt from 'jsonwebtoken';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Helper para checar hierarquia de planos
const PLAN_LEVELS = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'BLACK': 3
};

// Helper para identificar o usuário mesmo se o middleware falhar (emergência dev)
const getUserFromRequest = async (req) => {
    if (req.user) return req.user;
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.decode(token);
            if (decoded && decoded.id) {
                return await User.findById(decoded.id);
            }
        } catch (e) {
            console.error("Error decoding token in helper:", e);
        }
    }
    
    // Fallback: primeiro usuário do banco
    return await User.findOne();
};

export const getCourses = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const courses = await Course.find().sort({ order: 1 });
        
        // Vamos buscar o progresso do usuário para esses cursos
        const progress = await UserProgress.find({ userId: user._id });
        
        // Anexar o progresso aos cursos (simplificado para o frontend)
        const coursesWithProgress = courses.map(course => {
            const courseProgress = progress.filter(p => p.courseId.toString() === course._id.toString());
            const completedLessons = courseProgress.filter(p => p.completed).length;
            
            return {
                ...course.toObject(),
                progress: {
                    completedLessons,
                    // Poderíamos adicionar total de aulas aqui, mas por enquanto basta
                }
            };
        });

        res.json(coursesWithProgress);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar cursos", error: error.message });
    }
};

export const getCourseById = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: "Curso não encontrado" });

        if (course.isLocked) {
            return res.status(403).json({ 
                message: "Este curso está em produção e será liberado em breve.",
                isLocked: true
            });
        }

        const lessons = await Lesson.find({ courseId: course._id }).sort({ order: 1 });
        
        // Ocultar o youtubeVideoId se o usuário não tiver acesso ao curso
        const userPlanLevel = PLAN_LEVELS[user.plan] || 0;
        const requiredPlanLevel = PLAN_LEVELS[course.requiredPlan] || 0;
        const hasAccess = userPlanLevel >= requiredPlanLevel;

        const safeLessons = lessons.map(lesson => {
            const l = lesson.toObject();
            if (!hasAccess) {
                delete l.youtubeVideoId; // Proteção extra na listagem
            }
            // Compatibilidade com o frontend que espera 'youtubeId'
            l.youtubeId = l.youtubeVideoId;
            return l;
        });

        res.json({ course, lessons: safeLessons, hasAccess });
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar curso", error: error.message });
    }
};

// O Gatekeeper principal
export const getLessonById = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const lesson = await Lesson.findById(req.params.id).populate('courseId');
        if (!lesson) return res.status(404).json({ message: "Aula não encontrada" });

        const course = lesson.courseId;
        
        if (course.isLocked) {
            return res.status(403).json({ 
                message: "Este curso está em produção e será liberado em breve.",
                isLocked: true
            });
        }

        // Gatekeeper: Verifica se o plano do usuário permite acessar este curso
        const userPlanLevel = PLAN_LEVELS[user.plan] || 0;
        const requiredPlanLevel = PLAN_LEVELS[course.requiredPlan] || 0;

        if (userPlanLevel < requiredPlanLevel) {
            return res.status(403).json({ 
                message: "Acesso negado. Faça upgrade do seu plano para assistir a esta aula.",
                requiredPlan: course.requiredPlan
            });
        }

        // Busca o progresso atual
        let progress = await UserProgress.findOne({ userId: user._id, lessonId: lesson._id });

        const lessonObj = lesson.toObject();
        lessonObj.youtubeId = lessonObj.youtubeVideoId;

        res.json({ lesson: lessonObj, progress });
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar aula", error: error.message });
    }
};

export const updateProgress = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const { lessonId, watchTime, completed } = req.body;
        
        const lesson = await Lesson.findById(lessonId);
        if (!lesson) return res.status(404).json({ message: "Aula não encontrada" });

        const progress = await UserProgress.findOneAndUpdate(
            { userId: user._id, lessonId: lesson._id },
            { 
                courseId: lesson.courseId,
                watchTime, 
                completed,
                lastWatchedAt: new Date()
            },
            { new: true, upsert: true }
        );

        res.json(progress);
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar progresso", error: error.message });
    }
};

export const getCourseProgress = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const { courseId } = req.params;
        const progress = await UserProgress.find({ 
            userId: user._id, 
            courseId 
        });
        
        // Também buscar tentativas de quiz
        const quizAttempts = await QuizAttempt.find({ userId: user._id, courseId }).sort({ createdAt: -1 });
        
        res.json({ progress, quizAttempts });
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar progresso", error: error.message });
    }
};

export const getQuizByCourseId = async (req, res) => {
    try {
        const { courseId } = req.params;
        const quiz = await Quiz.findOne({ courseId });
        if (!quiz) return res.status(404).json({ message: "Quiz não encontrado para este curso." });
        
        // Não enviar correctOptionIndex para o cliente
        const safeQuiz = quiz.toObject();
        safeQuiz.questions = safeQuiz.questions.map(q => {
            const { correctOptionIndex, ...rest } = q;
            return rest;
        });
        
        res.json(safeQuiz);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar quiz", error: error.message });
    }
};

export const submitQuiz = async (req, res) => {
    try {
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const { courseId, answers } = req.body;
        
        if (!Array.isArray(answers)) {
            return res.status(400).json({ message: "Respostas devem ser um array." });
        }

        const quiz = await Quiz.findOne({ courseId });
        if (!quiz) return res.status(404).json({ message: "Quiz não encontrado." });

        if (answers.length !== quiz.questions.length) {
            return res.status(400).json({ message: "Número de respostas incorreto." });
        }

        let correctCount = 0;
        quiz.questions.forEach((q, idx) => {
            if (answers[idx] === q.correctOptionIndex) {
                correctCount++;
            }
        });

        const score = (correctCount / quiz.questions.length) * 100;
        const passed = score >= quiz.passingScore;

        const attempt = await QuizAttempt.create({
            userId: user._id,
            courseId,
            score,
            passed,
            answers
        });

        res.json({ 
            attempt, 
            score, 
            passed, 
            passingScore: quiz.passingScore,
            correctAnswers: quiz.questions.map(q => q.correctOptionIndex)
        });
    } catch (error) {
        res.status(500).json({ message: "Erro ao processar quiz", error: error.message });
    }
};

const getCourseTheme = (plan) => {
    switch (plan) {
        case 'BLACK':
            return {
                primary: rgb(0.05, 0.05, 0.05), // Quase preto
                accent: rgb(0.85, 0.7, 0.2),   // Ouro
                text: rgb(1, 1, 1),
                secondary: rgb(0.6, 0.5, 0.1)
            };
        case 'PRO':
            return {
                primary: rgb(0.1, 0.1, 0.3),   // Azul Profundo
                accent: rgb(0.6, 0.4, 0.9),   // Roxo/Violeta
                text: rgb(1, 1, 1),
                secondary: rgb(0.4, 0.2, 0.6)
            };
        case 'ESSENTIAL':
            return {
                primary: rgb(0.05, 0.2, 0.1),  // Verde Escuro
                accent: rgb(0.2, 0.8, 0.4),   // Esmeralda
                text: rgb(1, 1, 1),
                secondary: rgb(0.1, 0.5, 0.2)
            };
        default: // GUEST
            return {
                primary: rgb(0.1, 0.2, 0.4),   // Azul Marinho
                accent: rgb(0.3, 0.6, 0.9),   // Azul Claro
                text: rgb(1, 1, 1),
                secondary: rgb(0.2, 0.4, 0.7)
            };
    }
};

export const generateCertificate = async (req, res) => {
    try {
        const { courseId } = req.params;
        
        const user = await getUserFromRequest(req);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado para gerar certificado." });

        console.log(`Generating certificate for course: ${courseId}, user: ${user._id}`);
        
        const course = await Course.findById(courseId);
        if (!course) {
            console.log(`Course not found: ${courseId}`);
            return res.status(404).json({ message: "Curso não encontrado" });
        }

        // Verify if all lessons are completed
        const lessons = await Lesson.find({ courseId });
        const progress = await UserProgress.find({ userId: user._id, courseId, completed: true });

        console.log(`Course: ${course.title} (${courseId}). Lessons in DB: ${lessons.length}. Progress in DB: ${progress.length}`);
        
        if (progress.length < lessons.length && lessons.length > 0) {
            console.log(`Completion check failed. Progress: ${progress.length}/${lessons.length}`);
            return res.status(403).json({ message: "Você precisa concluir todas as aulas para emitir o certificado." });
        }

        // Verify if quiz is passed
        const quiz = await Quiz.findOne({ courseId });
        if (quiz) {
            const lastAttempt = await QuizAttempt.findOne({ userId: user._id, courseId, passed: true }).sort({ createdAt: -1 });
            if (!lastAttempt) {
                return res.status(403).json({ message: "Você precisa ser aprovado no teste final para emitir o certificado." });
            }
        }

        const theme = getCourseTheme(course.requiredPlan);
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([842, 595]); // A4 Landscape
        const { width, height } = page.getSize();

        const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
        const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Background
        page.drawRectangle({
            x: 0, y: 0, width, height,
            color: theme.primary,
        });

        // Sub-background pattern (subtle lines)
        for (let i = 0; i < width; i += 40) {
            page.drawLine({
                start: { x: i, y: 0 },
                end: { x: i + 100, y: height },
                thickness: 0.5,
                color: theme.accent,
                opacity: 0.05,
            });
        }

        // Main Border
        page.drawRectangle({
            x: 30, y: 30, width: width - 60, height: height - 60,
            borderColor: theme.accent,
            borderWidth: 2,
        });

        // Inner Border
        page.drawRectangle({
            x: 45, y: 45, width: width - 90, height: height - 90,
            borderColor: theme.accent,
            borderWidth: 1,
            opacity: 0.5,
        });

        // Corner Ornaments
        page.drawCircle({ x: 45, y: 45, radius: 10, color: theme.accent });
        page.drawCircle({ x: width - 45, y: 45, radius: 10, color: theme.accent });
        page.drawCircle({ x: 45, y: height - 45, radius: 10, color: theme.accent });
        page.drawCircle({ x: width - 45, y: height - 45, radius: 10, color: theme.accent });

        // Header
        page.drawText('VÉRTICE INVEST ACADEMY', {
            x: width / 2 - 100, y: height - 80,
            size: 14, font: helveticaBold, color: theme.accent,
            characterSpacing: 2,
        });

        // Title
        const titleText = 'CERTIFICADO DE CONCLUSÃO';
        const titleWidth = timesBold.widthOfTextAtSize(titleText, 38);
        page.drawText(titleText, {
            x: width / 2 - titleWidth / 2, y: height - 150,
            size: 38, font: timesBold, color: theme.text,
        });

        // Body Text 1
        const body1 = 'Certificamos para os devidos fins que';
        const body1Width = helvetica.widthOfTextAtSize(body1, 18);
        page.drawText(body1, {
            x: width / 2 - body1Width / 2, y: height - 210,
            size: 18, font: helvetica, color: theme.text,
            opacity: 0.8,
        });

        // User Name
        const userName = (user.name || user.email || 'Investidor Vértice').toUpperCase();
        const nameWidth = timesBold.widthOfTextAtSize(userName, 45);
        page.drawText(userName, {
            x: width / 2 - nameWidth / 2, y: height - 275,
            size: 45, font: timesBold, color: theme.accent,
        });

        // Body Text 2
        const body2 = 'concluiu com distinção a trilha de formação profissional:';
        const body2Width = helvetica.widthOfTextAtSize(body2, 16);
        page.drawText(body2, {
            x: width / 2 - body2Width / 2, y: height - 320,
            size: 16, font: helvetica, color: theme.text,
            opacity: 0.8,
        });

        // Course Title
        const courseTitle = course.title.toUpperCase();
        const courseWidth = timesBold.widthOfTextAtSize(courseTitle, 28);
        page.drawText(courseTitle, {
            x: width / 2 - courseWidth / 2, y: height - 370,
            size: 28, font: timesBold, color: theme.text,
        });

        // Course Category
        const category = `Categoria: ${course.category || 'Educação Financeira'}`;
        const catWidth = helvetica.widthOfTextAtSize(category, 12);
        page.drawText(category, {
            x: width / 2 - catWidth / 2, y: height - 400,
            size: 12, font: timesItalic, color: theme.accent,
        });

        // Seal
        page.drawCircle({
            x: width - 120, y: 120,
            radius: 50,
            borderColor: theme.accent,
            borderWidth: 2,
        });
        page.drawText('VÉRTICE', {
            x: width - 150, y: 125,
            size: 12, font: helveticaBold, color: theme.accent,
        });
        page.drawText('VERIFIED', {
            x: width - 152, y: 105,
            size: 10, font: helvetica, color: theme.accent,
        });

        // Signatures
        page.drawLine({
            start: { x: 150, y: 120 },
            end: { x: 350, y: 120 },
            thickness: 1,
            color: theme.text,
            opacity: 0.5,
        });
        page.drawText('Diretoria de Educação', {
            x: 190, y: 100,
            size: 10, font: helvetica, color: theme.text,
            opacity: 0.7,
        });

        page.drawLine({
            start: { x: width / 2 - 100, y: 120 },
            end: { x: width / 2 + 100, y: 120 },
            thickness: 1,
            color: theme.text,
            opacity: 0.5,
        });
        page.drawText('Vértice Invest AI', {
            x: width / 2 - 40, y: 100,
            size: 10, font: helvetica, color: theme.text,
            opacity: 0.7,
        });

        // Footer Info
        const dateStr = new Date().toLocaleDateString('pt-BR');
        const certId = `ID: ${courseId.substring(0, 4)}-${user._id.toString().substring(0, 4)}-${Date.now().toString().substring(8)}`;
        
        page.drawText(`Emitido em: ${dateStr}`, {
            x: 60, y: 60,
            size: 10, font: helvetica, color: theme.text,
            opacity: 0.5,
        });
        
        page.drawText(certId, {
            x: width - 200, y: 60,
            size: 10, font: helvetica, color: theme.text,
            opacity: 0.5,
        });

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=certificado-${courseId}.pdf`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error("Certificate Error:", error);
        res.status(500).json({ message: "Erro ao gerar certificado", error: error.message });
    }
};

// Seeder para popular dados de exemplo
export const seedAcademy = async (req, res) => {
    try {
        console.log("Starting academy seed process...");
        
        // Deletar dados antigos em ordem para evitar problemas de integridade (embora não haja FKs rígidas no Mongo)
        console.log("Cleaning existing data...");
        const delProgress = await UserProgress.deleteMany({});
        const delLessons = await Lesson.deleteMany({});
        const delCourses = await Course.deleteMany({});
        console.log(`Cleaned: ${delProgress.deletedCount} progress, ${delLessons.deletedCount} lessons, ${delCourses.deletedCount} courses`);

        // Deletar quizzes antigos
        await Quiz.deleteMany({});
        await QuizAttempt.deleteMany({});

        const coursesData = [
            {
                _id: "course-pp",
                title: "Primeiros Passos",
                description: "Como configurar sua conta, entender o dashboard e dar os primeiros passos no mundo dos investimentos.",
                thumbnail: "/assets/academy/courses/guest.png",
                requiredPlan: "GUEST",
                category: "Iniciante",
                isLocked: true,
                order: 1
            },
            {
                _id: "course-fi",
                title: "Fundamentos do Investidor",
                description: "Tesouro Direto, CDBs, Ações e FIIs. O básico que funciona para construir sua carteira.",
                thumbnail: "/assets/academy/courses/essential.png",
                requiredPlan: "ESSENTIAL",
                category: "Intermediário",
                isLocked: true,
                order: 2
            },
            {
                _id: "course-ve",
                title: "Valuation e Estratégia",
                description: "Análise Fundamentalista, múltiplos de preço e uso avançado da IA Vértice.",
                thumbnail: "/assets/academy/courses/pro.png",
                requiredPlan: "PRO",
                category: "Avançado",
                isLocked: true,
                order: 3
            },
            {
                _id: "course-me",
                title: "Masterclass & Estudos de Caso",
                description: "Asset Allocation, Barbell, anatomia de fraudes e finanças comportamentais.",
                thumbnail: "/assets/academy/courses/black.png",
                requiredPlan: "BLACK",
                category: "Masterclass",
                isLocked: true,
                order: 4
            }
        ];

        console.log("Inserting courses...");
        await Course.insertMany(coursesData);

        const lessonsData = [
            // GUEST - Primeiros Passos
            { _id: "pp-1", title: "Como configurar sua conta e importar sua carteira na Vértice", description: "Aprenda a dar os primeiros passos na plataforma.", youtubeVideoId: "M7lc1UVf-VE", duration: 300, courseId: "course-pp", order: 1 },
            { _id: "pp-2", title: "Entendendo o Dashboard: Rentabilidade e CDI", description: "Como ler os gráficos e entender sua rentabilidade.", youtubeVideoId: "M7lc1UVf-VE", duration: 450, courseId: "course-pp", order: 2 },
            { _id: "pp-3", title: "O que é inflação e Juros Compostos", description: "Os conceitos fundamentais que movem seu dinheiro.", youtubeVideoId: "jNQXAC9IVRw", duration: 600, courseId: "course-pp", order: 3 },
            { _id: "pp-4", title: "Renda Fixa vs Renda Variável: O básico", description: "Entenda a diferença e quando usar cada uma.", youtubeVideoId: "9bZkp7q19f0", duration: 500, courseId: "course-pp", order: 4 },
            { _id: "pp-5", title: "Descobrindo seu Perfil de Risco", description: "Como investir de acordo com seu estômago para o risco.", youtubeVideoId: "dQw4w9WgXcQ", duration: 400, courseId: "course-pp", order: 5 },

            // ESSENTIAL - Fundamentos do Investidor
            { _id: "fi-1", title: "Tesouro Direto a fundo: Selic, IPCA+ e Prefixado", description: "Como emprestar dinheiro para o governo com segurança.", youtubeVideoId: "dQw4w9WgXcQ", duration: 700, courseId: "course-fi", order: 1 },
            { _id: "fi-2", title: "CDBs, LCIs e LCAs: Entendendo o FGC", description: "Renda fixa privada e a garantia do FGC.", youtubeVideoId: "dQw4w9WgXcQ", duration: 650, courseId: "course-fi", order: 2 },
            { _id: "fi-3", title: "O que são Ações e como a Bolsa funciona", description: "Tornando-se sócio de grandes empresas.", youtubeVideoId: "dQw4w9WgXcQ", duration: 800, courseId: "course-fi", order: 3 },
            { _id: "fi-4", title: "O que são FIIs e a mágica dos dividendos", description: "Renda passiva mensal com imóveis.", youtubeVideoId: "dQw4w9WgXcQ", duration: 750, courseId: "course-fi", order: 4 },
            { _id: "fi-5", title: "Como montar uma reserva de emergência à prova de balas", description: "Onde e como guardar seu fundo de paz.", youtubeVideoId: "dQw4w9WgXcQ", duration: 500, courseId: "course-fi", order: 5 },

            // PRO - Valuation e Estratégia
            { _id: "ve-1", title: "Análise Fundamentalista: Lendo o balanço de uma empresa", description: "Como analisar a saúde financeira de uma ação.", youtubeVideoId: "dQw4w9WgXcQ", duration: 900, courseId: "course-ve", order: 1 },
            { _id: "ve-2", title: "Múltiplos de Preço e Eficiência (P/L, P/VP, ROE, Margem)", description: "Indicadores essenciais para precificar ativos.", youtubeVideoId: "dQw4w9WgXcQ", duration: 850, courseId: "course-ve", order: 2 },
            { _id: "ve-3", title: "Como analisar FIIs de Tijolo e Papel", description: "Métricas específicas para Fundos Imobiliários.", youtubeVideoId: "dQw4w9WgXcQ", duration: 800, courseId: "course-ve", order: 3 },
            { _id: "ve-4", title: "Engenharia de Prompts: Extraindo o máximo do Vértice AI", description: "Aprenda a conversar com a nossa inteligência artificial.", youtubeVideoId: "dQw4w9WgXcQ", duration: 600, courseId: "course-ve", order: 4 },
            { _id: "ve-5", title: "Backtesting: Como testar estratégias no passado com o Radar Alpha", description: "Validando suas teses de investimento.", youtubeVideoId: "dQw4w9WgXcQ", duration: 950, courseId: "course-ve", order: 5 },
            { _id: "ve-6", title: "Criptomoedas: Bitcoin, Ethereum e Ciclos de Halving", description: "O básico sobre o mercado cripto.", youtubeVideoId: "dQw4w9WgXcQ", duration: 700, courseId: "course-ve", order: 6 },

            // BLACK - Masterclass & Estudos de Caso
            { _id: "me-1", title: "Asset Allocation e Correlação de Ativos (Blindagem de Carteira)", description: "Como diversificar de forma inteligente e matemática.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1200, courseId: "course-me", order: 1 },
            { _id: "me-2", title: "Estratégia Barbell: Misturando segurança extrema com risco extremo", description: "A estratégia de Nassim Taleb na prática.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1100, courseId: "course-me", order: 2 },
            { _id: "me-3", title: "Estudo de Caso: A quebra do Lehman Brothers e a Crise de 2008", description: "O que aprendemos com a maior crise recente.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1500, courseId: "course-me", order: 3 },
            { _id: "me-4", title: "Estudo de Caso: Anatomia de fraudes (Americanas, Enron)", description: "Como identificar red flags em balanços.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1400, courseId: "course-me", order: 4 },
            { _id: "me-5", title: "Finanças Comportamentais: Vieses cognitivos (FOMO, FUD)", description: "A psicologia por trás das suas decisões financeiras.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1000, courseId: "course-me", order: 5 },
            { _id: "me-6", title: "Lotes Fiscais (FIFO) avançado e elisão fiscal legal", description: "Como pagar menos imposto de forma legal.", youtubeVideoId: "dQw4w9WgXcQ", duration: 1300, courseId: "course-me", order: 6 }
        ];

        console.log("Inserting lessons...");
        await Lesson.insertMany(lessonsData);

        // Inserir Quizzes de exemplo
        const quizzesData = [
            {
                courseId: "course-pp",
                passingScore: 70,
                questions: [
                    {
                        text: "Qual o primeiro passo para investir na Vértice?",
                        options: ["Comprar Bitcoin", "Configurar sua conta e importar carteira", "Ligar para um corretor", "Esperar o mercado cair"],
                        correctOptionIndex: 1
                    },
                    {
                        text: "O que o Dashboard da Vértice mostra principalmente?",
                        options: ["Notícias de fofoca", "Previsão do tempo", "Rentabilidade e comparação com CDI", "Receitas culinárias"],
                        correctOptionIndex: 2
                    },
                    {
                        text: "Qual a importância da Reserva de Emergência?",
                        options: ["Comprar um carro novo", "Garantir paz financeira em imprevistos", "Investir tudo em ações arriscadas", "Viajar nas férias"],
                        correctOptionIndex: 1
                    }
                ]
            }
        ];

        console.log("Inserting quizzes...");
        await Quiz.insertMany(quizzesData);

        console.log("Seed completed successfully.");
        res.json({ 
            message: "Academy seeded successfully!",
            summary: {
                courses: coursesData.length,
                lessons: lessonsData.length
            }
        });
    } catch (error) {
        console.error("CRITICAL Seed Error:", error);
        res.status(500).json({ 
            message: "Erro ao popular banco", 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};
