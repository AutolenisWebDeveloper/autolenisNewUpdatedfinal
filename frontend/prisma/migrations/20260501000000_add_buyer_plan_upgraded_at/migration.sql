-- AlterTable: add plan_upgraded_at to buyers
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "plan_upgraded_at" TIMESTAMP(3);
