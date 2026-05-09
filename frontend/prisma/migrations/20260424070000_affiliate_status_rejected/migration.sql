-- Add REJECTED to AffiliateStatus enum for the affiliate-activation review loop
ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
