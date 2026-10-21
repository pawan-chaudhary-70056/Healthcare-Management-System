import mongoose from 'mongoose';

/**
 * withTransaction helper — Database Design §6.
 * Any multi-document write must run inside a Mongo transaction.
 */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
