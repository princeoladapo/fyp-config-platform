// Runs a full validation and stores it in the database: declared configuration from Git,
// live configuration from the Kubernetes cluster, rules and the environment mapping from
// the database (seed them first with: npx prisma db seed).
// Usage: npx tsx src/demo.ts
// Stored runs can be listed afterwards with: npx tsx src/runsCli.ts list

import { createPrismaClient } from './db';
import { formatFindings } from './runs/formatFindings';
import { executeRun, RunFailedError } from './runs/runService';

async function main() {
  const prisma = createPrismaClient();
  try {
    const { run, findings } = await executeRun(prisma);

    console.log(`Loaded ${run.rulesChecked} rules from the database.`);
    console.log(`Read ${run.declaredRecordCount} declared records from Git (${run.gitRef} = ${run.gitCommit?.slice(0, 12)}).`);
    console.log(`Read ${run.liveRecordCount} live records from Kubernetes (${run.kubeContext ?? 'current context'}).`);
    console.log(`Stored as run #${run.id}: ${run.status} in ${run.durationMs} ms.\n`);
    formatFindings(findings).forEach((line) => console.log(line));
  } catch (error) {
    if (error instanceof RunFailedError) {
      console.error(`Run #${error.runId} FAILED (stored in the database): ${error.message}`);
    } else {
      console.error((error as Error).message);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
