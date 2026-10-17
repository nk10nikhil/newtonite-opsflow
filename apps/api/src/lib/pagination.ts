import { AppError } from './errors.js';

export type CursorPoint = { snapshot: string; at: string; id: string };

export function encodeCursor(point: CursorPoint): string {
  return Buffer.from(JSON.stringify(point)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPoint | undefined {
  if (!cursor) return undefined;
  try {
    const point = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPoint>;
    if (!point.snapshot || !point.at || !point.id || Number.isNaN(Date.parse(point.snapshot)) || Number.isNaN(Date.parse(point.at))) {
      throw new Error('Invalid cursor');
    }
    return point as CursorPoint;
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor');
  }
}

export function pageLimit(value: unknown): number {
  if (value === undefined) return 25;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100');
  }
  return limit;
}
