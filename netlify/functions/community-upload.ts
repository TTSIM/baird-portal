import type { Config, Context } from "@netlify/functions";
import sharp from "sharp";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import {
  cleanFilename,
  cleanImageMimeType,
  imageSignatureMime,
  requireCommunityEnabled,
  requireCompleteProfile,
  requireSameOrigin,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_EXPIRY_MS,
  validateImageSize,
  type CommunityAttachmentRecord,
  type CommunityUploadRecord
} from "./_shared/community.js";
import {
  communityImagesStore,
  communityTempStore,
  consumeCommunityRate,
  deleteUpload,
  getUpload,
  newId,
  saveAttachment,
  saveUpload
} from "./_shared/community-data.js";

function extensionFor(mimeType: CommunityAttachmentRecord["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export async function normalizeImage(input: Buffer, mimeType: CommunityAttachmentRecord["mimeType"]) {
  let pipeline = sharp(input, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true });
  if (mimeType === "image/jpeg") pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  if (mimeType === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
  if (mimeType === "image/webp") pipeline = pipeline.webp({ quality: 95 });
  const normalized = await pipeline.toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(normalized.data)
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  return { normalized, thumbnail };
}

async function initUpload(request: Request, user: Awaited<ReturnType<typeof requireUser>>) {
  const body = await request.json() as Record<string, unknown>;
  const purpose = body.purpose === "avatar" ? "avatar" : body.purpose === "post" ? "post" : null;
  if (!purpose) throw new HttpError(400, "Choose a valid upload purpose.", "INVALID_UPLOAD_PURPOSE");
  if (purpose === "post") {
    requireCommunityEnabled();
    requireCompleteProfile(user);
  }
  const declaredMimeType = cleanImageMimeType(body.mimeType);
  const declaredBytes = validateImageSize(body.size);
  await consumeCommunityRate("image", user.id, 20, 24 * 60 * 60 * 1_000);
  const now = new Date();
  const id = newId();
  const upload: CommunityUploadRecord = {
    id,
    ownerId: user.id,
    purpose,
    originalFilename: cleanFilename(body.filename),
    declaredMimeType,
    declaredBytes,
    expectedChunks: Math.ceil(declaredBytes / UPLOAD_CHUNK_BYTES),
    receivedChunks: [],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + UPLOAD_EXPIRY_MS).toISOString()
  };
  await saveUpload(upload);
  return Response.json({
    upload: { id, expectedChunks: upload.expectedChunks, chunkBytes: UPLOAD_CHUNK_BYTES }
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

async function putChunk(request: Request, context: Context, user: Awaited<ReturnType<typeof requireUser>>) {
  const upload = await getUpload(context.params.id);
  if (!upload || upload.ownerId !== user.id || new Date(upload.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(404, "The upload session was not found.", "UPLOAD_NOT_FOUND");
  }
  const index = Number(context.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= upload.expectedChunks) {
    throw new HttpError(400, "The upload chunk is invalid.", "INVALID_CHUNK");
  }
  const buffer = await request.arrayBuffer();
  const expected = index === upload.expectedChunks - 1
    ? upload.declaredBytes - (UPLOAD_CHUNK_BYTES * index)
    : UPLOAD_CHUNK_BYTES;
  if (buffer.byteLength !== expected) {
    throw new HttpError(400, "The upload chunk size is invalid.", "INVALID_CHUNK_SIZE");
  }
  await communityTempStore().set(`uploads/${upload.id}/${index}`, buffer);
  if (!upload.receivedChunks.includes(index)) {
    await saveUpload({ ...upload, receivedChunks: [...upload.receivedChunks, index].sort((a, b) => a - b) });
  }
  return new Response(null, { status: 204 });
}

async function finalizeUpload(request: Request, context: Context, user: Awaited<ReturnType<typeof requireUser>>) {
  const upload = await getUpload(context.params.id);
  if (!upload || upload.ownerId !== user.id || new Date(upload.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(404, "The upload session was not found.", "UPLOAD_NOT_FOUND");
  }
  if (upload.receivedChunks.length !== upload.expectedChunks) {
    throw new HttpError(409, "Upload every image chunk before finalising.", "UPLOAD_INCOMPLETE");
  }
  const temp = communityTempStore();
  const chunks = await Promise.all(Array.from({ length: upload.expectedChunks }, async (_, index) => {
    const value = await temp.get(`uploads/${upload.id}/${index}`, { type: "arrayBuffer" });
    if (!value) throw new HttpError(409, "An upload chunk is missing.", "UPLOAD_INCOMPLETE");
    return Buffer.from(value as ArrayBuffer);
  }));
  const input = Buffer.concat(chunks);
  if (input.byteLength !== upload.declaredBytes) {
    throw new HttpError(400, "The completed image size does not match.", "INVALID_IMAGE_SIZE");
  }
  const detectedMimeType = imageSignatureMime(input.subarray(0, 16));
  if (!detectedMimeType || detectedMimeType !== upload.declaredMimeType) {
    throw new HttpError(400, "The image content does not match its file type.", "INVALID_IMAGE_CONTENT");
  }

  let normalized;
  try {
    normalized = await normalizeImage(input, detectedMimeType);
  } catch {
    throw new HttpError(400, "The uploaded image could not be decoded.", "INVALID_IMAGE_CONTENT");
  }
  const id = newId();
  const extension = extensionFor(detectedMimeType);
  const imageKey = `images/${id}.${extension}`;
  const thumbnailKey = `thumbnails/${id}.webp`;
  await Promise.all([
    communityImagesStore().set(
      imageKey,
      normalized.normalized.data.buffer.slice(
        normalized.normalized.data.byteOffset,
        normalized.normalized.data.byteOffset + normalized.normalized.data.byteLength
      ) as ArrayBuffer
    ),
    communityImagesStore().set(
      thumbnailKey,
      normalized.thumbnail.buffer.slice(
        normalized.thumbnail.byteOffset,
        normalized.thumbnail.byteOffset + normalized.thumbnail.byteLength
      ) as ArrayBuffer
    )
  ]);
  const attachment: CommunityAttachmentRecord = {
    id,
    ownerId: user.id,
    purpose: upload.purpose,
    originalFilename: upload.originalFilename,
    mimeType: detectedMimeType,
    bytes: normalized.normalized.data.byteLength,
    width: normalized.normalized.info.width,
    height: normalized.normalized.info.height,
    imageKey,
    thumbnailKey,
    createdAt: new Date().toISOString()
  };
  await saveAttachment(attachment);
  await Promise.all([
    ...Array.from({ length: upload.expectedChunks }, (_, index) => temp.delete(`uploads/${upload.id}/${index}`)),
    deleteUpload(upload.id)
  ]);
  return Response.json({
    attachment: {
      id: attachment.id,
      filename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      imageUrl: `/api/community/images/${attachment.id}`,
      thumbnailUrl: `/api/community/images/${attachment.id}?variant=thumbnail`
    }
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export default async function handler(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/api/community/uploads") return await initUpload(request, user);
    if (request.method === "PUT" && context.params.id && context.params.index !== undefined) {
      return await putChunk(request, context, user);
    }
    if (request.method === "POST" && context.params.id) return await finalizeUpload(request, context, user);
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: [
    "/api/community/uploads",
    "/api/community/uploads/:id/chunks/:index",
    "/api/community/uploads/:id/finalize"
  ],
  method: ["POST", "PUT"]
};
