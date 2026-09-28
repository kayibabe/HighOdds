CREATE TABLE "ValidationPick" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "probability" DECIMAL(8,6) NOT NULL,
    "decimalOdds" DECIMAL(10,4) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationPick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValidationPick_ruleKey_fixtureId_marketKey_selection_key"
ON "ValidationPick"("ruleKey", "fixtureId", "marketKey", "selection");

CREATE INDEX "ValidationPick_ruleKey_selectedAt_idx" ON "ValidationPick"("ruleKey", "selectedAt");
CREATE INDEX "ValidationPick_fixtureId_idx" ON "ValidationPick"("fixtureId");

ALTER TABLE "ValidationPick" ADD CONSTRAINT "ValidationPick_fixtureId_fkey"
FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ValidationPick" ADD CONSTRAINT "ValidationPick_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "OddsQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
