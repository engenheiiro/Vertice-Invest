import mongoose from 'mongoose';

const UserProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lessonId: { type: String, ref: 'Lesson', required: true },
  courseId: { type: String, ref: 'Course', required: true },
  completed: { type: Boolean, default: false },
  watchTime: { type: Number, default: 0 }, // in seconds
  lastWatchedAt: { type: Date, default: Date.now }
});

// Ensure a user only has one progress record per lesson
UserProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

const UserProgress = mongoose.models.UserProgress || mongoose.model('UserProgress', UserProgressSchema);
export default UserProgress;
