import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(5).max(30).optional(),
  dob: z.string().date().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
});
