import { createHmac, timingSafeEqual } from 'node:crypto';

const allowedImageTypes = new Set(['image/jpeg', 'image/png']);
const graphUrl = (path) => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v24.0'}/${path}`;

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

export function extractIncomingMessages(payload) {
  const changes = payload?.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
  return changes.flatMap((change) => change?.value?.messages ?? []).map((message) => ({
    id: message.id, from: message.from, type: message.type, text: message.text?.body ?? '', imageId: message.image?.id, caption: message.image?.caption ?? ''
  })).filter((message) => message.id && message.from && ['text', 'image'].includes(message.type));
}

export async function sendWhatsAppText(to, body, { token = process.env.WHATSAPP_TOKEN, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID, fetchImpl = fetch } = {}) {
  if (!token || !phoneNumberId) throw new Error('WhatsApp sending is not configured.');
  const response = await fetchImpl(graphUrl(`${phoneNumberId}/messages`), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4000) } }) });
  if (!response.ok) throw new Error('WhatsApp reply could not be sent.');
  return response.json();
}

export async function downloadWhatsAppImage(mediaId, { token = process.env.WHATSAPP_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('WhatsApp media access is not configured.');
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await fetchImpl(graphUrl(mediaId), { headers });
  if (!metadataResponse.ok) throw new Error('WhatsApp image metadata could not be retrieved.');
  const metadata = await metadataResponse.json();
  if (!allowedImageTypes.has(metadata.mime_type) || !metadata.url || Number(metadata.file_size) > 5 * 1024 * 1024) throw new Error('The WhatsApp image must be a JPEG or PNG no larger than 5 MB.');
  const imageResponse = await fetchImpl(metadata.url, { headers });
  if (!imageResponse.ok) throw new Error('WhatsApp image could not be downloaded.');
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (buffer.length > 5 * 1024 * 1024) throw new Error('The WhatsApp image must be 5 MB or smaller.');
  return { buffer, mimetype: metadata.mime_type };
}
