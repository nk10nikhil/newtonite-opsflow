import 'fastify';
import type { TeamRole } from '@opsdesk/contracts';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email: string; name: string } | null;
  }
}

export type AuthContextMembership = { teamId: string; role: TeamRole };
