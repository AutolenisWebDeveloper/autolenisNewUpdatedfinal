-- CreateEnum
CREATE TYPE "ContentJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PAUSED');

-- AlterTable
ALTER TABLE "content_articles"
    ADD COLUMN     "scheduled_at" TIMESTAMP(3),
    ADD COLUMN     "approved_at" TIMESTAMP(3),
    ADD COLUMN     "approved_by_admin_id" TEXT,
    ADD COLUMN     "last_published_at" TIMESTAMP(3),
    ADD COLUMN     "publish_failure_reason" TEXT,
    ADD COLUMN     "publication_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN     "canonical_url" TEXT,
    ADD COLUMN     "noindex" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "featured_image_url" TEXT,
    ADD COLUMN     "featured_image_alt" TEXT,
    ADD COLUMN     "featured_image_status" TEXT,
    ADD COLUMN     "featured_image_prompt" TEXT,
    ADD COLUMN     "featured_image_provider" TEXT,
    ADD COLUMN     "featured_image_generated_at" TIMESTAMP(3),
    ADD COLUMN     "lifecycle_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN     "refresh_due_at" TIMESTAMP(3),
    ADD COLUMN     "last_validated_at" TIMESTAMP(3),
    ADD COLUMN     "last_refreshed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "content_article_versions" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "meta_description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "faq_json" TEXT,
    "quality_score" INTEGER,
    "compliance_result_json" TEXT,
    "generated_by_model" TEXT,
    "created_by_admin_id" TEXT,
    "created_by_job_id" TEXT,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_generation_jobs" (
    "id" TEXT NOT NULL,
    "status" "ContentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "job_type" TEXT NOT NULL,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "succeeded_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "created_by_admin_id" TEXT,
    "filter_json" TEXT,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_generation_job_items" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" "ContentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "inngest_run_id" TEXT,
    "article_id" TEXT,
    "target_slug" TEXT,
    "payload_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_generation_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_validation_results" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "check_results_json" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "overridden_by_admin_id" TEXT,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media_assets" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_workflow_events" (
    "id" TEXT NOT NULL,
    "article_id" TEXT,
    "job_id" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "payload_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_articles_scheduled_at_idx" ON "content_articles"("scheduled_at");
CREATE INDEX "content_articles_refresh_due_at_idx" ON "content_articles"("refresh_due_at");
CREATE INDEX "content_articles_lifecycle_status_idx" ON "content_articles"("lifecycle_status");
CREATE INDEX "content_articles_cluster_status_idx" ON "content_articles"("cluster", "status");
CREATE INDEX "content_articles_metro_status_idx" ON "content_articles"("metro", "status");
CREATE INDEX "content_articles_noindex_idx" ON "content_articles"("noindex");

-- CreateIndex
CREATE UNIQUE INDEX "content_article_versions_article_id_version_number_key" ON "content_article_versions"("article_id", "version_number");
CREATE INDEX "content_article_versions_article_id_version_number_idx" ON "content_article_versions"("article_id", "version_number");

-- CreateIndex
CREATE INDEX "content_generation_jobs_status_idx" ON "content_generation_jobs"("status");
CREATE INDEX "content_generation_jobs_job_type_idx" ON "content_generation_jobs"("job_type");
CREATE INDEX "content_generation_jobs_created_at_idx" ON "content_generation_jobs"("created_at");

-- CreateIndex
CREATE INDEX "content_generation_job_items_job_id_status_idx" ON "content_generation_job_items"("job_id", "status");
CREATE INDEX "content_generation_job_items_status_idx" ON "content_generation_job_items"("status");
CREATE INDEX "content_generation_job_items_article_id_idx" ON "content_generation_job_items"("article_id");
CREATE INDEX "content_generation_job_items_idempotency_key_idx" ON "content_generation_job_items"("idempotency_key");

-- CreateIndex
CREATE INDEX "content_validation_results_article_id_idx" ON "content_validation_results"("article_id");
CREATE INDEX "content_validation_results_article_id_created_at_idx" ON "content_validation_results"("article_id", "created_at");

-- CreateIndex
CREATE INDEX "content_media_assets_article_id_idx" ON "content_media_assets"("article_id");
CREATE INDEX "content_media_assets_status_idx" ON "content_media_assets"("status");

-- CreateIndex
CREATE INDEX "content_workflow_events_article_id_idx" ON "content_workflow_events"("article_id");
CREATE INDEX "content_workflow_events_job_id_idx" ON "content_workflow_events"("job_id");
CREATE INDEX "content_workflow_events_event_type_idx" ON "content_workflow_events"("event_type");
CREATE INDEX "content_workflow_events_created_at_idx" ON "content_workflow_events"("created_at");

-- AddForeignKey
ALTER TABLE "content_article_versions" ADD CONSTRAINT "content_article_versions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_generation_job_items" ADD CONSTRAINT "content_generation_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "content_generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_generation_job_items" ADD CONSTRAINT "content_generation_job_items_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_validation_results" ADD CONSTRAINT "content_validation_results_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_assets" ADD CONSTRAINT "content_media_assets_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_workflow_events" ADD CONSTRAINT "content_workflow_events_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
