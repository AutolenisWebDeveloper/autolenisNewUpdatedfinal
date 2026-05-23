-- CreateTable
CREATE TABLE "admin_journey_notes" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_journey_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_journey_notes')) IS NOT NULL THEN
    CREATE INDEX "admin_journey_notes_buyer_id_stage_id_idx" ON "admin_journey_notes"("buyer_id", "stage_id");
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_journey_notes')) IS NOT NULL THEN
    ALTER TABLE "admin_journey_notes" ADD CONSTRAINT "admin_journey_notes_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
