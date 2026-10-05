-- Preserve the complete price-and-model universe that a paper publication evaluated.  This is
-- additive: existing immutable tickets remain valid, but do not gain retrospective universes.
CREATE TABLE "CandidateSnapshotRun" (
    "id" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateSnapshotRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "decimalOdds" DECIMAL(10,4) NOT NULL,
    "modelProbability" DECIMAL(8,6) NOT NULL,
    "consensusProbability" DECIMAL(8,6) NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "conservativeExpectedValue" DECIMAL(10,6) NOT NULL,
    "baseEligibilityReason" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "ticketTier" "TicketTier",
    "confidenceThreshold" INTEGER,
    CONSTRAINT "CandidateSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TicketVersion" ADD COLUMN "candidateSnapshotRunId" TEXT;

CREATE UNIQUE INDEX "CandidateSnapshot_runId_quoteId_key" ON "CandidateSnapshot"("runId", "quoteId");
CREATE INDEX "CandidateSnapshotRun_targetDate_capturedAt_idx" ON "CandidateSnapshotRun"("targetDate", "capturedAt");
CREATE INDEX "CandidateSnapshot_runId_selected_idx" ON "CandidateSnapshot"("runId", "selected");
CREATE INDEX "CandidateSnapshot_fixtureId_idx" ON "CandidateSnapshot"("fixtureId");
CREATE INDEX "TicketVersion_candidateSnapshotRunId_idx" ON "TicketVersion"("candidateSnapshotRunId");

ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CandidateSnapshotRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_fixtureId_fkey"
  FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "OddsQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketVersion" ADD CONSTRAINT "TicketVersion_candidateSnapshotRunId_fkey"
  FOREIGN KEY ("candidateSnapshotRunId") REFERENCES "CandidateSnapshotRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER highodds_candidate_snapshot_run_no_mutation
BEFORE UPDATE OR DELETE ON "CandidateSnapshotRun"
FOR EACH ROW EXECUTE FUNCTION highodds_reject_ticket_mutation();

CREATE TRIGGER highodds_candidate_snapshot_no_mutation
BEFORE UPDATE OR DELETE ON "CandidateSnapshot"
FOR EACH ROW EXECUTE FUNCTION highodds_reject_ticket_mutation();
