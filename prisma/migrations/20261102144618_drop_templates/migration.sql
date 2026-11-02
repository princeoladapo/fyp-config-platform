/*
  Warnings:

  - You are about to drop the column `template_id` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the `templates` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `rule_id` on table `findings` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_rule_id_fkey";

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_template_id_fkey";

-- AlterTable
ALTER TABLE "findings" DROP COLUMN "template_id",
ALTER COLUMN "rule_id" SET NOT NULL;

-- DropTable
DROP TABLE "templates";

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
