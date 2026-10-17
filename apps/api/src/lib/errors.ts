import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    });
  }

  if ('validation' in error && error.validation) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.validation },
    });
  }

  if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.statusCode === 400 ? 'VALIDATION_ERROR' : 'REQUEST_ERROR',
        message: error.statusCode === 400 ? 'The request could not be parsed' : 'The request could not be completed',
      },
    });
  }

  if (process.env.NODE_ENV !== 'test') _request.log.error({ err: error }, 'request failed');
  return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}
