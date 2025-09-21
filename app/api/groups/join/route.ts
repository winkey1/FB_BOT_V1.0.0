/**
 * Upload CSV dengan kolom group_link. Body harus menyertakan JSON selectedSessions[].
 * Field form: file (csv), sessions (JSON string array)
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Papa from 'papaparse';
import { startJoinGroups } from '@/lib/puppeteer-manager';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const userId = (session as any).user.id;

  const form = await req.formData();
  const file = form.get('file') as unknown as File;
  const sessionsField = form.get('sessions') as string | null;
  const concurrencyField = form.get('concurrency') as string | null;
  const groupLimit = form.get('groupLimit') as string | null;
  if (!file || !sessionsField) return NextResponse.json({ error: 'file atau sessions tidak ditemukan' }, { status: 400 });

  const selSessions = JSON.parse(sessionsField) as string[];
  const concurrency = concurrencyField ? parseInt(concurrencyField) : 3;
  const limit = groupLimit ? parseInt(groupLimit) : 20;

  console.log('Concurrency:', concurrency);
  console.log('Group Limit:', limit);
  const buf = await file.arrayBuffer();
  const txt = Buffer.from(buf).toString('utf-8');
  const parsed = Papa.parse(txt, { header: true, skipEmptyLines: true });
  const groups: string[] = [];
  for (const r of parsed.data as any[]) {
    if (r.group_link) groups.push(r.group_link.trim());
  }
  if (groups.length === 0) return NextResponse.json({ error: 'CSV grup kosong' }, { status: 400 });

  const result = await startJoinGroups(userId, selSessions, groups, concurrency, limit);
  return NextResponse.json({ ok: true, result });
}
