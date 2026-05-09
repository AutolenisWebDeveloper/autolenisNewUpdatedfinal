// lib/services/affiliate/affiliate-network.service.ts
import { prisma } from "@/lib/prisma";

export async function getNetworkTree(affiliateId: string, maxDepth = 3) {
  async function getChildren(parentId: string, depth: number): Promise<unknown[]> {
    if (depth >= maxDepth) return [];
    const children = await prisma.affiliate.findMany({ where: { parentId }, include: { user: { select: { email: true } } } });
    return Promise.all(children.map(async c => ({ id: c.id, email: maskEmail(c.user.email), level: c.level, children: await getChildren(c.id, depth + 1) })));
  }
  const root = await prisma.affiliate.findUnique({ where: { id: affiliateId }, include: { user: { select: { email: true } } } });
  if (!root) return null;
  const children = await getChildren(affiliateId, 0);
  return { id: root.id, email: maskEmail(root.user.email), level: root.level, children };
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}
