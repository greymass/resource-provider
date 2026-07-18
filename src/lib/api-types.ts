import { t } from 'elysia';

const closed = { additionalProperties: false } as const;

function errorResponse<const Code extends 401 | 403 | 404 | 409 | 422>(code: Code) {
	return t.Object({ code: t.Literal(code), message: t.String() }, closed);
}

export const apiUnauthorized = errorResponse(401);
export const apiForbidden = errorResponse(403);
export const apiNotFound = errorResponse(404);
export const apiConflict = errorResponse(409);
export const apiUnprocessable = errorResponse(422);
export const apiSuccess = t.Object({ code: t.Literal(200), message: t.String() }, closed);
