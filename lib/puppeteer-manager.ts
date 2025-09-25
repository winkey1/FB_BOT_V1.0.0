/**
 * Manager Puppeteer yang menyediakan:
 * - startCreateSessions(userId, accounts)
 * - startJoinGroups(userId, sessionIds, groupLinks)
 * - startPostAndComment(userId, sessionIds, imagePath, commentText)
 * - stopAll() untuk meminta stop secara gracefull
 *
 * Catatan penting:
 * - File ini dijalankan pada server Node (bukan serverless). Pastikan deploy di server yang mendukung proses jangka panjang.
 * - Gunakan DATA_DIR dari env. Pastikan folder ada dan writable.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import puppeteer, { Browser, Page } from 'puppeteer';

const DATA_DIR = process.env.DATA_DIR || './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

type Account = { nomorAkun: string; email: string; password: string };

const JOBS: Map<string, {
  browsers: Browser[],
  stopRequested: boolean
}> = new Map();

function sanitizeName(s: string) {
  return s.replace(/[^a-z0-9_.@-]/ig, '_');
}

// fungsi util delay
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// membuat folder user
function ensureUserDir(userId: string) {
  const dir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function startCreateSessions(userId: string, accounts: Account[], concurrency: number) {
    const jobId = uuidv4();
    JOBS.set(jobId, { browsers: [], stopRequested: false });
    const job = JOBS.get(jobId)!;

    const userDir = ensureUserDir(userId);
    let index = 0;
    const results: any[] = [];
    const successSelector = `
        [aria-label="Buat cerita"], 
        [aria-label="Video siaran langsung"], 
        [aria-label="Create story"],
	      [aria-label="Live video"]
    `;	

    async function worker() {
        while (index < accounts.length && !job.stopRequested) {
            const i = index++;
            const acc = accounts[i];
            const sessName = sanitizeName(acc.nomorAkun);
            const sessionPath = path.join(userDir, sessName);
            let browser: Browser | null = null;

            try {
                if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

                browser = await puppeteer.launch({
                    headless: false,
                    userDataDir: sessionPath,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                
                const page = await browser.newPage();
                await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 30000 });

                // ... (Sisa logika login Anda tidak perlu diubah)
                try {
                    await page.waitForSelector(successSelector, { timeout: 7000 });
                    results.push({
                        nomorAkun: acc.nomorAkun, email: acc.email, ok: true,
                        path: sessionPath, message: 'Sesi sudah ada dan valid'
                    });
                } catch (e) {
                    console.log(`Sesi untuk ${acc.nomorAkun} tidak valid, mencoba login...`);
                    try {
                        await page.waitForSelector('input[name="email"][type="text"]', { timeout: 100000 });
                        await page.type('input[name="email"][type="text"]', acc.email, { delay: 100 });
                        await page.type('input[name="pass"][type="password"]', acc.password, { delay: 100 });
                        await page.keyboard.press('Enter');
                        await page.waitForSelector(successSelector, { timeout: 7000 });
                        results.push({
                            nomorAkun: acc.nomorAkun, email: acc.email, ok: true,
                            path: sessionPath, message: 'Login berhasil, sesi baru dibuat'
                        });
                    } catch (loginErr) {
                        results.push({
                            nomorAkun: acc.nomorAkun, email: acc.email, ok: false,
                            message: 'Gagal login: email/password salah atau halaman berubah.'
                        });
                    }
                }

            } catch (err: any) {
                results.push({
                    nomorAkun: acc.nomorAkun, email: acc.email, ok: false,
                    message: 'Gagal membuka browser atau koneksi ke Facebook bermasalah.'
                });
            } finally {
                if (browser) {
                    await browser.close();
                }
            }
            if (job.stopRequested) break;
        }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    Promise.all(workers);
    JOBS.delete(jobId);
    
    const successCount = results.filter(r => r.ok === true).length;
    const failCount = results.filter(r => r.ok === false).length;
    console.log(`📊 Summary Create Sessions: ${successCount} berhasil, ${failCount} gagal`);
    
    return {
        jobId, results,
        summary: { success: successCount, failed: failCount }
    };
}

export async function startJoinGroups(
  userId: string,
  sessionNames: string[],
  groupLinks: string[],
  concurrency: number,
  groupsPerSession: number
) {
  const jobId = uuidv4();
  JOBS.set(jobId, { browsers: [], stopRequested: false });
  const job = JOBS.get(jobId)!;

  const userDir = ensureUserDir(userId);
  const results: any[] = [];

  // Membagi groupLinks per session sekali saja
  const groupsBySession: Record<string, string[]> = {};
  for (let i = 0; i < sessionNames.length; i++) {
    groupsBySession[sessionNames[i]] = [];
  }
  groupLinks.forEach((link, idx) => {
    const sessionIndex = Math.floor(idx / groupsPerSession);
    if (sessionIndex < sessionNames.length) {
      const sessName = sessionNames[sessionIndex];
      groupsBySession[sessName].push(link);
    }
  });

  let sessionIndex = 0;

  async function worker() {
    while (sessionIndex < sessionNames.length && !job.stopRequested) {
      const i = sessionIndex++;
      const sessName = sessionNames[i];

      const sessionPath = path.join(userDir, sanitizeName(sessName));

      let sessionSuccess = 0;
      let sessionFail = 0;
      const sessionResults: any[] = [];

      if (!fs.existsSync(sessionPath)) {
        results.push({
          session: sessName,
          ok: false,
          message: 'Session folder tidak ditemukan',
          summary: { success: 0, failed: 1, total: 1 },
          groups: []
        });
        continue;
      }

      const browser = await puppeteer.launch({
        headless: false,
        userDataDir: sessionPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      job.browsers.push(browser);

      try {
        const page = await browser.newPage();

        const groupsForThisSession = groupsBySession[sessName] || [];
        for (const link of groupsForThisSession) {
          if (job.stopRequested) break;

          let joined = false;
          try {
            await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
            const joinBtn = await page.waitForSelector('xpath///span[text()="Gabung ke grup"]',{ timeout: 10000 }).catch(() => null);

            if (joinBtn) {
              await delay(1000);
              await joinBtn.click().catch(() => {});
              await delay(3000);
              joined = true;
            } else {
              await page.click('xpath///span[text()="Join Group"]').catch(() => null);
            }
            sessionResults.push({ group: link, ok: joined });
            if (joined) sessionSuccess++;
            else sessionFail++;
          } catch (err: any) {
            sessionResults.push({ group: link, ok: false, message: err.message });
            sessionFail++;
          }
        }

        results.push({
          session: sessName,
          ok: true,
          message: 'Selesai',
          summary: {
            success: sessionSuccess,
            failed: sessionFail,
            total: sessionSuccess + sessionFail
          },
          groups: sessionResults
        });
      } finally {
        await browser.close().catch(() => {});
        job.browsers = job.browsers.filter(b => b !== browser);
      }
    }
  }

  // Jalankan worker sesuai concurrency
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  JOBS.delete(jobId);
  return { jobId, results };
}

async function postCommentDirectly(page: Page, text: string) {
  
  try {
    const commentTextbox = await page.waitForSelector('div[aria-label="Komentari sebagai Peserta anonim"]', { visible: true, timeout: 15000 });
    if (!commentTextbox) return false;

    await commentTextbox.focus();
    await page.keyboard.type(text, { delay: 80 }); 
    await delay(5000);
    await page.keyboard.press('Enter'); 

    return true;
  } catch (error) {
    console.error("⚠️ Gagal mengirim komentar:", error);
    return false;
  }
}


async function attemptPostingWithRetries(
  page: Page,
  imagePath: string,
  text: string,
  job: { stopRequested: boolean },
  results: any[],
  captionText: string
) {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (job.stopRequested) return false;

    try {
      const anonBtn = await page.waitForSelector("[aria-label='Postingan anonim']", { timeout: 10000 }).catch(()=>null);
      if(anonBtn){
      if (job.stopRequested) return false;
      if (anonBtn) await anonBtn.click().catch(()=>{});
   
      const createAnonBtn = await page.waitForSelector('xpath///span[text()="Buat Postingan Anonim"]',{ timeout: 10000 }).catch(()=>null);
      if (job.stopRequested) return false;
      if (createAnonBtn) await createAnonBtn.click().catch(()=>{});
      await page.waitForSelector('[aria-placeholder="Kirim postingan anonim..."]', { visible: true, timeout: 10000 }).catch(()=>{});
      if (job.stopRequested) return false;

      // pilih gambar
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        page.click('div[aria-label="Foto/video"]').catch(()=>{})
      ]);
      if (job.stopRequested) return false;
      if (fileChooser) {
        await fileChooser.accept([imagePath]);
      }

      await page.type('[aria-placeholder="Kirim postingan anonim..."]', captionText);

      await page.waitForSelector('[aria-label="Kirim"][role="button"]', { visible: true, timeout: 60000 });
 
      await page.click('[aria-label="Kirim"][role="button"]');
      const commentOk = await postCommentDirectly(page, text);

      if (commentOk) {
        results.push({ post: true, comment: true, message: 'Postingan dan komentar berhasil' });
      } else {
        results.push({ post: true, comment: false, message: 'Postingan ditangguhkan' });
      }

    }else{
     const altAnonBtn = await page.waitForSelector("[aria-label='Anonymous post']", { timeout: 10000 }).catch(()=>null);
     if(altAnonBtn){
     if (altAnonBtn) await altAnonBtn.click().catch(()=>{});

       const createAnonBtn = await page.waitForSelector('xpath///span[text()="Create Anonymous Post"]',{ timeout: 10000 }).catch(()=>null);
      if (job.stopRequested) return false;
      if (createAnonBtn) await createAnonBtn.click().catch(()=>{});
      await page.waitForSelector('[aria-placeholder="Submit anonymous post..."]', { visible: true, timeout: 10000 }).catch(()=>{});
      if (job.stopRequested) return false;

      // pilih gambar
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        page.click('div[aria-label="Foto/video"]').catch(()=>{})
      ]);
      if (job.stopRequested) return false;
      if (fileChooser) {
        await fileChooser.accept([imagePath]);
      }

      await page.type('[aria-placeholder="Submit anonymous post..."]', captionText);

      await page.waitForSelector('[aria-label="Submit"][role="button"]', { visible: true, timeout: 60000 });
 
      await page.click('[aria-label="Submit"][role="button"]');
      const commentOk = await postCommentDirectly(page, text);

      if (commentOk) {
        results.push({ post: true, comment: true, message: 'Postingan dan komentar berhasil' });
      } else {
        results.push({ post: true, comment: false, message: 'Postingan ditangguhkan' });
      }

    }else{
    const currentUrl = page.url();
    const buySellUrl = currentUrl.endsWith('/')
    ? `${currentUrl}buy_sell_discussion`
    : `${currentUrl}/buy_sell_discussion`;

      await page.goto(buySellUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      if (job.stopRequested) return false;
      const anonBtn = await page.waitForSelector("[aria-label='Postingan anonim']", { timeout: 10000 }).catch(()=>null);
      if (job.stopRequested) return false;
      if (anonBtn) await anonBtn.click().catch(()=>{});

      const createAnonBtn = await page.waitForSelector('xpath///span[text()="Buat Postingan Anonim"]',{ timeout: 10000 }).catch(()=>null);
      if (job.stopRequested) return false;
      if (createAnonBtn) await createAnonBtn.click().catch(()=>{});

      await page.waitForSelector('div[aria-placeholder="Kirim postingan anonim..."]', { visible: true, timeout: 10000 }).catch(()=>{});
      if (job.stopRequested) return false;

      // pilih gambar
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        page.click('div[aria-label="Foto/video"]').catch(()=>{})
      ]);
      if (job.stopRequested) return false;
      if (fileChooser) {
        await fileChooser.accept([imagePath]);
      }

      await page.type('[aria-placeholder="Kirim postingan anonim..."]', captionText);

      await page.waitForSelector('[aria-label="Kirim"][role="button"]', { visible: true, timeout: 60000 });
 
      await page.click('[aria-label="Kirim"][role="button"]');

      const commentOk = await postCommentDirectly(page, text);

      if (commentOk) {
        results.push({ post: true, comment: true, message: 'Postingan dan komentar berhasil' });
      } else {
        results.push({ post: true, comment: false, message: 'Postingan ditangguhkan' });
      }
    }
  }
  
      return true;

    } catch (err) {
      console.error(`⚠️ Error attempt ${attempt}:`, err);

      if (job.stopRequested) return false;
      if (attempt < MAX_ATTEMPTS) {
        await page.reload({ waitUntil: 'networkidle2' }).catch(()=>{});
        await delay(5000);
      } else {
        results.push({ post: false, comment: false, message: String(err) });
        return false;
      }
    }
  }

  return false;
}


export async function startPostAndComment(userId: string, sessionNames: string[], imagePath: string, commentText: string, concurrency: number, captionText:string) {
  const jobId = uuidv4();
  JOBS.set(jobId, { browsers: [], stopRequested: false });
  const job = JOBS.get(jobId)!;
  const userDir = ensureUserDir(userId);

  const results: any[] = [];
  let idx = 0;

  async function worker() {
    while (idx < sessionNames.length && !job.stopRequested) {
      const i = idx++;
      const sessName = sessionNames[i];
      const sessionPath = path.join(userDir, sanitizeName(sessName));
      if (!fs.existsSync(sessionPath)) {
        results.push({ session: sessName, ok: false, message: 'session tidak ditemukan' });
        continue;
      }

      const browser = await puppeteer.launch({
        headless: false,
        userDataDir: sessionPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      job.browsers.push(browser);

      try {
        const page = await browser.newPage();
        page.on('dialog', async dialog => {
          await dialog.accept().catch(()=>{});
        });

        if (job.stopRequested) break;
        await page.goto('https://www.facebook.com/groups/feed/', { waitUntil: 'networkidle2', timeout: 30000 }).catch(()=>{});

        try {
          const pinnedXPath = "//a[.//i]";
          await page.waitForSelector(`xpath/${pinnedXPath}`, { timeout: 30000 }).catch(()=>null);
          if (job.stopRequested) break;

          const linkElements = await page.$$(`xpath/${pinnedXPath}`);
          const urlsPattern = /facebook\.com\/groups\/\d+\/?$/;
          const urls: string[] = [];
          for (const link of linkElements) {
            const url = await page.evaluate(el => (el as HTMLAnchorElement).href, link);
            if (urlsPattern.test(url)) urls.push(url);
          }

          for (const url of urls) {
            if (job.stopRequested) break;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(()=>{});
            if (job.stopRequested) break;

            const ok = await attemptPostingWithRetries(page, imagePath, commentText, job, results, captionText);
            results.push({ session: sessName, group: url, ok });
            await delay(5000);
          }
        } catch {
          results.push({ session: sessName, ok: false, message: 'Gagal ambil pinned groups' });
        }
      } finally {
        await browser.close().catch(()=>{});
        job.browsers = job.browsers.filter(b => b !== browser);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  JOBS.delete(jobId);
  const successCount = results.filter(r => r.ok === true).length;
  const failCount = results.filter(r => r.ok === false).length;

  console.log(`📊 Summary: ${successCount} berhasil, ${failCount} gagal`);

  return {
    jobId,
    results,
    summary: {
      success: successCount,
      failed: failCount
    }
  };
}

export async function stopAll() {
  for (const [id, j] of JOBS.entries()) {
    j.stopRequested = true;

    for (const b of j.browsers) {
      try {
        await b.close();
      } catch {
        const proc = b.process();
        if (proc) {
          try { proc.kill('SIGKILL'); } catch {}
        }
      }
    }
  }

  JOBS.clear();
}
