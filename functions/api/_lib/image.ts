// Спільна логіка заливки зображення в public/ через GitHub Contents API —
// використовується і для обкладинки новини, і для картинок у тілі статті.
import { getFile, putFile, type Env } from "./github";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function decodeDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

export type UploadResult = { ok: true; path: string } | { ok: false; status: number; message: string };

// basePath — шлях у репо БЕЗ розширення, напр. "public/news/2026-08-slug".
// Розширення дописується за MIME-типом. Повертає публічний шлях (напр. /news/…).
export async function uploadImage(
  env: Env,
  dataUrl: string,
  basePath: string,
  commitMessage: string
): Promise<UploadResult> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return { ok: false, status: 400, message: "Некоректний формат зображення." };

  const ext = MIME_EXT[decoded.mime];
  if (!ext) return { ok: false, status: 400, message: "Зображення має бути jpeg, png, webp або gif." };

  const approxBytes = (decoded.base64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, status: 413, message: "Зображення завелике (максимум 5 МБ)." };

  const fullPath = `${basePath}.${ext}`;
  const existing = await getFile(env, fullPath);
  await putFile(env, fullPath, decoded.base64, commitMessage, existing?.sha);

  return { ok: true, path: `/${fullPath.replace(/^public\//, "")}` };
}
