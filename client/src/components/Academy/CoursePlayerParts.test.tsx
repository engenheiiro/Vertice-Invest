/**
 * Partes visuais do player de curso: lista de aulas com trava, teste final
 * (perguntas, aprovado, reprovado) e aula sem vídeo.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { CourseSidebar } from './CourseSidebar';
import { CourseQuizPanel } from './CourseQuizPanel';
import { CourseLessonView } from './CourseLessonView';

vi.mock('react-player', () => ({ default: () => <div data-testid="react-player" /> }));

const LESSONS = [
    { _id: 'l1', title: 'Um', duration: 600 },
    { _id: 'l2', title: 'Dois', duration: 125 },
];
const QUIZ = { questions: [{ text: 'Pergunta?', options: ['A', 'B'] }] };
const noop = () => {};

const sidebar = (over: Partial<React.ComponentProps<typeof CourseSidebar>> = {}) =>
    render(
        <CourseSidebar
            lessons={LESSONS}
            currentLessonId="l1"
            completedLessons={[]}
            showQuiz={false}
            allCompleted={false}
            lastAttempt={null}
            onSelectLesson={noop}
            onTestClick={noop}
            {...over}
        />,
    );

describe('CourseSidebar', () => {
    it('trava a aula seguinte e o teste enquanto nada foi concluído', async () => {
        const onSelect = vi.fn();
        const { container } = sidebar({ onSelectLesson: onSelect });
        expect(screen.getByText('2 aulas')).toBeInTheDocument();
        expect(screen.getByText('2. Dois').closest('button')).toBeDisabled();
        expect(screen.getByText('Conclua todas as aulas para liberar')).toBeInTheDocument();
        expect(screen.getByText('2 min')).toBeInTheDocument();
        fireEvent.click(screen.getByText('1. Um'));
        expect(onSelect).toHaveBeenCalledWith(LESSONS[0]);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('com tudo concluído libera o teste; aprovado vira "Certificado Disponível"', () => {
        const onTest = vi.fn();
        const view = sidebar({ completedLessons: ['l1', 'l2'], allCompleted: true, onTestClick: onTest });
        expect(screen.getByText('Disponível')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Teste Final & Certificado'));
        expect(onTest).toHaveBeenCalled();
        view.unmount();
        sidebar({ completedLessons: ['l1', 'l2'], allCompleted: true, lastAttempt: { passed: true, score: 90 } });
        expect(screen.getByText('Certificado Disponível')).toBeInTheDocument();
        expect(screen.getByText('Aprovado')).toBeInTheDocument();
    });
});

const panel = (over: Partial<React.ComponentProps<typeof CourseQuizPanel>> = {}) =>
    render(
        <CourseQuizPanel
            quiz={QUIZ}
            quizAnswers={[-1]}
            quizSubmitting={false}
            quizLoading={false}
            quizError=""
            quizResult={null}
            downloading={false}
            onSelect={noop}
            onSubmit={noop}
            onStart={noop}
            onRetry={noop}
            onDownload={noop}
            {...over}
        />,
    );

describe('CourseQuizPanel', () => {
    it('perguntas: escolher chama onSelect e o envio fica bloqueado sem resposta', () => {
        const onSelect = vi.fn();
        panel({ onSelect });
        expect(screen.getByText('Finalizar Teste')).toBeDisabled();
        fireEvent.click(screen.getByText('B'));
        expect(onSelect).toHaveBeenCalledWith(0, 1);
    });

    it('sem quiz carregado oferece "Iniciar Teste" e mostra o erro', () => {
        const onStart = vi.fn();
        panel({ quiz: null, quizError: 'Quiz fechado', onStart });
        expect(screen.getByText('Quiz fechado')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Iniciar Teste'));
        expect(onStart).toHaveBeenCalled();
    });

    it('aprovado mostra a nota arredondada e baixa o certificado', () => {
        const onDownload = vi.fn();
        panel({ quizResult: { passed: true, score: 66.7, passingScore: 70, attempt: { score: 66.7 } }, onDownload });
        expect(screen.getByText('67%')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Baixar Certificado'));
        expect(onDownload).toHaveBeenCalled();
    });

    it('reprovado revisa as próprias respostas e permite tentar de novo', () => {
        const onRetry = vi.fn();
        panel({ quizAnswers: [0], quizResult: { passed: false, score: 0, passingScore: 70, attempt: { score: 0 } }, onRetry });
        expect(screen.getByText('Sua resposta: A')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Tentar Novamente'));
        expect(onRetry).toHaveBeenCalled();
    });
});

describe('CourseLessonView', () => {
    it('aula sem vídeo mostra "Conteúdo em Produção" e o botão de concluir', () => {
        const onBack = vi.fn();
        const onMark = vi.fn();
        render(
            <CourseLessonView
                lesson={{ _id: 'l3', title: 'Texto', description: 'Leitura' }}
                isCompleted={false}
                onMarkDone={onMark}
                onBack={onBack}
                useNativeIframe
                onToggle={noop}
                onProgress={noop}
                onEnded={noop}
                onPlayerError={noop}
            />,
        );
        fireEvent.click(screen.getByText('Ver outros cursos'));
        fireEvent.click(screen.getByText('Marcar esta aula como concluída'));
        expect(onBack).toHaveBeenCalled();
        expect(onMark).toHaveBeenCalled();
    });

    it('aula com vídeo alterna entre iframe e player avançado', () => {
        const onToggle = vi.fn();
        const props = {
            lesson: { _id: 'l1', title: 'Vídeo', youtubeId: 'yt1' },
            isCompleted: true,
            onMarkDone: noop,
            onBack: noop,
            onToggle,
            onProgress: noop,
            onEnded: noop,
            onPlayerError: noop,
        };
        const { rerender } = render(<CourseLessonView {...props} useNativeIframe />);
        expect(screen.getByTitle('YouTube video player')).toHaveAttribute('src', expect.stringContaining('/embed/yt1'));
        expect(screen.queryByText('Marcar esta aula como concluída')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Usar Player Avançado'));
        expect(onToggle).toHaveBeenCalled();
        rerender(<CourseLessonView {...props} useNativeIframe={false} />);
        expect(screen.getByTestId('react-player')).toBeInTheDocument();
    });
});
