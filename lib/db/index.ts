// lib/db/index.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

// Create a Neon SQL client
const sql = neon(process.env.DATABASE_URL!);

// Create a Drizzle instance
export const db = drizzle(sql, { schema });