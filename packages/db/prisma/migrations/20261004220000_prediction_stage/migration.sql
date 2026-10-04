-- Existing forecasts remain selection-window forecasts; previews are explicitly separate.
CREATE TYPE "PredictionStage" AS ENUM ('SELECTION', 'PRELIMINARY');
ALTER TABLE "Prediction" ADD COLUMN "stage" "PredictionStage" NOT NULL DEFAULT 'SELECTION';
