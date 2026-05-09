// Re-shuffle features for variety so multi-feature filters return non-zero
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const COMBOS: string[][] = [
  ["Apple CarPlay", "Backup Camera", "Heated Seats", "Sunroof"],
  ["Android Auto", "Backup Camera", "Heated Seats", "Sunroof", "Navigation"],
  ["Apple CarPlay", "Backup Camera", "Blind Spot Monitor", "Heated Seats"],
  ["Android Auto", "Backup Camera", "Lane Assist", "Sunroof"],
  ["Apple CarPlay", "Heated Seats", "Sunroof", "Remote Start", "Navigation"],
  ["Android Auto", "Backup Camera", "Heated Seats", "Blind Spot Monitor", "Sunroof"],
  ["Apple CarPlay", "Backup Camera", "Sunroof", "Lane Assist"],
  ["Android Auto", "Heated Seats", "Backup Camera", "Remote Start"],
];

async function main() {
  const items = await p.inventoryItem.findMany({ where: { isActive: true }, select: { id: true, bodyType: true } });
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let feats = COMBOS[i % COMBOS.length].slice();
    if (it.bodyType === "SUV" || it.bodyType === "Van") feats = [...feats, "Third Row"];
    feats = Array.from(new Set(feats));
    await p.inventoryItem.update({ where: { id: it.id }, data: { features: feats } });
    n++;
  }
  const sun = await p.inventoryItem.count({ where: { isActive: true, features: { has: "Sunroof" } } });
  const heat = await p.inventoryItem.count({ where: { isActive: true, features: { has: "Heated Seats" } } });
  const both = await p.inventoryItem.count({ where: { isActive: true, features: { hasEvery: ["Sunroof", "Heated Seats"] } } });
  console.log(`Reshuffled ${n} items. Sunroof: ${sun}, Heated Seats: ${heat}, BOTH: ${both}`);
}
main().finally(() => p.$disconnect());
