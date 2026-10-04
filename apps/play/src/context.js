// Request context + error helpers shared across routes.
// A Ctx bundles the Fastify request with the authenticated user (when present)
// and the app services. Guards throw HttpError with a status + a stable code the
// client can react to.

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const unauthorized = (m) => new HttpError(401, 'unauthorized', m);
export const forbidden = (m) => new HttpError(403, 'forbidden', m);
export const badRequest = (m) => new HttpError(400, 'bad_request', m);
export const notFound = (m) => new HttpError(404, 'not_found', m);
export const conflict = (m) => new HttpError(409, 'conflict', m);
export const tooMany = (m) => new HttpError(429, 'too_many', m);

// role -> rank. Admin/owner can do everything; moderator handles content;
// support handles accounts/crashes/matches.
export const ROLE_RANK = { player: 0, support: 1, moderator: 2, admin: 3, owner: 4 };
export function requireRole(user, min) {
  if (!user) throw unauthorized();
  if ((ROLE_RANK[user.role] || 0) < ROLE_RANK[min]) throw forbidden('requires ' + min + ' role');
}

export async function ctxOf(request, app) {
  const user = request.user || null;
  return { req: request, app, db: app.db, user, audit: (action, target, detail) => app.audit(user && user.id, action, target, detail) };
}
