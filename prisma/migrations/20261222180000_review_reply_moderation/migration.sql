-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "replyHiddenAt" TIMESTAMP(3),
ADD COLUMN     "reportDismissedComment" TEXT;
