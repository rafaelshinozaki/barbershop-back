/*
  Warnings:

  - You are about to drop the `Analysis` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AnalysisShare` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Analysis" DROP CONSTRAINT "Analysis_userId_fkey";

-- DropForeignKey
ALTER TABLE "AnalysisShare" DROP CONSTRAINT "AnalysisShare_analysisId_fkey";

-- DropForeignKey
ALTER TABLE "AnalysisShare" DROP CONSTRAINT "AnalysisShare_sharedWithUserId_fkey";

-- DropTable
DROP TABLE "Analysis";

-- DropTable
DROP TABLE "AnalysisShare";
