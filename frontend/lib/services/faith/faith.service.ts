// lib/services/faith/faith.service.ts — System 25

import { prisma } from "@/lib/prisma";
import { FAITH_VERSE_ENABLED_PAGES } from "@/lib/constants";

export async function getCurrentVerse(pageKey: string) {
  return prisma.versePageAssignment.findFirst({
    where: { pageKey, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { verse: true },
    orderBy: { effectiveAt: "desc" },
  });
}

export async function getEncouragementMessage(placement: string) {
  const messages = await prisma.encouragementMessage.findMany({
    where: { placement, isActive: true },
    orderBy: { order: "asc" },
  });
  if (!messages.length) return null;
  return messages[new Date().getDay() % messages.length];
}

export async function getHopeContent() {
  return prisma.hopePageContent.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
  });
}

export async function getAllVerses(pageSize = 50, page = 0) {
  return prisma.verseLibrary.findMany({
    where: { isActive: true },
    orderBy: { book: "asc" },
    skip: page * pageSize,
    take: pageSize,
  });
}

export async function upsertVerse(reference: string, text: string, book: string, chapter: number, verse: number) {
  return prisma.verseLibrary.upsert({
    where: { reference },
    create: { reference, text, book, chapter, verse, translation: "NKJV", isActive: true },
    update: { text, isActive: true },
  });
}

export async function assignVerseToPage(pageKey: string, verseId: string, isOverride = false) {
  // Deactivate current
  await prisma.versePageAssignment.updateMany({
    where: { pageKey, isActive: true },
    data: { isActive: false, expiresAt: new Date() },
  });
  // Create new
  return prisma.versePageAssignment.create({
    data: { pageKey, verseId, isActive: true, effectiveAt: new Date(), isOverride, rotationWeek: getISOWeek(new Date()) },
  });
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
