-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'CONSISTENT', 'VIOLATIONS_FOUND', 'FAILED');

-- CreateEnum
CREATE TYPE "Representation" AS ENUM ('DECLARED', 'LIVE');

-- CreateTable
CREATE TABLE "environments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "git_directory" TEXT NOT NULL,
    "k8s_namespace" TEXT NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "environments" TEXT[],
    "condition" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "environment_scope" TEXT NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_runs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "environment_id" INTEGER NOT NULL,
    "rule_id" INTEGER,
    "template_id" INTEGER,
    "resource_kind" TEXT NOT NULL,
    "resource_name" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "representation" "Representation" NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "environments_name_key" ON "environments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rules_name_key" ON "rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "templates_name_key" ON "templates"("name");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "validation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
