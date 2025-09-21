'use client';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

type SessionRow = { id: string; name: string; path: string; createdAt: string };

export default function DashboardClient() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [groupsFile, setGroupsFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [comment, setComment] = useState('');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(3);
  const [groupLimit, setGroupLimit] = useState(20);

  useEffect(()=>{ fetchSessions(); }, []);

  async function fetchSessions() {
    const res = await fetch('/api/sessions/list');
    const j = await res.json();
    setSessions(j.sessions || []);
  }

  function toggle(id: string) {
    setSelected(s => ({ ...s, [id]: !s[id] }));
  }

  async function uploadCSVAndStart() {
    if (!csvFile) return alert('Pilih file CSV berisi email,password terlebih dahulu');
    setLoading(true);
    setLog(null);
    const fd = new FormData();
    fd.append('file', csvFile);
    fd.append('concurrency', String(concurrency));
    try {
    const res = await fetch('/api/sessions/upload', { method: 'POST', body: fd });
    console.log('status:', res.status);
    const text = await res.text();
    console.log('response:', text);
    const j = JSON.parse(text);
    setLog(JSON.stringify(j, null, 2));
  } catch (err) {
    console.error('fetch error', err);
    setLog(String(err));
  }
  setLoading(false);
  fetchSessions();
}

  async function startJoinGroups() {
    if (!groupsFile) return alert('Pilih CSV group_link terlebih dahulu');
    const sel = Object.keys(selected).filter(k=>selected[k]).map(id => sessions.find(s=>s.id===id)?.name).filter(Boolean);
    if (sel.length === 0) return alert('Pilih minimal 1 session dari tabel');
    setLoading(true);
    setLog('⏳ Menjalankan proses join grup...');
    const fd = new FormData();
    fd.append('file', groupsFile);
    fd.append('sessions', JSON.stringify(sel));
    fd.append('groupLimit', String(groupLimit));
    fd.append('concurrency', String(concurrency));
    const res = await fetch('/api/groups/join', { method: 'POST', body: fd });
    const j = await res.json();
    setLoading(false);
    setLog(JSON.stringify(j, null, 2));
  }

  async function deleteSelected() {
    const selIds = Object.keys(selected).filter(k => selected[k]);
    if (selIds.length === 0) return alert('Pilih minimal 1 session yang ingin dihapus');
    if (!confirm(`Yakin ingin menghapus ${selIds.length} session?`)) return;
    setLoading(true);
    setLog(null);
    const res = await fetch('/api/sessions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selIds }),
    });
    const j = await res.json();
    setLoading(false);
    setLog(JSON.stringify(j, null, 2));
    fetchSessions();
  }

  async function startPostAndComment() {
    const sel = Object.keys(selected).filter(k=>selected[k]).map(id => sessions.find(s=>s.id===id)?.name).filter(Boolean);
    if (sel.length === 0) return alert('Pilih session minimal 1');
    if (!imageFile) return alert('Pilih file gambar');
    setLoading(true);
    setLog(null);
    const fd = new FormData();
    fd.append('image', imageFile);
    fd.append('comment', comment);
    fd.append('caption', caption);
    fd.append('sessions', JSON.stringify(sel));
    fd.append('concurrency', String(concurrency));
    const res = await fetch('/api/post/start', { method: 'POST', body: fd });
    const j = await res.json();
    setLoading(false);
    setLog(JSON.stringify(j, null, 2));
  }

  async function stopAll() {
    setLoading(true);
    const res = await fetch('/api/puppeteer/stop', { method: 'POST' });
    const j = await res.json();
    setLoading(false);
    setLog(JSON.stringify(j, null, 2));
  }

  return (
    <div style={{maxWidth:1100, margin:'24px auto'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h3>Dashboard</h3>
        <div>
          <button className="button secondary" onClick={()=>{ signOut(); }}>Keluar</button>
        </div>
      </div>

      <div className="container" style={{marginTop:12}}>
        <h4>Sessions Anda</h4>
        <table className="table">
          <thead><tr><th></th><th>Nama Session</th><th>Path</th><th>Dibuat</th></tr></thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}>
                <td><input type="checkbox" checked={!!selected[s.id]} onChange={()=>toggle(s.id)} /></td>
                <td>{s.name}</td>
                <td style={{fontSize:13, color:'#666'}}>{s.path}</td>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={4}>Belum ada session. Unggah CSV untuk membuat session.</td></tr>}
          </tbody>
        </table>
        
        {sessions.length > 0 && (
          <div style={{marginTop:8}}>
            <button className="button danger" onClick={deleteSelected} disabled={loading}>
              {loading ? 'Proses...' : 'Hapus Session Terpilih'}
            </button>
          </div>
        )}

        <hr />
        <h4>Masukan berapa tab yang yang akan berjalan</h4>
        <div className="form-row">
          <label>Concurrency (jumlah sesi paralel)</label>
          <input
          type="number"
           min={1}
              max={10}
              value={concurrency}
              onChange={e => setConcurrency(parseInt(e.target.value) || 1)}
          />
        </div>

        <hr />

        <h4>1) Tambah Session via CSV (email,password)</h4>
        <div style={{display:'flex', gap:8}}>
          <input type="file" accept=".csv" onChange={e=>setCsvFile(e.target.files?.[0] ?? null)} />
          <button className="button" onClick={uploadCSVAndStart} disabled={loading}>{loading ? 'Proses...' : 'Mulai'}</button>
          <button className="button secondary" onClick={stopAll}>Berhenti</button>
        </div>

        <hr />

        <h4>2) Join Groups</h4>
        <div className="form-row">
        <label>Batas grup per session</label>
        <input
        type="number"
        min={1}
        max={50}
        value={groupLimit}
        onChange={e => setGroupLimit(parseInt(e.target.value) || 1)}
        />
        </div>
    <div style={{display:'flex', gap:8}}>
      <input type="file" accept=".csv" onChange={e=>setGroupsFile(e.target.files?.[0] ?? null)} />
      <button className="button" onClick={startJoinGroups} disabled={loading}>
       {loading ? 'Proses...' : 'Mulai Tambah Grup'}
      </button>
      <button className="button secondary" onClick={stopAll}>Berhenti</button>
    </div>

        <hr />

        <h4>3) Post dan Komen</h4>
        <div className="form-row">
          <label>Gambar untuk di-upload</label>
          <input type="file" accept="image/*" onChange={e=>setImageFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="form-row">
          <label>Caption untuk semua posting</label>
          <textarea rows={2} value={caption} onChange={e=>setCaption(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Komentar untuk semua posting</label>
          <textarea rows={3} value={comment} onChange={e=>setComment(e.target.value)} />
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="button" onClick={startPostAndComment} disabled={loading}>{loading ? 'Proses...' : 'Mulai Post dan Komen'}</button>
          <button className="button secondary" onClick={stopAll}>Berhenti</button>
        </div>

        <hr />
        <h4>Log / Hasil</h4>
        <pre style={{background:'#111', color:'#fff', padding:12, borderRadius:8, maxHeight:300, overflow:'auto'}}>{log ?? 'Tidak ada'}</pre>
      </div>
    </div>
  );
}