// Діє на всі /api/* — захист на рівні коду, другий шар поверх Cloudflare Access.
// Основна брама — політика Access на шляхи /admin/* і /api/*, яку власник
// сайту налаштовує вручну в дашборді (див. ADMIN-SETUP.md) зі списком
// конкретних дозволених email, а не всього домену. Тут ми ще раз звіряємо
// той самий список із env ALLOWED_EMAILS — щоб доступ лишався обмеженим,
// навіть якщо колись хтось послабить політику в дашборді.
import type { PagesContext } from "./_lib/types";
import type { Env } from "./_lib/github";

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const onRequest = async (context: PagesContext<Env>): Promise<Response> => {
  // Тимчасовий рубильник лише для обкатки пайплайну до налаштування Access —
  // вмикається виключно значенням "true" в env, за замовчуванням вимкнено.
  // НІКОЛИ не вмикай це в Production env vars довше, ніж триває тест:
  // поки він true, /admin/ і /api/news відкриті будь-кому в інтернеті.
  if (context.env.SKIP_ACCESS_CHECK === "true") {
    context.data.userEmail = "тест (SKIP_ACCESS_CHECK=true, без Access)";
    return context.next();
  }

  const email = context.request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return unauthorized(
      "Немає підтвердженого доступу (Cloudflare Access). /admin/ і /api/ мають бути захищені політикою — див. ADMIN-SETUP.md."
    );
  }

  const allowList = (context.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowList.length > 0 && !allowList.includes(email.toLowerCase())) {
    return unauthorized(`Обліковий запис ${email} не має доступу до адмінки новин.`);
  }

  context.data.userEmail = email;
  return context.next();
};
