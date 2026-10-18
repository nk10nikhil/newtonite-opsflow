import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient, WorkItemPriority, WorkItemStatus } from '@prisma/client';
import { hashPassword } from '../src/auth/crypto.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();

const teams = [
  { id: 'team-operations', name: 'Operations', slug: 'operations' },
  { id: 'team-payments', name: 'Payments', slug: 'payments' },
  { id: 'team-trust', name: 'Trust & Compliance', slug: 'trust-compliance' },
];

const people = [
  {
    id: 'user-alex',
    name: 'Alex Morgan',
    email: 'alex@opsdesk.local',
    memberships: { operations: 'admin', payments: 'member' },
  },
  {
    id: 'user-blair',
    name: 'Blair Chen',
    email: 'blair@opsdesk.local',
    memberships: { payments: 'admin', 'trust-compliance': 'viewer' },
  },
  {
    id: 'user-casey',
    name: 'Casey Patel',
    email: 'casey@opsdesk.local',
    memberships: { operations: 'member' },
  },
  {
    id: 'user-devon',
    name: 'Devon Kim',
    email: 'devon@opsdesk.local',
    memberships: { payments: 'member', operations: 'viewer' },
  },
  {
    id: 'user-emery',
    name: 'Emery Singh',
    email: 'emery@opsdesk.local',
    memberships: { 'trust-compliance': 'member', payments: 'viewer' },
  },
  {
    id: 'user-frankie',
    name: 'Frankie Rivera',
    email: 'frankie@opsdesk.local',
    memberships: { 'trust-compliance': 'member' },
  },
  {
    id: 'user-gray',
    name: 'Gray Johnson',
    email: 'gray@opsdesk.local',
    memberships: { operations: 'viewer', payments: 'viewer' },
  },
  {
    id: 'user-harper',
    name: 'Harper Brooks',
    email: 'harper@opsdesk.local',
    memberships: { operations: 'member', 'trust-compliance': 'admin' },
  },
] as const;

const workTitles = [
  'Customer cannot complete account verification',
  'Investigate duplicate settlement batch',
  'Review access request for reporting exports',
  'Follow up on delayed card payment',
  'Confirm vendor invoice matches purchase order',
  'Resolve intermittent checkout failures',
  'Review customer data correction request',
  'Investigate elevated refund rate',
  'Approve updated compliance evidence',
  'Restore missing transaction receipt',
  'Check webhook delivery backlog',
  'Verify account closure request',
  'Review payment processor dispute',
  'Investigate duplicate customer profile',
  'Confirm operational handoff for weekend coverage',
  'Update incident response notes',
  'Reconcile unmatched bank transfer',
  'Review high-risk account alert',
  'Approve temporary service access',
  'Investigate failed scheduled payout',
];
const statuses: WorkItemStatus[] = ['open', 'in_progress', 'blocked', 'resolved', 'closed'];
const priorities: WorkItemPriority[] = ['low', 'normal', 'high', 'urgent'];

async function main() {
  const seedPassword = process.env.SEED_PASSWORD ?? 'nk10nikhil';
  const knownDemoPasswords = new Set(['nk10nikhil', 'opsdesk-demo']);
  if (
    process.env.NODE_ENV === 'production' &&
    (seedPassword.length < 16 || knownDemoPasswords.has(seedPassword))
  ) {
    throw new Error(
      'Set a unique SEED_PASSWORD of at least 16 characters before seeding a production database.',
    );
  }
  const passwordHash = await hashPassword(seedPassword);
  for (const team of teams) {
    await prisma.team.upsert({
      where: { slug: team.slug },
      update: { name: team.name },
      create: team,
    });
  }

  for (const person of people) {
    await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, passwordHash },
      create: { id: person.id, email: person.email, name: person.name, passwordHash },
    });
    for (const [slug, role] of Object.entries(person.memberships)) {
      const team = teams.find((candidate) => candidate.slug === slug)!;
      await prisma.teamMembership.upsert({
        where: { userId_teamId: { userId: person.id, teamId: team.id } },
        update: { role },
        create: { userId: person.id, teamId: team.id, role: role as 'admin' | 'member' | 'viewer' },
      });
    }
  }

  const membersByTeam = new Map<string, (typeof people)[number][]>();
  for (const person of people) {
    for (const slug of Object.keys(person.memberships)) {
      const bucket = membersByTeam.get(slug) ?? [];
      bucket.push(person);
      membersByTeam.set(slug, bucket);
    }
  }

  for (let index = 0; index < 150; index += 1) {
    const ordinal = index + 1;
    const team = teams[index % teams.length]!;
    const teamMembers = membersByTeam.get(team.slug)!;
    const creator = teamMembers[index % teamMembers.length]!;
    const status = statuses[index % statuses.length]!;
    const priority = priorities[Math.floor(index / 2) % priorities.length]!;
    const assignee = status === 'open' ? null : teamMembers[(index + 1) % teamMembers.length]!;
    const createdAt = new Date(Date.now() - (index * 37 + 2) * 60 * 60 * 1000);
    const id = `seed-item-${String(ordinal).padStart(3, '0')}`;
    const title = `${workTitles[index % workTitles.length]} #${ordinal}`;
    const item = await prisma.workItem.upsert({
      where: { id },
      update: {},
      create: {
        id,
        teamId: team.id,
        title,
        description: `Investigate and coordinate the next action for request ${ordinal}. Add the findings and handoff details here.`,
        type: [
          'customer_issue',
          'payment_investigation',
          'approval',
          'incident',
          'compliance_request',
        ][index % 5]!,
        status,
        priority,
        assigneeId: assignee?.id ?? null,
        createdBy: creator.id,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
      },
    });

    const createdEventId = `seed-event-${String(ordinal).padStart(3, '0')}-created`;
    if (!(await prisma.workItemEvent.findUnique({ where: { id: createdEventId } }))) {
      await prisma.workItemEvent.create({
        data: {
          id: createdEventId,
          workItemId: item.id,
          actorId: creator.id,
          type: 'work_item.created',
          payload: { title, teamId: team.id },
          createdAt: item.createdAt,
        },
      });
    }

    if (status !== 'open') {
      const statusEventId = `seed-event-${String(ordinal).padStart(3, '0')}-status`;
      if (!(await prisma.workItemEvent.findUnique({ where: { id: statusEventId } }))) {
        await prisma.workItemEvent.create({
          data: {
            id: statusEventId,
            workItemId: item.id,
            actorId: creator.id,
            type: 'work_item.status_changed',
            payload: { to: status },
            createdAt: item.updatedAt,
          },
        });
      }
    }

    if (index % 5 === 0) {
      const commentId = `seed-comment-${String(ordinal).padStart(3, '0')}`;
      if (!(await prisma.workItemComment.findUnique({ where: { id: commentId } }))) {
        await prisma.workItemComment.create({
          data: {
            id: commentId,
            workItemId: item.id,
            authorId: creator.id,
            body: 'Initial review is underway. I will add the investigation result here.',
            createdAt: new Date(item.createdAt.getTime() + 5 * 60 * 1000),
          },
        });
      }
    }
  }

  console.log(`Seeded ${teams.length} teams, ${people.length} users, and 150 work items.`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo accounts use the development SEED_PASSWORD.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
