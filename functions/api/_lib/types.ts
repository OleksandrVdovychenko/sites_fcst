// Мінімальний тип контексту Cloudflare Pages Function — щоб не тягнути
// @cloudflare/workers-types лише заради форми виклику.
export interface PagesContext<Env> {
  request: Request;
  env: Env;
  params: Record<string, string>;
  data: Record<string, unknown>;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}
