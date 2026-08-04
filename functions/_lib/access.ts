// Єдине джерело правди для "хто має доступ до адмінки" — використовується і
// в functions/admin/_middleware.ts (сторінки), і в functions/api/_middleware.ts
// (API). Змінити список редакторів = змінити лише ALLOWED_EMAILS тут, у
// Cloudflare Pages env vars. Cloudflare Access-політику при цьому можна
// лишити загальною ("просто увійти через Google") і більше не чіпати —
// див. ADMIN-SETUP.md.
export interface AccessEnv {
  ALLOWED_EMAILS?: string;
  SKIP_ACCESS_CHECK?: string;
}

export type AccessCheck = { ok: true; email: string } | { ok: false; status: number; message: string };

export function checkAccess(request: Request, env: AccessEnv): AccessCheck {
  // Тимчасовий рубильник лише для обкатки пайплайну до налаштування Access —
  // вмикається виключно значенням "true", за замовчуванням вимкнено.
  // НІКОЛИ не лишай це в Production env vars довше, ніж триває тест.
  if (env.SKIP_ACCESS_CHECK === "true") {
    return { ok: true, email: "тест (SKIP_ACCESS_CHECK=true, без Access)" };
  }

  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return {
      ok: false,
      status: 401,
      message:
        "Немає підтвердженого доступу (Cloudflare Access). /admin/ і /api/ мають бути захищені політикою — див. ADMIN-SETUP.md.",
    };
  }

  const allowList = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowList.length > 0 && !allowList.includes(email.toLowerCase())) {
    return { ok: false, status: 401, message: `Обліковий запис ${email} не має доступу до адмінки новин.` };
  }

  return { ok: true, email };
}
