// Діє на всі /api/* — захист "про всяк випадок" на рівні коду.
// Основна брама — політика Cloudflare Access на шляхи /admin/* і /api/*,
// яку власник сайту налаштовує вручну в дашборді (див. ADMIN-SETUP.md).
// Access підставляє цей заголовок автентифікованим користувачам; якщо його
// немає — або Access не налаштовано, або хтось звертається напряму в обхід.
import type { PagesContext } from "./_lib/types";

export const onRequest = async (context: PagesContext<unknown>): Promise<Response> => {
  const email = context.request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return new Response(
      JSON.stringify({
        error:
          "Немає підтвердженого доступу (Cloudflare Access). /admin/ і /api/ мають бути захищені політикою — див. ADMIN-SETUP.md.",
      }),
      { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
  context.data.userEmail = email;
  return context.next();
};
