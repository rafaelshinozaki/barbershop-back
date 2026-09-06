-- Rename EmailNotification -> NotificationPreference, and its 4 boolean
-- columns from bare category names to <category>Email (same meaning as
-- before), then add the 4 new <category>InApp columns defaulting to true
-- (matches current behavior where every in-app notification is always
-- delivered regardless of preference).

ALTER TABLE "EmailNotification" RENAME TO "NotificationPreference";

ALTER TABLE "NotificationPreference" RENAME COLUMN "news" TO "newsEmail";
ALTER TABLE "NotificationPreference" RENAME COLUMN "promotions" TO "promotionsEmail";
ALTER TABLE "NotificationPreference" RENAME COLUMN "security" TO "securityEmail";
ALTER TABLE "NotificationPreference" RENAME COLUMN "instability" TO "instabilityEmail";

ALTER TABLE "NotificationPreference" ADD COLUMN "newsInApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "promotionsInApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "securityInApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "instabilityInApp" BOOLEAN NOT NULL DEFAULT true;

ALTER INDEX "EmailNotification_pkey" RENAME TO "NotificationPreference_pkey";
ALTER INDEX "EmailNotification_userId_key" RENAME TO "NotificationPreference_userId_key";
