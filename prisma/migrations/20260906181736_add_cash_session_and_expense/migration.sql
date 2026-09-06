-- AlterTable
ALTER TABLE "NotificationPreference" ALTER COLUMN "newsEmail" SET DEFAULT true,
ALTER COLUMN "promotionsEmail" SET DEFAULT true,
ALTER COLUMN "instabilityEmail" SET DEFAULT true,
ALTER COLUMN "securityEmail" SET DEFAULT true;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cashSessionId" INTEGER;

-- CreateTable
CREATE TABLE "CashSession" (
    "id" SERIAL NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "openedByUserId" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingBalance" DECIMAL(65,30) NOT NULL,
    "closedByUserId" INTEGER,
    "closedAt" TIMESTAMP(3),
    "countedBalance" DECIMAL(65,30),
    "expectedBalance" DECIMAL(65,30),
    "difference" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "cashSessionId" INTEGER,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paymentMethod" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSession_barbershopId_idx" ON "CashSession"("barbershopId");

-- CreateIndex
CREATE INDEX "CashSession_barbershopId_status_idx" ON "CashSession"("barbershopId", "status");

-- CreateIndex
CREATE INDEX "Expense_barbershopId_idx" ON "Expense"("barbershopId");

-- CreateIndex
CREATE INDEX "Expense_barbershopId_expenseDate_idx" ON "Expense"("barbershopId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_cashSessionId_idx" ON "Expense"("cashSessionId");

-- CreateIndex
CREATE INDEX "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");

-- RenameForeignKey
ALTER TABLE "NotificationPreference" RENAME CONSTRAINT "EmailNotification_userId_fkey" TO "NotificationPreference_userId_fkey";

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
