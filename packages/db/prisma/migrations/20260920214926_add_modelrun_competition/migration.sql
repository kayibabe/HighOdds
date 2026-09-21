-- AlterTable
ALTER TABLE "ModelRun" ADD COLUMN     "competitionId" TEXT;

-- CreateIndex
CREATE INDEX "ModelRun_competitionId_createdAt_idx" ON "ModelRun"("competitionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ModelRun" ADD CONSTRAINT "ModelRun_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
