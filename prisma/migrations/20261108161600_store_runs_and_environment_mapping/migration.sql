/*
  Warnings:

  - Added the required column `git_ref` to the `validation_runs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "validation_runs" ADD COLUMN     "declared_record_count" INTEGER,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "finding_count" INTEGER,
ADD COLUMN     "git_commit" TEXT,
ADD COLUMN     "git_ref" TEXT NOT NULL,
ADD COLUMN     "kube_context" TEXT,
ADD COLUMN     "live_record_count" INTEGER,
ADD COLUMN     "rules_checked" INTEGER;

-- CreateIndex
CREATE INDEX "findings_run_id_idx" ON "findings"("run_id");
