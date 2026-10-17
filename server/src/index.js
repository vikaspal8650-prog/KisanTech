import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { AiServiceError, getCropImageAnalysis, getFarmingAssistance } from '../services/geminiFarmingAssistant.js';
import { connectDatabase, databaseReady } from '../config/database.js';
import { FarmingQuery } from '../models/FarmingQuery.js';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { downloadWhatsAppImage, extractIncomingMessages, sendWhatsAppText, verifyWebhookSignature } from '../services/whatsappCloud.js';

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 5000;
const recentWebhookMessageIds = new Set();

function formatTextReply(advice) {
  return `Fasal Guru AI जानकारी:\n${advice.explanation}\n\nसंभावित बातें: ${(advice.considerations || []).slice(0, 2).join('; ')}\n\nअगले कदम: ${(advice.nextSteps || []).slice(0, 2).join('; ')}\n\nसावधानी: ${advice.consultExpert}\nयह पक्की बीमारी की पहचान नहीं है।`;
}

function formatImageReply(analysis) {
  return `Fasal Guru AI फोटो जानकारी:\n${analysis.summary}\n\nदिखाई देने वाली बातें: ${(analysis.visibleObservations || []).slice(0, 2).join('; ')}\n\nसंभावित कारण: ${(analysis.possibleCauses || []).slice(0, 2).join('; ')}\n\nअगले कदम: ${(analysis.recommendedSteps || []).slice(0, 2).join('; ')}\n\n${analysis.whenToConsultExpert}\nसीमा: ${analysis.limitations}\nयह पक्की बीमारी की पहचान नहीं है।`;
}

async function processWhatsAppMessage(message) {
  if (recentWebhookMessageIds.has(message.id)) return;
  recentWebhookMessageIds.add(message.id);
  if (recentWebhookMessageIds.size > 500) recentWebhookMessageIds.delete(recentWebhookMessageIds.values().next().value);
  let databaseRecord;
  try {
    if (databaseReady()) databaseRecord = await WhatsAppMessage.create({ messageId: message.id, sender: message.from, messageType: message.type });
  } catch (error) {
    if (error?.code === 11000) return;
    console.error('WhatsApp message persistence failed:', error.message);
  }
  try {
    let reply;
    if (message.type === 'text') {
      if (message.text.trim().length < 12) reply = 'कृपया फसल का नाम, स्थान और समस्या थोड़ी विस्तार से लिखें। उदाहरण: गेहूं, बरेली, पत्ते पीले हो रहे हैं।';
      else reply = formatTextReply(await getFarmingAssistance({ crop: 'Not specified', location: 'Not specified', soilType: '', question: message.text }));
    } else {
      const image = await downloadWhatsAppImage(message.imageId);
      reply = formatImageReply(await getCropImageAnalysis({ crop: 'Not specified', location: 'Not specified', soilType: '', question: message.caption || 'Please review this crop image.', image }));
    }
    await sendWhatsAppText(message.from, reply);
    if (databaseRecord) await WhatsAppMessage.updateOne({ _id: databaseRecord._id }, { processingStatus: 'processed', replySent: true });
    console.log(`WhatsApp ${message.type} message processed.`);
  } catch (error) {
    if (databaseRecord) await WhatsAppMessage.updateOne({ _id: databaseRecord._id }, { processingStatus: 'failed' }).catch(() => {});
    console.error(`WhatsApp ${message.type} processing failed:`, error.message);
  }
}

app.get('/api/whatsapp/webhook', (request, response) => {
  const { 'hub.mode': mode, 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = request.query;
  if (mode === 'subscribe' && verifyToken && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) return response.status(200).send(challenge);
  return response.sendStatus(403);
});

app.post('/api/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (request, response) => {
  if (!verifyWebhookSignature(request.body, request.get('x-hub-signature-256'))) return response.sendStatus(401);
  let payload;
  try { payload = JSON.parse(request.body.toString('utf8')); } catch { return response.sendStatus(400); }
  const messages = extractIncomingMessages(payload);
  response.sendStatus(200);
  for (const message of messages) void processWhatsAppMessage(message);
});

app.use(express.json({ limit: '10kb' }));

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_request, file, callback) => {
  if (['image/jpeg', 'image/png'].includes(file.mimetype)) return callback(null, true);
  return callback(new Error('Only JPEG and PNG crop images are supported.'));
} });

app.get('/api/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    message: 'Fasal Guru backend is running.',
    database: databaseReady() ? 'connected' : 'unavailable'
  });
});

app.post('/api/farming-assist', async (request, response, next) => {
  const { crop, location, soilType, question } = request.body ?? {};
  const requiredFields = { crop, location, question };
  const errors = Object.fromEntries(
    Object.entries(requiredFields)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([field]) => [field, `${field} is required.`])
  );

  if (Object.keys(errors).length > 0) {
    return response.status(400).json({
      success: false,
      error: 'Please provide crop, location, and question.',
      fields: errors
    });
  }

  try {
    const normalizedInput = { crop: crop.trim(), location: location.trim(), soilType: typeof soilType === 'string' ? soilType.trim() : '', question: question.trim() };
    const inputFingerprint = createHash('sha256').update(JSON.stringify(normalizedInput)).digest('hex');
    if (databaseReady()) {
      const existingRecord = await FarmingQuery.findOne({ inputFingerprint }).lean();
      if (existingRecord) return response.status(200).json({ success: true, mode: 'ai', recordId: existingRecord._id.toString(), persistence: { saved: true, reused: true }, ...existingRecord.advice });
    }
    const assistance = await getFarmingAssistance({
      ...normalizedInput
    });
    const recordData = { ...normalizedInput, inputFingerprint, advice: assistance };
    try {
      if (!databaseReady()) throw new Error('Database is not connected.');
      const record = await FarmingQuery.create(recordData);
      return response.status(201).json({
        success: true,
        mode: 'ai',
        recordId: record.id,
        persistence: { saved: true },
        ...assistance
      });
    } catch (databaseError) {
      if (databaseError?.code === 11000) {
        const existingRecord = await FarmingQuery.findOne({ inputFingerprint }).lean();
        if (existingRecord) return response.status(200).json({ success: true, mode: 'ai', recordId: existingRecord._id.toString(), persistence: { saved: true, reused: true }, ...existingRecord.advice });
      }
      console.error('Farming history save failed:', databaseError.message);
      return response.status(202).json({
        success: true,
        mode: 'ai',
        persistence: { saved: false, message: 'Advice was generated, but history could not be saved. Check the database connection.' },
        ...assistance
      });
    }
  } catch (error) {
    if (error instanceof AiServiceError) return response.status(error.status).json({ success: false, error: error.message, code: error.code });
    return next(error);
  }
});

app.post('/api/farming-assist/image', imageUpload.single('image'), async (request, response, next) => {
  const { crop, location, soilType, question } = request.body ?? {};
  const requiredFields = { crop, location, question };
  const fields = Object.fromEntries(Object.entries(requiredFields).filter(([, value]) => typeof value !== 'string' || !value.trim()).map(([field]) => [field, `${field} is required.`]));
  if (Object.keys(fields).length) return response.status(400).json({ success: false, error: 'Please provide crop, location, and question.', fields });
  if (!request.file) return response.status(400).json({ success: false, error: 'Please upload a JPEG or PNG crop image.', fields: { image: 'A crop image is required.' } });
  try {
    const input = { crop: crop.trim(), location: location.trim(), soilType: typeof soilType === 'string' ? soilType.trim() : '', question: question.trim() };
    const inputFingerprint = createHash('sha256').update(JSON.stringify(input)).update(request.file.buffer).digest('hex');
    if (databaseReady()) {
      const existing = await FarmingQuery.findOne({ inputFingerprint }).lean();
      if (existing?.imageAnalysis) return response.json({ success: true, mode: 'image-ai', recordId: existing._id.toString(), persistence: { saved: true, reused: true }, analysis: existing.imageAnalysis });
    }
    const analysis = await getCropImageAnalysis({ ...input, image: request.file });
    const advice = { explanation: analysis.summary, considerations: analysis.possibleCauses, nextSteps: analysis.recommendedSteps, consultExpert: analysis.whenToConsultExpert };
    try {
      if (!databaseReady()) throw new Error('Database is not connected.');
      const record = await FarmingQuery.create({ ...input, inputFingerprint, advice, imageAnalysis: analysis, imageAnalysisUsed: true });
      return response.status(201).json({ success: true, mode: 'image-ai', recordId: record.id, persistence: { saved: true }, analysis });
    } catch (databaseError) {
      console.error('Image analysis history save failed:', databaseError.message);
      return response.status(202).json({ success: true, mode: 'image-ai', persistence: { saved: false, message: 'Image analysis was generated, but history could not be saved. Check the database connection.' }, analysis });
    }
  } catch (error) {
    if (error instanceof AiServiceError) return response.status(error.status).json({ success: false, error: error.message, code: error.code });
    return next(error);
  }
});

app.get('/api/farming-history', async (request, response, next) => {
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10;
  try {
    if (!databaseReady()) return response.status(503).json({ success: false, error: 'Farming history is unavailable because the database is not connected.', code: 'DATABASE_UNAVAILABLE' });
    const records = await FarmingQuery.find().sort({ createdAt: -1 }).limit(limit).select('crop location question createdAt processingStatus').lean();
    return response.json({ success: true, demoOnly: true, records: records.map((record) => ({ ...record, id: record._id.toString(), _id: undefined })) });
  } catch (error) { return next(error); }
});

app.get('/api/farming-history/:id', async (request, response, next) => {
  const { id } = request.params;
  if (!/^[a-f\d]{24}$/i.test(id)) return response.status(400).json({ success: false, error: 'Invalid history record ID.' });
  try {
    if (!databaseReady()) return response.status(503).json({ success: false, error: 'Farming history is unavailable because the database is not connected.', code: 'DATABASE_UNAVAILABLE' });
    const record = await FarmingQuery.findById(id).lean();
    if (!record) return response.status(404).json({ success: false, error: 'Farming history record not found.' });
    return response.json({ success: true, demoOnly: true, record: { ...record, id: record._id.toString(), _id: undefined } });
  } catch (error) { return next(error); }
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ success: false, error: 'Request body must contain valid JSON.' });
  }

  if (error.type === 'entity.too.large') {
    return response.status(413).json({ success: false, error: 'Request body is too large.' });
  }

  if (error instanceof multer.MulterError) {
    return response.status(413).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Crop image must be 5 MB or smaller.' : 'The image upload could not be processed.' });
  }

  if (error.message === 'Only JPEG and PNG crop images are supported.') {
    return response.status(400).json({ success: false, error: error.message, fields: { image: error.message } });
  }

  console.error('Unhandled API error:', error.message);
  return response.status(500).json({ success: false, error: 'An unexpected server error occurred.' });
});

connectDatabase().finally(() => app.listen(port, () => {
  console.log(`Fasal Guru API listening on http://localhost:${port}`);
}));
