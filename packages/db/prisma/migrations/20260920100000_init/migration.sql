-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUBSCRIBER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DUE', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "FixtureStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketTier" AS ENUM ('STANDARD', 'VALUE', 'HIGH');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PUBLISHED', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "SettlementOutcome" AS ENUM ('WIN', 'LOSS', 'VOID', 'PENDING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'SUBSCRIBER',
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "runAfter" TIMESTAMP(3) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DUE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiQuotaUsage" (
    "id" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "quotaLimit" INTEGER NOT NULL,
    "safetyPercent" INTEGER NOT NULL DEFAULT 90,
    "degradedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuotaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawProviderPayload" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerUpdatedAt" TIMESTAMP(3),
    "body" JSONB NOT NULL,

    CONSTRAINT "RawProviderPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "competitionId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3) NOT NULL,
    "status" "FixtureStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeGoals" INTEGER,
    "awayGoals" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmaker" (
    "id" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 999,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bookmaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT,
    "selectionEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OddsQuote" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "decimalOdds" DECIMAL(10,4) NOT NULL,
    "providerUpdatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayloadId" TEXT,

    CONSTRAINT "OddsQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRun" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "trainedUntil" TIMESTAMP(3) NOT NULL,
    "artifact" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "probability" DECIMAL(8,6) NOT NULL,
    "modelRunId" TEXT NOT NULL,
    "asOfAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketVersion" (
    "id" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "tier" "TicketTier" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'PUBLISHED',
    "bookmakerId" TEXT NOT NULL,
    "combinedOdds" DECIMAL(12,4) NOT NULL,
    "confidenceThreshold" INTEGER NOT NULL,
    "relaxed" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockAt" TIMESTAMP(3) NOT NULL,
    "supersedesId" TEXT,
    "decision" JSONB NOT NULL,

    CONSTRAINT "TicketVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLeg" (
    "id" TEXT NOT NULL,
    "ticketVersionId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "decimalOdds" DECIMAL(10,4) NOT NULL,
    "probability" DECIMAL(8,6) NOT NULL,

    CONSTRAINT "TicketLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "ticketVersionId" TEXT NOT NULL,
    "outcome" "SettlementOutcome" NOT NULL DEFAULT 'PENDING',
    "profitUnits" DECIMAL(12,4),
    "settledAt" TIMESTAMP(3),
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_email_key" ON "AdminCredential"("email");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_idempotencyKey_key" ON "JobRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JobRun_status_runAfter_idx" ON "JobRun"("status", "runAfter");

-- CreateIndex
CREATE INDEX "JobRun_leaseExpiresAt_idx" ON "JobRun"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuotaUsage_usageDate_key" ON "ApiQuotaUsage"("usageDate");

-- CreateIndex
CREATE INDEX "RawProviderPayload_endpoint_requestKey_idx" ON "RawProviderPayload"("endpoint", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RawProviderPayload_endpoint_requestKey_page_receivedAt_key" ON "RawProviderPayload"("endpoint", "requestKey", "page", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_providerId_key" ON "Competition"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_providerId_key" ON "Team"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_providerId_key" ON "Fixture"("providerId");

-- CreateIndex
CREATE INDEX "Fixture_kickoff_status_idx" ON "Fixture"("kickoff", "status");

-- CreateIndex
CREATE INDEX "Fixture_competitionId_kickoff_idx" ON "Fixture"("competitionId", "kickoff");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmaker_providerId_key" ON "Bookmaker"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_providerId_key" ON "Market"("providerId");

-- CreateIndex
CREATE INDEX "OddsQuote_fixtureId_capturedAt_idx" ON "OddsQuote"("fixtureId", "capturedAt");

-- CreateIndex
CREATE INDEX "OddsQuote_bookmakerId_marketId_selection_idx" ON "OddsQuote"("bookmakerId", "marketId", "selection");

-- CreateIndex
CREATE INDEX "Prediction_fixtureId_marketId_selection_asOfAt_idx" ON "Prediction"("fixtureId", "marketId", "selection", "asOfAt");

-- CreateIndex
CREATE INDEX "TicketVersion_targetDate_tier_publishedAt_idx" ON "TicketVersion"("targetDate", "tier", "publishedAt");

-- CreateIndex
CREATE INDEX "TicketVersion_lockAt_idx" ON "TicketVersion"("lockAt");

-- CreateIndex
CREATE INDEX "TicketLeg_fixtureId_idx" ON "TicketLeg"("fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketLeg_ticketVersionId_fixtureId_key" ON "TicketLeg"("ticketVersionId", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_ticketVersionId_key" ON "Settlement"("ticketVersionId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsQuote" ADD CONSTRAINT "OddsQuote_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsQuote" ADD CONSTRAINT "OddsQuote_bookmakerId_fkey" FOREIGN KEY ("bookmakerId") REFERENCES "Bookmaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsQuote" ADD CONSTRAINT "OddsQuote_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "ModelRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketVersion" ADD CONSTRAINT "TicketVersion_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "TicketVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLeg" ADD CONSTRAINT "TicketLeg_ticketVersionId_fkey" FOREIGN KEY ("ticketVersionId") REFERENCES "TicketVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLeg" ADD CONSTRAINT "TicketLeg_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_ticketVersionId_fkey" FOREIGN KEY ("ticketVersionId") REFERENCES "TicketVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- HighOdds paper-ticket protections: immutable publications and no post-lock successor.
CREATE OR REPLACE FUNCTION highodds_reject_ticket_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Published ticket versions are append-only; create a successor version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER highodds_ticket_version_no_update
BEFORE UPDATE OR DELETE ON "TicketVersion"
FOR EACH ROW EXECUTE FUNCTION highodds_reject_ticket_mutation();

CREATE TRIGGER highodds_ticket_leg_no_update
BEFORE UPDATE OR DELETE ON "TicketLeg"
FOR EACH ROW EXECUTE FUNCTION highodds_reject_ticket_mutation();

CREATE OR REPLACE FUNCTION highodds_reject_locked_successor()
RETURNS trigger AS $$
DECLARE predecessor_lock_at timestamptz;
BEGIN
  IF NEW."supersedesId" IS NOT NULL THEN
    SELECT "lockAt" INTO predecessor_lock_at FROM "TicketVersion" WHERE id = NEW."supersedesId";
    IF predecessor_lock_at IS NULL THEN
      RAISE EXCEPTION 'Superseded ticket version does not exist';
    END IF;
    IF predecessor_lock_at <= now() THEN
      RAISE EXCEPTION 'Cannot revise a ticket after its lock time';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER highodds_ticket_version_lock_successor
BEFORE INSERT ON "TicketVersion"
FOR EACH ROW EXECUTE FUNCTION highodds_reject_locked_successor();

