-- CreateEnum
CREATE TYPE "BriefingStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "AffiliateLevel" AS ENUM ('L1', 'L2', 'L3');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TrustCheckStatus" AS ENUM ('PASS', 'FLAG', 'BLOCK');

-- CreateEnum
CREATE TYPE "HealthCheckStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "ContractScanRuleType" AS ENUM ('FEE_CAP', 'JUNK_FEE_KEYWORD', 'APR_VALIDATION', 'PAYMENT_PACKING', 'DISCLOSURE_CHECK', 'FINANCE_MARKUP');

-- CreateEnum
CREATE TYPE "VehicleRequestPriority" AS ENUM ('STANDARD', 'EXPEDITED', 'VIP');

-- CreateEnum
CREATE TYPE "WorkflowAutomationStatus" AS ENUM ('PENDING', 'TRIGGERED', 'COMPLETED', 'SKIPPED', 'FAILED');
