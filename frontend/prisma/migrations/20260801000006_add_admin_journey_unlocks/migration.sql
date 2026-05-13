-- CreateTable
CREATE TABLE "admin_journey_unlocks" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_journey_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_aju_buyer" ON "admin_journey_unlocks"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_journey_unlocks_buyer_id_stage_id_key" ON "admin_journey_unlocks"("buyer_id", "stage_id");

-- AddForeignKey
ALTER TABLE "admin_journey_unlocks" ADD CONSTRAINT "admin_journey_unlocks_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
