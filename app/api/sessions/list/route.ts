/**
 * Mengembalikan daftar session user dari DB.
 * Endpoint protected: harus login.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const userId = (session as any).user.id;

  const sessions = await prisma.session.findMany({
    where: { userId },
  });

  sessions.sort((a, b) => {
  const numA = parseInt(a.name.toLowerCase().replace('fb', ''), 10);
  const numB = parseInt(b.name.toLowerCase().replace('fb', ''), 10);
  return numA - numB;
});


  return NextResponse.json({ sessions });
}
