-- AddForeignKey
ALTER TABLE "auction_invitations" ADD CONSTRAINT "auction_invitations_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
