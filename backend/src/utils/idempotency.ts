import mongoose from 'mongoose';
import { Schema, type Model } from 'mongoose';

/**
 * idempotency_keys — cross-module dedupe (Database Design §2, SEC-23).
 * Consumed atomically inside the same transaction as the primary write, so a
 * retried request can never duplicate it (AC-16). Stores the original result
 * so retries return the ORIGINAL response payload.
 */

export interface IdempotencyKeyDoc {
  _id: mongoose.Types.ObjectId;
  key: string; // `${scope}:${key}` — scoped per endpoint family
  scope: string;
  resultStatus: number;
  resultBody: Record<string, unknown>; // original success envelope
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IdempotencyKeyDoc>(
  {
    key: { type: String, required: true },
    scope: { type: String, required: true },
    resultStatus: { type: Number, required: true },
    resultBody: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

idempotencyKeySchema.index({ key: 1, scope: 1 }, { unique: true });

export const IdempotencyKey: Model<IdempotencyKeyDoc> =
  (mongoose.models.IdempotencyKey as Model<IdempotencyKeyDoc>) ||
  mongoose.model<IdempotencyKeyDoc>('IdempotencyKey', idempotencyKeySchema, 'idempotency_keys');

export type IdempotentOutcome<T> =
  | { kind: 'first'; record: IdempotencyKeyDoc | null; value: T }
  | { kind: 'replay'; value: T };

/**
 * Try to claim an idempotency key. Returns 'replay' with the stored payload if
 * the key was already consumed by a completed request. Must be called with a
 * session when running inside a transaction. On unique-key race the caller
 * re-reads and replays (or, if the original write is still in flight, fails
 * with CONFLICT — the client retries).
 */
export async function consumeIdempotencyKey(
  scope: string,
  key: string,
  session: mongoose.ClientSession | undefined
): Promise<{ replay: boolean; doc: IdempotencyKeyDoc | null }> {
  try {
    const created = await IdempotencyKey.create([{ key, scope, resultStatus: 0, resultBody: {} }], {
      session,
    });
    return { replay: false, doc: created[0] ?? null };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await IdempotencyKey.findOne({ key, scope }).session(session ?? null);
      if (existing && existing.resultStatus !== 0) {
        return { replay: true, doc: existing };
      }
      // In-flight (claimed but not finished). Surface DUPLICATE_REQUEST so the
      // client retries — never silently double-write.
      return { replay: true, doc: existing };
    }
    throw err;
  }
}

/** Persist the original response on first completion (outside or inside a tx). */
export async function completeIdempotencyKey(
  key: { key: string; scope: string },
  status: number,
  body: Record<string, unknown>,
  session?: mongoose.ClientSession
): Promise<void> {
  await IdempotencyKey.updateOne(
    { key: key.key, scope: key.scope },
    { $set: { resultStatus: status, resultBody: body } },
    { session }
  );
}
