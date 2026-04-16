import mongoose from 'mongoose';

const LessonSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  youtubeVideoId: { type: String, required: true },
  duration: { type: Number, default: 0 }, // in seconds
  courseId: { type: String, ref: 'Course', required: true },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Lesson = mongoose.models.Lesson || mongoose.model('Lesson', LessonSchema);
export default Lesson;
