import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true, index: true },
  sender: { type: String, required: true, select: false },
  messageType: { type: String, enum: ['text', 'image'], required: true },
  processingStatus: { type: String, enum: ['received', 'processed', 'failed'], default: 'received' },
  replySent: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
