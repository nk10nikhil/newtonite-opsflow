import { z } from 'zod';
import {
  assignSchema,
  commentSchema,
  createWorkItemSchema,
  prioritySchema,
  statusSchema,
  transitionSchema,
  updateWorkItemSchema,
} from '@opsdesk/contracts';

export {
  assignSchema,
  commentSchema,
  createWorkItemSchema,
  prioritySchema,
  statusSchema,
  transitionSchema,
  updateWorkItemSchema,
};

export const claimSchema = z
  .object({ expectedVersion: z.number().int().positive().optional() })
  .default({});
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
