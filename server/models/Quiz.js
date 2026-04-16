import mongoose from 'mongoose';

const QuestionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctOptionIndex: { type: Number, required: true }
});

const QuizSchema = new mongoose.Schema({
  courseId: { type: String, ref: 'Course', required: true, unique: true },
  questions: [QuestionSchema],
  passingScore: { type: Number, default: 70 }, // percentage
  createdAt: { type: Date, default: Date.now }
});

const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', QuizSchema);
export default Quiz;
