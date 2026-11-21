import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createDatabase(connectionString: string) {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 10 }) });
  const originalTx = client.$transaction.bind(client);
  client.$transaction = ((fnOrArray: any, options?: any) => {
    return originalTx(fnOrArray, {
      maxWait: 15000,
      timeout: 30000,
      ...options,
    });
  }) as any;
  return client;
}
export type Database = ReturnType<typeof createDatabase>;
