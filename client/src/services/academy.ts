import { authService } from './auth';

export const academyService = {
    async getCourses() {
        const response = await authService.api('/api/academy/courses');
        if (!response.ok) throw new Error("Erro ao buscar cursos");
        return await response.json();
    },

    async getCourseDetails(courseId: string) {
        const response = await authService.api(`/api/academy/courses/${courseId}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw Object.assign(new Error(errorData.message || "Erro ao buscar detalhes do curso"), { response: { data: errorData } });
        }
        return await response.json();
    },

    async getLessonDetails(lessonId: string) {
        const response = await authService.api(`/api/academy/lessons/${lessonId}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw Object.assign(new Error(errorData.message || "Erro ao buscar detalhes da aula"), { response: { data: errorData } });
        }
        return await response.json();
    },

    async updateProgress(lessonId: string, watchTime: number, completed: boolean) {
        const response = await authService.api('/api/academy/progress', {
            method: 'POST',
            body: JSON.stringify({ lessonId, watchTime, completed })
        });
        if (!response.ok) throw new Error("Erro ao atualizar progresso");
        return await response.json();
    },

    async seedAcademy() {
        const response = await authService.api('/api/academy/seed', {
            method: 'POST'
        });
        if (!response.ok) throw new Error("Erro ao popular dados");
        return await response.json();
    }
};
