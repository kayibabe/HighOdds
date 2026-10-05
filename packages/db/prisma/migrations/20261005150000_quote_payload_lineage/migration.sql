-- Each captured odds quote now has a direct, immutable reference to the exact provider payload
-- page from which it was parsed. Existing historical quotes remain intentionally nullable.
CREATE INDEX "OddsQuote_rawPayloadId_idx" ON "OddsQuote"("rawPayloadId");

ALTER TABLE "OddsQuote" ADD CONSTRAINT "OddsQuote_rawPayloadId_fkey"
  FOREIGN KEY ("rawPayloadId") REFERENCES "RawProviderPayload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
