import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("klasik.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    account_code TEXT UNIQUE,
    role TEXT CHECK(role IN ('admin', 'pj')),
    group_name TEXT,
    member_id INTEGER,
    FOREIGN KEY (member_id) REFERENCES class_members(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS class_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    pj_id INTEGER,
    FOREIGN KEY (pj_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    pj_id INTEGER,
    checkin_photo TEXT,
    checkin_time TEXT,
    status TEXT,
    latitude REAL,
    longitude REAL,
    cleaning_photo TEXT,
    cleaning_description TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pj_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS absent_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    member_id INTEGER,
    name TEXT,
    reason TEXT,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES class_members(id)
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT,
    day TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS substitutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_pj_id INTEGER,
    substitute_pj_id INTEGER,
    original_date TEXT,
    substitute_date TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_pj_id) REFERENCES users(id),
    FOREIGN KEY (substitute_pj_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER,
    member_name TEXT,
    pj_id INTEGER,
    date TEXT,
    type TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    message TEXT,
    pj_id INTEGER,
    pj_name TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS jadwal_pelajaran (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hari TEXT,
    jam_ke INTEGER,
    jam_mulai TEXT,
    jam_selesai TEXT,
    mata_pelajaran TEXT,
    guru TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS weekly_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT,
    week_end TEXT,
    archive_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const migrations: [string, string][] = [
  ["submitted_at FROM reports", "ALTER TABLE reports ADD COLUMN submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP"],
  ["account_code FROM users", "ALTER TABLE users ADD COLUMN account_code TEXT"],
  ["group_name FROM users", "ALTER TABLE users ADD COLUMN group_name TEXT"],
  ["member_id FROM users", "ALTER TABLE users ADD COLUMN member_id INTEGER REFERENCES class_members(id)"],
  ["pj_id FROM class_members", "ALTER TABLE class_members ADD COLUMN pj_id INTEGER REFERENCES users(id)"],
  ["member_id FROM absent_members", "ALTER TABLE absent_members ADD COLUMN member_id INTEGER REFERENCES class_members(id)"],
  ["is_read FROM reports", "ALTER TABLE reports ADD COLUMN is_read INTEGER DEFAULT 0"],
];
for (const [check, alter] of migrations) {
  try { db.prepare(`SELECT ${check} LIMIT 1`).get(); }
  catch { try { db.exec(alter); } catch { } }
}

const usersWithoutCode = db.prepare("SELECT id, role FROM users WHERE account_code IS NULL OR account_code = ''").all() as any[];
for (const u of usersWithoutCode) {
  const len = u.role === 'admin' ? 8 : 6;
  const code = genCode(len);
  try { db.prepare("UPDATE users SET account_code = ? WHERE id = ?").run(code, u.id); } catch { }
}

const defaultSettings: [string, string][] = [
  ['report_time_limit', '07:00'],
  ['testing_mode', 'false'],
  ['edit_time_limit_minutes', '15'],
];
for (const [k, v] of defaultSettings) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(k, v);
}

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const DAYS_ORDER = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

const COMPUTER_TERMS = [
  'Algorithm', 'Binary', 'Cache', 'Daemon', 'Ethernet', 'Firmware', 'Gateway',
  'Hexadecimal', 'Interface', 'Kernel', 'Lambda', 'Mutex', 'Namespace', 'OAuth',
  'Protocol', 'Query', 'Router', 'Subnet', 'Terminal', 'Uptime', 'Vector',
  'Webhook', 'Xorshift', 'Yaml', 'Zeroconf', 'Bootloader', 'Compiler', 'Debugger',
  'Encoder', 'Firewall', 'Hypervisor', 'Iterator', 'Linker', 'Microkernel',
  'Nonce', 'Overhead', 'Pipeline', 'Queue', 'Recursion', 'Semaphore', 'Thread',
  'Unicode', 'Virtual', 'Wrapper', 'Yarn', 'Zipfile'
];

async function compressImage(buffer: Buffer, originalname: string): Promise<string> {
  const ext = path.extname(originalname).toLowerCase();
  const filename = Date.now() + "-" + path.basename(originalname, ext) + ".jpg";
  const outPath = path.join(uploadDir, filename);
  await sharp(buffer)
    .rotate() // auto-orient from EXIF
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true })
    .toFile(outPath);
  return `/uploads/${filename}`;
}

function genCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deleteUserCascade(userId: number) {
  const pjUser = db.prepare("SELECT group_name FROM users WHERE id = ?").get(userId) as any;
  db.prepare("UPDATE class_members SET pj_id = NULL WHERE pj_id = ?").run(userId);
  db.prepare("UPDATE users SET member_id = NULL WHERE id = ?").run(userId);
  const userReports = db.prepare("SELECT id FROM reports WHERE pj_id = ?").all(userId) as any[];
  for (const r of userReports) db.prepare("DELETE FROM absent_members WHERE report_id = ?").run(r.id);
  db.prepare("DELETE FROM reports WHERE pj_id = ?").run(userId);
  db.prepare("DELETE FROM substitutions WHERE requester_pj_id = ? OR substitute_pj_id = ?").run(userId, userId);
  if (pjUser?.group_name) {
    db.prepare("DELETE FROM schedules WHERE group_name = ?").run(pjUser.group_name);
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

function deleteMemberCascade(memberId: number) {
  const pjUser = db.prepare("SELECT id FROM users WHERE member_id = ? AND role = 'pj'").get(memberId) as any;
  if (pjUser) {
    deleteUserCascade(pjUser.id);
  }
  db.prepare("DELETE FROM absent_members WHERE member_id = ?").run(memberId);
  db.prepare("DELETE FROM violations WHERE member_id = ?").run(memberId);
  db.prepare("DELETE FROM class_members WHERE id = ?").run(memberId);
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());
  app.use("/uploads", express.static(uploadDir));

  app.get("/api/server-time", (req, res) => res.json({ time: new Date().toISOString() }));

  app.get("/api/admin-exists", (req, res) => {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    res.json({ exists: !!admin });
  });

  app.post("/api/setup-admin", (req, res) => {
    const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (adminExists) return res.status(400).json({ success: false, message: "Admin sudah ada" });
    const code = genCode(8);
    db.prepare("INSERT INTO users (name, account_code, role) VALUES (?, ?, ?)").run("Admin Utama", code, "admin");
    res.json({ success: true, code });
  });

  app.get("/api/settings", (req, res) => {
    const rows = db.prepare("SELECT * FROM settings").all() as any[];
    const obj = rows.reduce((acc: any, s: any) => { acc[s.key] = s.value; return acc; }, {});
    res.json(obj);
  });

  app.post("/api/settings", (req, res) => {
    const { key, value } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value.toString());
    res.json({ success: true });
  });

  app.post("/api/login", (req, res) => {
    const { account_code } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE account_code = ?").get(account_code) as any;
    if (user) {
      res.json({ success: true, user: { id: user.id, name: user.name, role: user.role, group_name: user.group_name } });
    } else {
      res.status(401).json({ success: false, message: "Kode akun tidak valid" });
    }
  });

  app.get("/api/users", (req, res) => {
    const users = db.prepare(`
      SELECT u.id, COALESCE(m.name, u.name) as name, u.account_code, u.role, u.group_name, u.member_id
      FROM users u LEFT JOIN class_members m ON u.member_id = m.id
    `).all();
    res.json(users);
  });

  app.post("/api/users", (req, res) => {
    const { name, role, group_name, member_id } = req.body;
    if (role === 'pj' || !role) {
      const existing = db.prepare("SELECT id FROM users WHERE name = ? AND role = 'pj'").get(name) as any;
      if (existing) return res.status(400).json({ success: false, message: `Akun PJ dengan nama "${name}" sudah ada` });
    }
    const code = genCode(6);
    try {
      db.prepare("INSERT INTO users (name, account_code, role, group_name, member_id) VALUES (?, ?, ?, ?, ?)").run(name, code, role || 'pj', group_name || null, member_id || null);
      const newUser = db.prepare("SELECT id FROM users WHERE account_code = ?").get(code) as any;
      res.json({ success: true, account_code: code, id: newUser?.id });
    } catch {
      res.status(400).json({ success: false, message: "Gagal membuat akun" });
    }
  });

  app.delete("/api/users/:id", (req, res) => {
    try { deleteUserCascade(parseInt(req.params.id)); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.put("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { name, group_name } = req.body;
    db.prepare("UPDATE users SET name = ?, group_name = ? WHERE id = ?").run(name, group_name, id);
    res.json({ success: true });
  });

  app.post("/api/users/:id/regenerate-code", (req, res) => {
    const { id } = req.params;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    const code = genCode(user.role === 'admin' ? 8 : 6);
    db.prepare("UPDATE users SET account_code = ? WHERE id = ?").run(code, id);
    res.json({ success: true, account_code: code });
  });

  app.post("/api/users/reset", (req, res) => {
    db.prepare("DELETE FROM substitutions").run();
    db.prepare("DELETE FROM schedules WHERE group_name IN (SELECT group_name FROM users WHERE role = 'pj' AND group_name IS NOT NULL)").run();
    db.prepare("UPDATE class_members SET pj_id = NULL").run();
    db.prepare("DELETE FROM users WHERE role != 'admin'").run();
    res.json({ success: true });
  });

  app.post("/api/shuffle-members", (req, res) => {
    const { numGroups } = req.body;
    const pjCount = parseInt(numGroups);
    if (!pjCount || pjCount < 1) return res.status(400).json({ success: false, message: "Jumlah grup tidak valid" });

    const allMembers = db.prepare("SELECT id, name FROM class_members").all() as any[];
    if (allMembers.length === 0) return res.status(400).json({ success: false, message: "Belum ada anggota kelas" });
    if (pjCount > allMembers.length) return res.status(400).json({ success: false, message: "Jumlah grup melebihi jumlah anggota" });

    const shuffledMembers = shuffle(allMembers);
    const shuffledDays = shuffle([...DAYS_ORDER]).slice(0, pjCount);

    const doShuffle = db.transaction(() => {
      db.prepare("UPDATE class_members SET pj_id = NULL").run();
      db.prepare("DELETE FROM schedules").run();
      db.prepare("DELETE FROM substitutions").run();
      db.prepare("DELETE FROM users WHERE role = 'pj'").run();

      const usedTerms: string[] = [];

      for (let i = 0; i < pjCount; i++) {
        const groupMembers = shuffledMembers.filter((_, idx) => idx % pjCount === i);
        if (groupMembers.length === 0) continue;

        const pjMember = groupMembers[0];
        const available = COMPUTER_TERMS.filter(t => !usedTerms.includes(t));
        const term = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : `${COMPUTER_TERMS[0]}${i + 2}`;
        usedTerms.push(term);
        const groupName = `Kelompok ${term}`;
        const code = genCode(6);

        db.prepare("INSERT INTO users (name, account_code, role, group_name) VALUES (?, ?, 'pj', ?)").run(pjMember.name, code, groupName);
        const newPJ = db.prepare("SELECT id FROM users WHERE account_code = ?").get(code) as any;

        const assignMember = db.prepare("UPDATE class_members SET pj_id = ? WHERE id = ?");
        for (const m of groupMembers) assignMember.run(newPJ.id, m.id);

        db.prepare("UPDATE users SET member_id = ? WHERE id = ?").run(pjMember.id, newPJ.id);

        if (shuffledDays[i]) {
          db.prepare("INSERT INTO schedules (group_name, day) VALUES (?, ?)").run(groupName, shuffledDays[i]);
        }
      }
    });

    try {
      doShuffle();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/members/reset", (req, res) => {
    db.prepare("UPDATE users SET member_id = NULL").run();
    db.prepare("DELETE FROM class_members").run();
    res.json({ success: true });
  });

  app.get("/api/members", (req, res) => {
    const { pj_id } = req.query;
    let members;
    if (pj_id) {
      members = db.prepare("SELECT * FROM class_members WHERE pj_id = ?").all(pj_id);
    } else {
      members = db.prepare(`
        SELECT m.*, u1.name as pj_name, u1.group_name as pj_group, u2.group_name as is_pj_group
        FROM class_members m
        LEFT JOIN users u1 ON m.pj_id = u1.id
        LEFT JOIN users u2 ON m.id = u2.member_id AND u2.role = 'pj'
      `).all();
    }
    res.json(members);
  });

  app.post("/api/members", (req, res) => {
    const { name, pj_id } = req.body;
    const existing = db.prepare("SELECT id FROM class_members WHERE name = ?").get(name) as any;
    if (existing) return res.status(400).json({ success: false, message: `Anggota "${name}" sudah terdaftar` });
    db.prepare("INSERT INTO class_members (name, pj_id) VALUES (?, ?)").run(name, pj_id || null);
    res.json({ success: true });
  });

  app.put("/api/members/:id", (req, res) => {
    const { pj_id, name } = req.body;
    const { id } = req.params;
    const existing = db.prepare("SELECT id FROM class_members WHERE name = ? AND id != ?").get(name, id) as any;
    if (existing) return res.status(400).json({ success: false, message: `Anggota "${name}" sudah terdaftar` });
    db.prepare("UPDATE class_members SET name = ?, pj_id = ? WHERE id = ?").run(name, pj_id || null, id);
    res.json({ success: true });
  });

  app.delete("/api/members/:id", (req, res) => {
    try { deleteMemberCascade(parseInt(req.params.id)); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get("/api/status/:pj_id", (req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const report = db.prepare("SELECT * FROM reports WHERE pj_id = ? AND date = ?").get(req.params.pj_id, today);
    res.json(report || null);
  });

  app.get("/api/reports/history/:pj_id", (req, res) => {
    const reports = db.prepare(`
      SELECT r.*, u.name as pj_name, u.group_name as pj_group
      FROM reports r JOIN users u ON r.pj_id = u.id
      WHERE r.pj_id = ? ORDER BY r.date DESC
    `).all(req.params.pj_id) as any[];
    const result = reports.map(r => ({
      ...r,
      absents: db.prepare("SELECT * FROM absent_members WHERE report_id = ?").all(r.id),
    }));
    res.json(result);
  });

  app.post("/api/attendance", upload.single("photo"), async (req, res) => {
    const { pj_id, latitude, longitude, time, status } = req.body;
    const today = new Date().toISOString().split("T")[0];
    let photo = "";
    if (req.file) {
      try { photo = await compressImage(req.file.buffer, req.file.originalname); } catch { photo = ""; }
    }
    const existing = db.prepare("SELECT * FROM reports WHERE pj_id = ? AND date = ?").get(pj_id, today);
    if (existing) return res.status(400).json({ success: false, message: "Sudah absen hari ini!" });
    db.prepare(`INSERT INTO reports (date, pj_id, checkin_photo, checkin_time, status, latitude, longitude, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(today, pj_id, photo, time, status, latitude, longitude);
    const pjUser = db.prepare("SELECT name FROM users WHERE id = ?").get(pj_id) as any;
    db.prepare("INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)").run(
      'attendance', `PJ ${pjUser?.name || 'Unknown'} mengirim absensi (${status}) pukul ${time} WIB`, pj_id, pjUser?.name || 'Unknown'
    );
    res.json({ success: true });
  });

  app.post("/api/report", upload.single("photo"), async (req, res) => {
    const { pj_id, description, absentMembers } = req.body;
    const today = new Date().toISOString().split("T")[0];
    let photo = "";
    if (req.file) {
      try { photo = await compressImage(req.file.buffer, req.file.originalname); } catch { photo = ""; }
    }
    const report = db.prepare("SELECT id FROM reports WHERE pj_id = ? AND date = ?").get(pj_id, today) as any;
    if (!report) return res.status(400).json({ success: false, message: "Silakan absen kehadiran terlebih dahulu!" });
    db.prepare(`UPDATE reports SET cleaning_photo = ?, cleaning_description = ?, submitted_at = datetime('now') WHERE id = ?`).run(photo, description, report.id);
    db.prepare("DELETE FROM absent_members WHERE report_id = ?").run(report.id);
    if (absentMembers) {
      const parsed = JSON.parse(absentMembers);
      const ins = db.prepare("INSERT INTO absent_members (report_id, member_id, name, reason) VALUES (?, ?, ?, ?)");
      parsed.forEach((m: any) => {
        ins.run(report.id, m.member_id || null, m.name, m.reason);
        if (m.reason === 'Tidak Piket' || m.reason === 'Tidak Masuk') {
          const existing = db.prepare("SELECT id FROM violations WHERE member_name = ? AND date = ? AND type = ?").get(m.name, today, m.reason);
          if (!existing) {
            db.prepare("INSERT INTO violations (member_id, member_name, pj_id, date, type) VALUES (?, ?, ?, ?, ?)").run(m.member_id || null, m.name, pj_id, today, m.reason);
          }
        }
      });
    }
    const pjUser = db.prepare("SELECT name FROM users WHERE id = ?").get(pj_id) as any;
    db.prepare("INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)").run(
      'report', `PJ ${pjUser?.name || 'Unknown'} mengirim laporan kelas (${today})`, pj_id, pjUser?.name || 'Unknown'
    );
    res.json({ success: true });
  });

  app.post("/api/report/:report_id/edit-photo", upload.single("photo"), async (req, res) => {
    const { report_id } = req.params;
    const { photoType } = req.body;
    const report = db.prepare("SELECT *, submitted_at FROM reports WHERE id = ?").get(report_id) as any;
    if (!report) return res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
    const settings = db.prepare("SELECT value FROM settings WHERE key = 'edit_time_limit_minutes'").get() as any;
    const limitMin = parseInt(settings?.value || '15');
    const testMode = db.prepare("SELECT value FROM settings WHERE key = 'testing_mode'").get() as any;
    if (testMode?.value !== 'true') {
      const submitted = new Date((report.submitted_at || '').includes('Z') ? report.submitted_at : report.submitted_at + 'Z');
      const diff = (Date.now() - submitted.getTime()) / 60000;
      if (diff > limitMin) return res.status(403).json({ success: false, message: `Batas waktu edit (${limitMin} menit) telah terlewati` });
    }
    if (!req.file) return res.status(400).json({ success: false, message: "Tidak ada foto" });
    let photoPath = "";
    try { photoPath = await compressImage(req.file.buffer, req.file.originalname); } catch { return res.status(500).json({ success: false, message: "Gagal kompresi foto" }); }
    if (photoType === 'checkin') {
      db.prepare("UPDATE reports SET checkin_photo = ? WHERE id = ?").run(photoPath, report_id);
    } else {
      db.prepare("UPDATE reports SET cleaning_photo = ? WHERE id = ?").run(photoPath, report_id);
    }
    res.json({ success: true });
  });

  app.get("/api/all-reports", (req, res) => {
    const reports = db.prepare(`
      SELECT r.*, u.name as pj_name, u.group_name as pj_group
      FROM reports r JOIN users u ON r.pj_id = u.id
      ORDER BY r.date DESC, r.submitted_at DESC
    `).all() as any[];
    const result = reports.map(r => ({
      ...r,
      absents: db.prepare("SELECT * FROM absent_members WHERE report_id = ?").all(r.id),
    }));
    res.json(result);
  });

  app.delete("/api/reports/:id", (req, res) => {
    db.prepare("DELETE FROM absent_members WHERE report_id = ?").run(req.params.id);
    db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/reports/reset", (req, res) => {
    db.prepare("DELETE FROM absent_members").run();
    db.prepare("DELETE FROM reports").run();
    res.json({ success: true });
  });

  // VIOLATIONS
  app.get("/api/violations", (req, res) => {
    res.json(db.prepare("SELECT * FROM violations ORDER BY date DESC").all());
  });

  app.get("/api/violations/summary", (req, res) => {
    const summary = db.prepare(`
      SELECT member_name, member_id,
        COUNT(*) as total_violations,
        SUM(CASE WHEN type = 'Tidak Piket' THEN 1 ELSE 0 END) as tidak_piket,
        SUM(CASE WHEN type = 'Tidak Masuk' THEN 1 ELSE 0 END) as tidak_masuk,
        SUM(CASE WHEN type = 'Telat' THEN 1 ELSE 0 END) as telat
      FROM violations GROUP BY member_name ORDER BY total_violations DESC
    `).all();
    res.json(summary);
  });

  app.post("/api/violations", (req, res) => {
    const { member_id, member_name, pj_id, date, type, notes } = req.body;
    db.prepare("INSERT INTO violations (member_id, member_name, pj_id, date, type, notes) VALUES (?, ?, ?, ?, ?, ?)").run(member_id || null, member_name, pj_id || null, date, type, notes || null);
    res.json({ success: true });
  });

  app.delete("/api/violations/:id", (req, res) => {
    db.prepare("DELETE FROM violations WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // NOTIFICATIONS
  app.get("/api/notifications", (req, res) => {
    res.json(db.prepare("SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50").all());
  });

  app.get("/api/notifications/unread-count", (req, res) => {
    const result = db.prepare("SELECT COUNT(*) as count FROM admin_notifications WHERE is_read = 0").get() as any;
    res.json({ count: result.count });
  });

  app.post("/api/notifications/mark-read", (req, res) => {
    db.prepare("UPDATE admin_notifications SET is_read = 1").run();
    res.json({ success: true });
  });

  app.delete("/api/notifications/all", (req, res) => {
    db.prepare("DELETE FROM admin_notifications").run();
    res.json({ success: true });
  });

  app.delete("/api/notifications/:id", (req, res) => {
    db.prepare("DELETE FROM admin_notifications WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // JADWAL PELAJARAN
  app.get("/api/jadwal-pelajaran", (req, res) => {
    const rows = db.prepare("SELECT * FROM jadwal_pelajaran ORDER BY CASE hari WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 ELSE 6 END, jam_ke ASC").all();
    res.json(rows);
  });

  app.post("/api/jadwal-pelajaran", (req, res) => {
    const { hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru } = req.body;
    if (!hari || !jam_ke || !mata_pelajaran) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
    db.prepare("INSERT INTO jadwal_pelajaran (hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru) VALUES (?, ?, ?, ?, ?, ?)").run(hari, jam_ke, jam_mulai || null, jam_selesai || null, mata_pelajaran, guru || null);
    res.json({ success: true });
  });

  app.put("/api/jadwal-pelajaran/:id", (req, res) => {
    const { hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru } = req.body;
    db.prepare("UPDATE jadwal_pelajaran SET hari=?, jam_ke=?, jam_mulai=?, jam_selesai=?, mata_pelajaran=?, guru=? WHERE id=?").run(hari, jam_ke, jam_mulai || null, jam_selesai || null, mata_pelajaran, guru || null, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/jadwal-pelajaran/:id", (req, res) => {
    db.prepare("DELETE FROM jadwal_pelajaran WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/jadwal-pelajaran", (req, res) => {
    db.prepare("DELETE FROM jadwal_pelajaran").run();
    res.json({ success: true });
  });

  // JADWAL PELAJARAN IMPORT (CSV/text)
  app.post("/api/jadwal-pelajaran/import", (req, res) => {
    const { rows } = req.body; // array of {hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru}
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, message: "Data kosong" });
    const ins = db.prepare("INSERT INTO jadwal_pelajaran (hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru) VALUES (?, ?, ?, ?, ?, ?)");
    const doInsert = db.transaction(() => {
      for (const r of rows) ins.run(r.hari, r.jam_ke, r.jam_mulai || null, r.jam_selesai || null, r.mata_pelajaran, r.guru || null);
    });
    try { doInsert(); res.json({ success: true, imported: rows.length }); }
    catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // WEEKLY ARCHIVER
  app.post("/api/archive/weekly", (req, res) => {
    const now = new Date();
    // Get last Monday
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday - 7);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = friday.toISOString().split('T')[0];

    const alreadyArchived = db.prepare("SELECT id FROM weekly_archive WHERE week_start = ?").get(weekStart) as any;
    if (alreadyArchived) return res.json({ success: true, message: "Minggu ini sudah diarsipkan", skipped: true });

    const reports = db.prepare(`SELECT r.*, u.name as pj_name FROM reports r JOIN users u ON r.pj_id = u.id WHERE r.date >= ? AND r.date <= ?`).all(weekStart, weekEnd) as any[];
    const absents = db.prepare(`SELECT am.*, r.date FROM absent_members am JOIN reports r ON am.report_id = r.id WHERE r.date >= ? AND r.date <= ?`).all(weekStart, weekEnd) as any[];

    // Archive data
    const archiveData = JSON.stringify({ reports, absents });
    db.prepare("INSERT INTO weekly_archive (week_start, week_end, archive_data) VALUES (?, ?, ?)").run(weekStart, weekEnd, archiveData);

    // Delete old report photos
    for (const r of reports) {
      for (const photoField of ['checkin_photo', 'cleaning_photo']) {
        const photoPath = r[photoField];
        if (photoPath && photoPath.startsWith('/uploads/')) {
          const fullPath = path.join(__dirname, photoPath);
          try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch { }
        }
      }
    }

    // Remove archived reports from main table (optional — keep IDs, clear photos)
    for (const r of reports) {
      db.prepare("UPDATE reports SET checkin_photo = '', cleaning_photo = '' WHERE id = ?").run(r.id);
    }

    res.json({ success: true, archivedReports: reports.length, weekStart, weekEnd });
  });

  app.get("/api/archive/weekly", (req, res) => {
    const archives = db.prepare("SELECT id, week_start, week_end, created_at FROM weekly_archive ORDER BY week_start DESC").all();
    res.json(archives);
  });

  app.get("/api/archive/weekly/:id", (req, res) => {
    const archive = db.prepare("SELECT * FROM weekly_archive WHERE id = ?").get(req.params.id) as any;
    if (!archive) return res.status(404).json({ success: false, message: "Arsip tidak ditemukan" });
    res.json({ ...archive, archive_data: JSON.parse(archive.archive_data) });
  });

  // ── SUBSTITUTIONS ────────────────────────────────────────────────────────
  // Logic: PJ A (hari X) ↔ PJ B (hari Y) saling tukar.
  //   - B mengerjakan jadwal A (tanggal X terdekat)
  //   - A mengerjakan jadwal B sebagai balasan (tanggal Y terdekat)
  //
  // Helper: tanggal terdekat ke depan untuk hari tertentu (tidak termasuk hari ini)
  function nextDateForDay(dayName: string): string {
    const jsDayMap: Record<string, number> = { Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5 };
    const target = jsDayMap[dayName];
    if (!target) return '';
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1); // mulai besok
    for (let i = 0; i < 14; i++, d.setDate(d.getDate() + 1)) {
      if (d.getDay() === target) return d.toISOString().split('T')[0];
    }
    return '';
  }

  // GET semua substitusi (admin) atau milik satu PJ
  app.get("/api/substitutions", (req, res) => {
    const { pj_id } = req.query;
    const base = `
      SELECT s.*,
        r.name  AS requester_name,  r.group_name  AS requester_group,
        sub.name AS substitute_name, sub.group_name AS substitute_group
      FROM substitutions s
      JOIN users r   ON s.requester_pj_id  = r.id
      JOIN users sub ON s.substitute_pj_id = sub.id`;
    const rows = pj_id
      ? db.prepare(`${base} WHERE s.requester_pj_id = ? OR s.substitute_pj_id = ? ORDER BY s.original_date ASC`).all(pj_id, pj_id)
      : db.prepare(`${base} ORDER BY s.original_date ASC`).all();
    res.json(rows);
  });

  // GET kandidat pengganti untuk PJ ini:
  //   Urutkan DAYS_ORDER mulai setelah hari jadwal saya → kelompok BERIKUTNYA lebih diutamakan
  app.get("/api/substitutions/candidates/:pj_id", (req, res) => {
    const { pj_id } = req.params;
    const me = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'pj'").get(pj_id) as any;
    if (!me) return res.status(404).json({ success: false, message: "PJ tidak ditemukan" });

    const mySched = db.prepare("SELECT * FROM schedules WHERE group_name = ?").get(me.group_name) as any;
    if (!mySched) return res.status(400).json({ success: false, message: "Anda belum memiliki jadwal piket" });

    const myNextDate = nextDateForDay(mySched.day);

    // Semua PJ lain + jadwal mereka
    const others = db.prepare(`
      SELECT u.id, u.name, u.group_name, s.day
      FROM users u
      JOIN schedules s ON s.group_name = u.group_name
      WHERE u.role = 'pj' AND u.id != ?
    `).all(pj_id) as any[];

    // Urutkan: kelompok setelah jadwal saya lebih dahulu
    const myDayIdx = DAYS_ORDER.indexOf(mySched.day);
    const sorted = [...others].sort((a, b) => {
      const ai = (DAYS_ORDER.indexOf(a.day) - myDayIdx + 5) % 5;
      const bi = (DAYS_ORDER.indexOf(b.day) - myDayIdx + 5) % 5;
      return ai - bi;
    });

    const candidates = sorted.map(p => ({
      id: p.id,
      name: p.name,
      group_name: p.group_name,
      day: p.day,
      their_next_date: nextDateForDay(p.day), // tanggal mereka → saya yang kerjakan sbg balasan
    }));

    res.json({ myDay: mySched.day, myNextDate, candidates });
  });

  // POST buat substitusi baru
  app.post("/api/substitutions", (req, res) => {
    const { requester_pj_id, substitute_pj_id, original_date, substitute_date } = req.body;
    if (!requester_pj_id || !substitute_pj_id || !original_date)
      return res.status(400).json({ success: false, message: "Data tidak lengkap" });

    // Cegah duplikat aktif di tanggal yang sama
    const dup = db.prepare(`
      SELECT id FROM substitutions
      WHERE status IN ('pending','accepted')
        AND ((requester_pj_id = ? AND original_date = ?)
          OR (substitute_pj_id = ? AND original_date = ?))
    `).get(requester_pj_id, original_date, substitute_pj_id, original_date) as any;
    if (dup) return res.status(400).json({ success: false, message: "Sudah ada permintaan aktif untuk tanggal tersebut" });

    db.prepare(`INSERT INTO substitutions (requester_pj_id, substitute_pj_id, original_date, substitute_date, status)
      VALUES (?, ?, ?, ?, 'pending')`)
      .run(requester_pj_id, substitute_pj_id, original_date, substitute_date || null);

    const reqPJ  = db.prepare("SELECT name FROM users WHERE id = ?").get(requester_pj_id) as any;
    const subPJ  = db.prepare("SELECT name FROM users WHERE id = ?").get(substitute_pj_id) as any;
    db.prepare("INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)").run(
      'substitution',
      `${reqPJ?.name} meminta ${subPJ?.name} menggantikan piket pada ${original_date}` +
        (substitute_date ? ` (balasan: ${substitute_date})` : ''),
      requester_pj_id, reqPJ?.name || ''
    );
    res.json({ success: true });
  });

  app.put("/api/substitutions/:id", (req, res) => {
    db.prepare("UPDATE substitutions SET status = ? WHERE id = ?").run(req.body.status, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/substitutions/:id", (req, res) => {
    db.prepare("DELETE FROM substitutions WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // IMPORT SCHEDULE
  app.post("/api/schedules/import-text", (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Teks tidak boleh kosong" });

    type ParsedGroup = { day: string; pjName: string; groupName: string; memberNames: string[] };
    const lines = (text as string).split('\n').map((l: string) => l.trim()).filter(Boolean);
    const groups: ParsedGroup[] = [];
    let current: ParsedGroup | null = null;

    for (const line of lines) {
      if (DAYS_ORDER.includes(line)) {
        if (current) groups.push(current);
        current = { day: line, pjName: '', groupName: '', memberNames: [] };
      } else if (current && (line.startsWith('•') || line.startsWith('-') || line.startsWith('*'))) {
        const raw = line.replace(/^[•\-*]\s*/, '').trim();
        const isPJ = /\(PJ\)/i.test(raw);
        const name = raw.replace(/\s*\(PJ\)\s*$/i, '').trim();
        if (isPJ && !current.pjName) {
          current.pjName = name;
          current.groupName = `Kelompok ${name}`;
        } else {
          current.memberNames.push(name);
        }
      }
    }
    if (current) groups.push(current);

    for (const g of groups) {
      if (!g.pjName && g.memberNames.length > 0) {
        g.pjName = g.memberNames.shift()!;
        g.groupName = `Kelompok ${g.pjName}`;
      }
    }

    const valid = groups.filter(g => g.day && g.pjName);
    if (valid.length === 0) return res.status(400).json({ success: false, message: "Format tidak valid." });

    const newCodes: { name: string; code: string }[] = [];
    const usedTerms: string[] = [];

    const doImport = db.transaction(() => {
      // RESET: Delete all members and users (except admins)
      db.prepare("DELETE FROM class_members").run();
      db.prepare("DELETE FROM users WHERE role != 'admin'").run();
      db.prepare("DELETE FROM schedules").run();

      for (const g of valid) {
        // Random group name from COMPUTER_TERMS
        let groupName = "";
        const available = COMPUTER_TERMS.filter(t => !usedTerms.includes(t));
        if (available.length > 0) {
          const randIdx = Math.floor(Math.random() * available.length);
          groupName = `Kelompok ${available[randIdx]}`;
          usedTerms.push(available[randIdx]);
        } else {
          groupName = `Kelompok ${COMPUTER_TERMS[Math.floor(Math.random() * COMPUTER_TERMS.length)]} ${usedTerms.length + 1}`;
        }

        db.prepare("INSERT INTO schedules (group_name, day) VALUES (?, ?)").run(groupName, g.day);

        // PJ Account
        const code = genCode(6);
        db.prepare("INSERT INTO users (name, account_code, role, group_name) VALUES (?, ?, 'pj', ?)").run(g.pjName, code, groupName);
        const pjUser = db.prepare("SELECT id FROM users WHERE account_code = ?").get(code) as any;
        newCodes.push({ name: g.pjName, code });

        const pjId = pjUser.id;
        // PJ as member
        db.prepare("INSERT INTO class_members (name, pj_id) VALUES (?, ?)").run(g.pjName, pjId);

        // Other members
        for (const mName of g.memberNames) {
          db.prepare("INSERT INTO class_members (name, pj_id) VALUES (?, ?)").run(mName, pjId);
        }
      }
    });

    try {
      doImport();
      res.json({ success: true, imported: valid.length, newAccounts: newCodes });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/reports/:id/react", (req, res) => {
    try {
      db.prepare("UPDATE reports SET is_read = 1 WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/schedules", (req, res) => {
    const schedules = db.prepare(`SELECT * FROM schedules ORDER BY
      CASE day WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 ELSE 6 END`).all();
    res.json(schedules);
  });

  app.post("/api/schedules", (req, res) => {
    const { group_name, day } = req.body;
    const existing = db.prepare("SELECT id FROM schedules WHERE day = ?").get(day);
    if (existing) return res.status(400).json({ success: false, message: `Hari ${day} sudah memiliki jadwal kelas` });
    db.prepare("INSERT INTO schedules (group_name, day) VALUES (?, ?)").run(group_name, day);
    res.json({ success: true });
  });

  app.put("/api/schedules/:id", (req, res) => {
    const { id } = req.params;
    const { group_name, day } = req.body;
    const existing = db.prepare("SELECT id FROM schedules WHERE day = ? AND id != ?").get(day, id);
    if (existing) return res.status(400).json({ success: false, message: `Hari ${day} sudah memiliki jadwal kelas` });
    db.prepare("UPDATE schedules SET group_name = ?, day = ? WHERE id = ?").run(group_name, day, id);
    res.json({ success: true });
  });

  app.delete("/api/schedules/:id", (req, res) => {
    db.prepare("DELETE FROM schedules WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.all("/api/*", (req, res) => {
    res.status(404).json({ success: false, message: `API route not found: ${req.method} ${req.url}` });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
