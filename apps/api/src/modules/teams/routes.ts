import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireUser } from '../../auth/session.js';
import { AppError } from '../../lib/errors.js';

export function registerTeamRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get('/api/teams', async (request) => {
    const user = requireUser(request);
    const memberships = await db.teamMembership.findMany({
      where: { userId: user.id },
      select: { role: true, team: { select: { id: true, name: true, slug: true } } },
      orderBy: { team: { name: 'asc' } },
    });
    return { teams: memberships.map(({ role, team }) => ({ ...team, role })) };
  });

  app.get<{ Params: { id: string } }>('/api/teams/:id/members', async (request) => {
    const user = requireUser(request);
    const membership = await db.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId: request.params.id } },
    });
    if (!membership) {
      const team = await db.team.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!team) throw new AppError(404, 'NOT_FOUND', 'Team not found');
      throw new AppError(403, 'FORBIDDEN', 'You are not a member of this team');
    }
    const members = await db.teamMembership.findMany({
      where: { teamId: request.params.id },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return { members: members.map(({ role, user: member }) => ({ ...member, role })) };
  });
}
