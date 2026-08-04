// Діє на всі /api/* — захист на рівні коду, поруч із таким самим для /admin/*
// у functions/admin/_middleware.ts. Обидва використовують один checkAccess.
import type { PagesContext } from "../_lib/types";
import { checkAccess, type AccessEnv } from "../_lib/access";

export const onRequest = async (context: PagesContext<AccessEnv>): Promise<Response> => {
  const result = checkAccess(context.request, context.env);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.message }), {
      status: result.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  context.data.userEmail = result.email;
  return context.next();
};
