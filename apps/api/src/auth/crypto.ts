import { createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const hashToken = (token: string, secret = process.env.SESSION_SECRET ?? 'opsdesk-local-session-key-change-me') => createHmac('sha256', secret).update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
