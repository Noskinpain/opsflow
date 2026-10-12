import { prisma } from '../prisma.ts';

export interface IdempotencyResult<T> {
  processed: boolean;
  cached: boolean;
  data: T;
  processedAt: Date;
}

export class IdempotencyService {
  /**
   * Executes an operation idempotently using the `processed_events` table.
   * If `eventId` has already been processed:
   * - Immediately returns the recorded result without running `operation()`.
   * If `eventId` is new:
   * - Runs `operation()`, records the output atomically, and returns the result.
   * - Handles concurrent race conditions on `event_id` gracefully via unique constraint.
   */
  static async runIdempotent<T>(
    eventId: string,
    eventType: string,
    payload: any,
    operation: () => Promise<T>
  ): Promise<IdempotencyResult<T>> {
    if (!eventId || typeof eventId !== 'string') {
      throw new Error('An eventId string is required to enforce idempotency.');
    }

    // 1. Fast check: has this event already been processed?
    const existing = await prisma.processedEvent.findUnique({
      where: { event_id: eventId },
    });

    if (existing) {
      return {
        processed: true,
        cached: true,
        data: existing.result as T,
        processedAt: existing.processed_at,
      };
    }

    // 2. Execute operation
    const result = await operation();

    // 3. Atomically persist execution in processed_events
    try {
      const record = await prisma.processedEvent.create({
        data: {
          event_id: eventId,
          event_type: eventType,
          payload: payload ?? {},
          result: (result as any) ?? {},
          processed_at: new Date(),
        },
      });

      return {
        processed: true,
        cached: false,
        data: result,
        processedAt: record.processed_at,
      };
    } catch (err: any) {
      // Prisma P2002 = Unique constraint violation (another concurrent process processed it simultaneously)
      if (err.code === 'P2002') {
        const winner = await prisma.processedEvent.findUnique({
          where: { event_id: eventId },
        });
        if (winner) {
          return {
            processed: true,
            cached: true,
            data: winner.result as T,
            processedAt: winner.processed_at,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Checks if an event ID has already been recorded without executing.
   */
  static async isProcessed(eventId: string): Promise<boolean> {
    const existing = await prisma.processedEvent.findUnique({
      where: { event_id: eventId },
      select: { id: true },
    });
    return Boolean(existing);
  }
}
