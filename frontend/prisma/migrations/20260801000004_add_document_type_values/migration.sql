-- Migration: add_document_type_values
-- Adds buyer-facing document types used in DocumentUploadButton
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'DRIVERS_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'INCOME_VERIFICATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'BANK_STATEMENT';
