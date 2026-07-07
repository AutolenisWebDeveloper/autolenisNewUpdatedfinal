-- Migration: add_esign_envelope_document_key
-- GAP-CRIT — the buyer contract-download route read documentUrl/contractUrl/
-- pdfUrl, none of which exist on e_sign_envelopes, so it ALWAYS 404'd — a buyer
-- could never retrieve their executed contract. This adds the storage key of the
-- combined signed PDF (private "contracts" bucket), populated on
-- envelope-completed. Null until DocuSign reports completion / the PDF is stored.
-- Idempotent (safe to re-run).

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'e_sign_envelopes')) IS NOT NULL THEN
    ALTER TABLE "e_sign_envelopes" ADD COLUMN IF NOT EXISTS "document_key" TEXT;
  END IF;
END $$;
