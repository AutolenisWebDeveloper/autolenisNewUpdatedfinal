-- Migration: add_auction_reopened_status
-- Adds REOPENED value to AuctionStatus enum for auction reopen functionality
ALTER TYPE "AuctionStatus" ADD VALUE IF NOT EXISTS 'REOPENED';
