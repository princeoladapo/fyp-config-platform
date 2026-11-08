/*
  Warnings:

  - Added the required column `kind` to the `rules` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('FIXED_CONDITION', 'SAME_VALUE', 'RELATIONSHIP');

-- AlterTable
ALTER TABLE "rules" ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "RuleKind" NOT NULL;
