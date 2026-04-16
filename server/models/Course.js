import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  thumbnail: { type: String }, // URL for the Netflix-style cover
  requiredPlan: { 
    type: String, 
    enum: ['GUEST', 'ESSENTIAL', 'PRO', 'BLACK'], 
    default: 'GUEST' 
  },
  category: { type: String, required: true }, // e.g., "Fundamentos", "Renda Fixa"
  isLocked: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Course = mongoose.models.Course || mongoose.model('Course', CourseSchema);
export default Course;
