// Діє на всі /admin/* (самі HTML-сторінки адмінки, не лише API) — раніше
// цей шлях захищала виключно Cloudflare Access-політика в дашборді. Тепер
// ALLOWED_EMAILS (той самий checkAccess, що й для /api/*) — єдине місце,
// яке треба міняти, щоб додати чи прибрати редактора.
import type { PagesContext } from "../_lib/types";
import { checkAccess, type AccessEnv } from "../_lib/access";

export const onRequest = async (context: PagesContext<AccessEnv>): Promise<Response> => {
  const result = checkAccess(context.request, context.env);
  if (!result.ok) {
    return new Response(result.message, { status: result.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return context.next();
};
