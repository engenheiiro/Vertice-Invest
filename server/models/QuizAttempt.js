import mongoose from 'mongoose';

const QuizAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: String, ref: 'Course', required: true },
  score: { type: Number, required: true }, // percentage
  passed: { type: Boolean, required: true },
  answers: [{ type: Number }], // index of selected options
  createdAt: { type: Date, default: Date.now }
});

// Ensure we track attempts
QuizAttemptSchema.index({ userId: 1, courseId: 1, createdAt: -1 });

const QuizAttempt = mongoose.models.QuizAttempt || mongoose.model('QuizAttempt', QuizAttemptSchema);
export default QuizAttempt;
