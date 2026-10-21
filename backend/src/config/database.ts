import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * MongoDB connection — replica set required (transactions), Backend Spec §1.
 */
export async function connectDatabase(uri?: string): Promise<typeof mongoose> {
  const target = uri ?? env.MONGO_URI;
  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(target);
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

/**
 * Sync all registered models' indexes (idempotent diff + create). Guarantees
 * uniqueness guards — notably the partial unique active-slot index that makes
 * double booking impossible at commit (AC-15, NFR-05) — exist BEFORE the first
 * write instead of racing model-init background builds.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));
}
