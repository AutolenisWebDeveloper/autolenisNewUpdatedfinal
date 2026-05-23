-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'auction_invitations')) IS NOT NULL THEN
    ALTER TABLE "auction_invitations" ADD CONSTRAINT "auction_invitations_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
