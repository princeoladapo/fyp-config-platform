// Creates the database client (Prisma 7 with the PostgreSQL driver adapter).
// The connection string comes from DATABASE_URL in .env and is never stored elsewhere.

import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export function createPrismaClient(): PrismaClient {
  config({ quiet: true });
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Create .env from .env.example (scripts/setup.ps1 does this).');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
