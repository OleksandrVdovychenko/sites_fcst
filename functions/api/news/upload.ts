// POST /api/news/upload — заливає одне зображення в public/news/ і повертає
// публічний шлях, щоб редактор міг вставити ![](шлях) будь-де в тексті
// новини, не покидаючи звичайне markdown-поле (без rich-text редактора).
import type { PagesContext } from "../_lib/types";
import type { Env } from "../_lib/github";
import { uploadImage } from "../_lib/image";
import { slugify } from "../_lib/slug";
import { json, errorResponse } from "../_lib/http";

interface UploadBody {
  dataUrl?: string;
  filename?: string;
}

export const onRequestPost = async (context: PagesContext<Env>): Promise<Response> => {
  let body: UploadBody;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse(400, "Некоректний JSON у тілі запиту.");
  }
  if (!body.dataUrl) return errorResponse(400, "Немає файлу зображення.");

  const stamp = Date.now().toString(36);
  const base = body.filename ? slugify(body.filename.replace(/\.[a-z0-9]+$/i, ""), 4) : "image";
  const email = String(context.data.userEmail ?? "адмінка");

  const result = await uploadImage(
    context.env,
    body.dataUrl,
    `public/news/inline-${stamp}-${base}`,
    `новини: зображення в тексті (${email})`
  );
  if (!result.ok) return errorResponse(result.status, result.message);

  return json({ path: result.path }, 201);
};
