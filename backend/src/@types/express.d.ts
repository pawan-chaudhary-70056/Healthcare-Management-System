import type { Role } from '../config/constants.js';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: {
        id: string;
        email: string;
        role: Role;
        permissions: string[];
      };
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    role?: Role;
    mfaPending?: boolean;
  }
}
