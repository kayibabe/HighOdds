-- A candidate can be universally valid yet be deliberately ineligible in a particular ticket
-- tier. Preserve that distinction with the immutable snapshot rather than inferring it later.
ALTER TABLE "CandidateSnapshot"
  ADD COLUMN "tierEligibility" JSONB NOT NULL DEFAULT '{}';
