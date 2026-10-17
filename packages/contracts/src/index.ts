import { z } from 'zod';

export const statusSchema = z.enum(['open', 'in_progress', 'blocked', 'resolved', 'closed']);
export const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const roleSchema = z.enum(['admin', 'member', 'viewer']);
export const itemTypeSchema = z.enum([
  'customer_issue',
  'incident',
  'payment_investigation',
  'compliance_request',
  'approval',
  'task',
]);

export const createWorkItemSchema = z.object({
  teamId: z.string().min(1),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(10_000).default(''),
  type: itemTypeSchema,
  priority: prioritySchema.default('normal'),
});

export const updateWorkItemSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(10_000).optional(),
    type: itemTypeSchema.optional(),
    priority: prioritySchema.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'expectedVersion'), {
    message: 'At least one field must be updated',
  });

export const transitionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  toStatus: statusSchema,
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(5_000),
  expectedVersion: z.number().int().positive().optional(),
});
export const assignSchema = z.object({
  assigneeId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

export type WorkItemStatus = z.infer<typeof statusSchema>;
export type WorkItemPriority = z.infer<typeof prioritySchema>;
export type TeamRole = z.infer<typeof roleSchema>;
export type WorkItemType = z.infer<typeof itemTypeSchema>;

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export type WorkItemSummary = {
  id: string;
  teamId: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  assignee?: { id: string; name: string } | null;
  team?: { id: string; name: string };
};
