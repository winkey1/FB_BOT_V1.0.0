/**
 * Endpoint untuk mulai Post dan Komen.
 * form fields: image (file), comment (text), sessions (JSON string array)
 * Endpoint menjalankan puppeteer synchronously.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { startPostAndComment } from '@/lib/puppeteer-manager';


export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const userId = (session as any).user.id;

  const form = await req.formData();
  const file = form.get('image') as unknown as File;
  const comment = form.get('comment') as string | null;
  const caption = form.get('caption') as string | null;
  const concurrencyField = form.get('concurrency') as string | null;
  const sessionsField = form.get('sessions') as string | null;

  if (!file || !comment || !sessionsField) return NextResponse.json({ error: 'image, comment, atau sessions hilang' }, { status: 400 });

  const selSessions = JSON.parse(sessionsField) as string[];
  const concurrency = concurrencyField ? parseInt(concurrencyField) : 3;
  const captionToSend = caption ?? "";

  // simpan image sementara
  const uploadDir = process.env.UPLOAD_DIR || './public/uploads';
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const buffer = Buffer.from(await (file as any).arrayBuffer());
  const filename = `${Date.now()}_${file.name}`;
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, buffer);

  const result = await startPostAndComment(userId, selSessions, filepath, comment, concurrency, captionToSend);

  // optionally hapus file setelah selesai
  try { fs.unlinkSync(filepath); } catch {}

  return NextResponse.json({ ok: true, result });
}
