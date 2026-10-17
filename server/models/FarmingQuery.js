import mongoose from 'mongoose';

const adviceSchema = new mongoose.Schema({
  explanation: { type: String, required: true, trim: true, maxlength: 4_000 },
  considerations: { type: [String], default: [], maxlength: 5 },
  nextSteps: { type: [String], default: [], maxlength: 5 },
  consultExpert: { type: String, required: true, trim: true, maxlength: 2_000 }
}, { _id: false });

const farmingQuerySchema = new mongoose.Schema({
  crop: { type: String, required: true, trim: true, maxlength: 120 },
  location: { type: String, required: true, trim: true, maxlength: 180 },
  soilType: { type: String, trim: true, maxlength: 80, default: '' },
  question: { type: String, required: true, trim: true, maxlength: 2_000 },
  inputFingerprint: { type: String, required: true, unique: true, index: true },
  advice: { type: adviceSchema, required: true },
  imageAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
  imageAnalysisUsed: { type: Boolean, default: false },
  processingStatus: { type: String, enum: ['completed'], default: 'completed' }
}, { timestamps: true, versionKey: false });

farmingQuerySchema.index({ createdAt: -1 });

export const FarmingQuery = mongoose.model('FarmingQuery', farmingQuerySchema);
