import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

async function getDB() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL belum diset. Buka Netlify → Site Settings → Environment Variables dan tambahkan TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN. Daftar Turso gratis di https://turso.tech");
  const { createClient } = await import("@libsql/client/http");
  return createClient({ url, authToken });
}

let _dbInitialized = false;

async function getInitializedDB() {
  const db = await getDB();
  if (!_dbInitialized) {
    const createStatements = [
      `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, account_code TEXT UNIQUE, role TEXT CHECK(role IN ('admin', 'pj')), group_name TEXT, member_id INTEGER)`,
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
      `CREATE TABLE IF NOT EXISTS class_members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, pj_id INTEGER)`,
      `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, pj_id INTEGER, checkin_photo TEXT, checkin_time TEXT, status TEXT, latitude REAL, longitude REAL, cleaning_photo TEXT, cleaning_description TEXT, submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS absent_members (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, member_id INTEGER, name TEXT, reason TEXT)`,
      `CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, group_name TEXT, day TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS file_uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT UNIQUE, data TEXT, mime_type TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS substitutions (id INTEGER PRIMARY KEY AUTOINCREMENT, requester_pj_id INTEGER, substitute_pj_id INTEGER, original_date TEXT, substitute_date TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS violations (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, member_name TEXT, pj_id INTEGER, date TEXT, type TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, message TEXT, pj_id INTEGER, pj_name TEXT, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS pending_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, pj_id INTEGER NOT NULL, pj_name TEXT, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    ];
    for (const sql of createStatements) { await db.execute(sql); }
    const defaults = [
      ["checkin_time_limit", "07:00"],
      ["cleaning_time_limit", "08:00"],
      ["report_time_limit", "07:00"],
      ["testing_mode", "false"],
      ["edit_time_limit_minutes", "15"],
      ["require_admin_confirm", "false"],
    ];
    for (const [k, v] of defaults) {
      await db.execute({ sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", args: [k, v] });
    }
    // Migrations for existing tables
    try { await db.execute("ALTER TABLE reports ADD COLUMN is_read INTEGER DEFAULT 0"); } catch {}
    _dbInitialized = true;
  }
  return db;
}

function generateCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function json(status: number, body: unknown) {
  return { statusCode: status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: JSON.stringify(body) };
}

function parseMultipart(event: HandlerEvent): { fields: Record<string, string>; file?: { filename: string; data: string; mimeType: string } } {
  const contentType = event.headers["content-type"] || "";
  const fields: Record<string, string> = {};
  let file: { filename: string; data: string; mimeType: string } | undefined;
  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return { fields };
    const boundary = boundaryMatch[1];
    const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "");
    const parts = bodyBuffer.toString("binary").split(`--${boundary}`).filter((p) => p.includes("Content-Disposition"));
    for (const part of parts) {
      const [headerSection, ...bodyParts] = part.split("\r\n\r\n");
      const body = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
      const nameMatch = headerSection.match(/name="([^"]+)"/);
      const filenameMatch = headerSection.match(/filename="([^"]+)"/);
      const ctMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
      if (!nameMatch) continue;
      const fieldName = nameMatch[1];
      if (filenameMatch) {
        const filename = `${Date.now()}-${filenameMatch[1].replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const mimeType = ctMatch ? ctMatch[1].trim() : "application/octet-stream";
        const data = Buffer.from(body, "binary").toString("base64");
        file = { filename, data, mimeType };
      } else { fields[fieldName] = body; }
    }
  } else if (contentType.includes("application/json")) {
    try { Object.assign(fields, JSON.parse(event.body || "{}")); } catch {}
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    new URLSearchParams(event.body || "").forEach((v, k) => { fields[k] = v; });
  }
  return { fields, file };
}

function getServerWIBTime(): { timeStr: string; dateStr: string } {
  const now = new Date();
  const wibOffset = 7 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const wib = new Date(utcMs + wibOffset * 60000);
  const h = wib.getHours().toString().padStart(2, "0");
  const m = wib.getMinutes().toString().padStart(2, "0");
  const dateStr = wib.toISOString().split("T")[0];
  return { timeStr: `${h}:${m}`, dateStr };
}

function detectMockLocation(lat: number, lon: number, accuracy: number | null, provider: string | null): string | null {
  if (accuracy !== null && accuracy === 0) return "Akurasi GPS mencurigakan (0m)";
  if (accuracy !== null && accuracy < 1 && accuracy > 0) return "Akurasi GPS tidak wajar (<1m)";
  const latDecimals = lat.toString().split('.')[1]?.length || 0;
  const lonDecimals = lon.toString().split('.')[1]?.length || 0;
  if (latDecimals > 10 || lonDecimals > 10) return "Koordinat GPS mencurigakan (terlalu presisi)";
  if (provider && (provider.toLowerCase().includes('mock') || provider.toLowerCase().includes('fake'))) return "Mock location provider terdeteksi";
  return null;
}

export const handler: Handler = async (event: HandlerEvent, _ctx: HandlerContext) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }

  let db: Awaited<ReturnType<typeof getInitializedDB>>;
  try { db = await getInitializedDB(); }
  catch (e: any) {
    console.error("DB init error:", e);
    return json(500, { success: false, message: e.message || "Database tidak dapat diinisialisasi. Pastikan TURSO_DATABASE_URL sudah diset di Environment Variables Netlify." });
  }

  const rawPath = event.path.replace(/^\/.netlify\/functions\/api/, "").replace(/^\/api/, "").replace(/^\/+/, "");
  const segments = rawPath.split("/").filter(Boolean);
  const method = event.httpMethod;
  const query = event.queryStringParameters || {};

  try {
    if (method === "GET" && segments[0] === "server-time") {
      const { timeStr, dateStr } = getServerWIBTime();
      return json(200, { time: new Date().toISOString(), wib: timeStr, date: dateStr });
    }

    if (method === "GET" && segments[0] === "admin-exists") {
      const r = await db.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      return json(200, { exists: r.rows.length > 0 });
    }

    if (method === "POST" && segments[0] === "setup-admin") {
      const r = await db.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (r.rows.length > 0) return json(400, { success: false, message: "Admin sudah ada" });
      const code = generateCode(8);
      await db.execute({ sql: "INSERT INTO users (name, account_code, role) VALUES (?, ?, ?)", args: ["Admin Utama", code, "admin"] });
      return json(200, { success: true, code });
    }

    if (method === "GET" && segments[0] === "settings") {
      const r = await db.execute("SELECT * FROM settings");
      const obj = r.rows.reduce<Record<string, string>>((acc, row) => { acc[row.key as string] = row.value as string; return acc; }, {});
      return json(200, obj);
    }

    if (method === "POST" && segments[0] === "settings") {
      const b = JSON.parse(event.body || "{}");
      await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [b.key, String(b.value)] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "login") {
      const { account_code } = JSON.parse(event.body || "{}");
      const r = await db.execute({ sql: "SELECT * FROM users WHERE account_code = ?", args: [account_code] });
      if (r.rows.length === 0) return json(401, { success: false, message: "Kode akun tidak valid" });
      const u = r.rows[0];
      return json(200, { success: true, user: { id: u.id, name: u.name, role: u.role, group_name: u.group_name } });
    }

    if (method === "GET" && segments[0] === "users" && !segments[1]) {
      const r = await db.execute("SELECT u.id, COALESCE(m.name, u.name) as name, u.account_code, u.role, u.group_name, u.member_id FROM users u LEFT JOIN class_members m ON u.member_id = m.id");
      return json(200, r.rows);
    }

    if (method === "POST" && segments[0] === "users" && !segments[1]) {
      const { name, role, group_name, member_id } = JSON.parse(event.body || "{}");
      if (role === 'pj' || !role) {
        const dup = await db.execute({ sql: "SELECT id FROM users WHERE name = ? AND role = 'pj'", args: [name] });
        if (dup.rows.length > 0) return json(400, { success: false, message: `Akun PJ dengan nama "${name}" sudah ada` });
      }
      const code = generateCode(6);
      await db.execute({ sql: "INSERT INTO users (name, account_code, role, group_name, member_id) VALUES (?, ?, ?, ?, ?)", args: [name, code, role || "pj", group_name || null, member_id || null] });
      const nu = await db.execute({ sql: "SELECT id FROM users WHERE account_code = ?", args: [code] });
      return json(200, { success: true, account_code: code, id: nu.rows[0]?.id });
    }

    if (method === "DELETE" && segments[0] === "users" && segments[1] && !segments[2]) {
      const id = segments[1];
      const pjRes = await db.execute({ sql: "SELECT group_name FROM users WHERE id = ?", args: [id] });
      const groupName = pjRes.rows[0]?.group_name as string | null;
      await db.execute({ sql: "UPDATE class_members SET pj_id = NULL WHERE pj_id = ?", args: [id] });
      await db.execute({ sql: "UPDATE users SET member_id = NULL WHERE id = ?", args: [id] });
      const rpts = await db.execute({ sql: "SELECT id FROM reports WHERE pj_id = ?", args: [id] });
      for (const r of rpts.rows) await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [r.id as number] });
      await db.execute({ sql: "DELETE FROM reports WHERE pj_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM substitutions WHERE requester_pj_id = ? OR substitute_pj_id = ?", args: [id, id] });
      if (groupName) await db.execute({ sql: "DELETE FROM schedules WHERE group_name = ?", args: [groupName] });
      await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
      return json(200, { success: true });
    }

    if (method === "PUT" && segments[0] === "users" && segments[1]) {
      const { name, group_name } = JSON.parse(event.body || "{}");
      await db.execute({ sql: "UPDATE users SET name = ?, group_name = ? WHERE id = ?", args: [name, group_name, segments[1]] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "users" && segments[2] === "regenerate-code") {
      const r = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [segments[1]] });
      if (r.rows.length === 0) return json(404, { success: false, message: "User tidak ditemukan" });
      const code = generateCode(r.rows[0].role === "admin" ? 8 : 6);
      await db.execute({ sql: "UPDATE users SET account_code = ? WHERE id = ?", args: [code, segments[1]] });
      return json(200, { success: true, account_code: code });
    }

    if (method === "POST" && segments[0] === "users" && segments[1] === "reset") {
      await db.execute("UPDATE class_members SET pj_id = NULL");
      await db.execute("DELETE FROM users WHERE role != 'admin'");
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "members" && segments[1] === "reset") {
      await db.execute("UPDATE users SET member_id = NULL");
      await db.execute("DELETE FROM class_members");
      return json(200, { success: true });
    }

    if (method === "GET" && segments[0] === "members" && !segments[1]) {
      const pj_id = query.pj_id;
      const r = pj_id
        ? await db.execute({ sql: "SELECT * FROM class_members WHERE pj_id = ?", args: [pj_id] })
        : await db.execute("SELECT m.*, u1.name as pj_name, u1.group_name as pj_group, u2.group_name as is_pj_group FROM class_members m LEFT JOIN users u1 ON m.pj_id = u1.id LEFT JOIN users u2 ON m.id = u2.member_id AND u2.role = 'pj'");
      return json(200, r.rows);
    }

    if (method === "POST" && segments[0] === "members" && !segments[1]) {
      const { name, pj_id } = JSON.parse(event.body || "{}");
      const dup = await db.execute({ sql: "SELECT id FROM class_members WHERE name = ?", args: [name] });
      if (dup.rows.length > 0) return json(400, { success: false, message: `Anggota "${name}" sudah terdaftar` });
      await db.execute({ sql: "INSERT INTO class_members (name, pj_id) VALUES (?, ?)", args: [name, pj_id || null] });
      return json(200, { success: true });
    }

    if (method === "PUT" && segments[0] === "members" && segments[1]) {
      const { pj_id, name } = JSON.parse(event.body || "{}");
      const dup = await db.execute({ sql: "SELECT id FROM class_members WHERE name = ? AND id != ?", args: [name, segments[1]] });
      if (dup.rows.length > 0) return json(400, { success: false, message: `Anggota "${name}" sudah terdaftar` });
      await db.execute({ sql: "UPDATE class_members SET name = ?, pj_id = ? WHERE id = ?", args: [name, pj_id || null, segments[1]] });
      return json(200, { success: true });
    }

    if (method === "DELETE" && segments[0] === "members" && segments[1]) {
      const id = segments[1];
      const pjUserRes = await db.execute({ sql: "SELECT id, group_name FROM users WHERE member_id = ? AND role = 'pj'", args: [id] });
      if (pjUserRes.rows.length > 0) {
        const pjId = pjUserRes.rows[0].id as number;
        const pjGroupName = pjUserRes.rows[0].group_name as string | null;
        await db.execute({ sql: "UPDATE class_members SET pj_id = NULL WHERE pj_id = ?", args: [pjId] });
        await db.execute({ sql: "UPDATE users SET member_id = NULL WHERE id = ?", args: [pjId] });
        const rpts = await db.execute({ sql: "SELECT id FROM reports WHERE pj_id = ?", args: [pjId] });
        for (const r of rpts.rows) await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [r.id as number] });
        await db.execute({ sql: "DELETE FROM reports WHERE pj_id = ?", args: [pjId] });
        await db.execute({ sql: "DELETE FROM substitutions WHERE requester_pj_id = ? OR substitute_pj_id = ?", args: [pjId, pjId] });
        if (pjGroupName) await db.execute({ sql: "DELETE FROM schedules WHERE group_name = ?", args: [pjGroupName] });
        await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [pjId] });
      }
      await db.execute({ sql: "UPDATE users SET member_id = NULL WHERE member_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM absent_members WHERE member_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM class_members WHERE id = ?", args: [id] });
      return json(200, { success: true });
    }

    if (method === "GET" && segments[0] === "status" && segments[1]) {
      const { dateStr } = getServerWIBTime();
      const r = await db.execute({ sql: "SELECT * FROM reports WHERE pj_id = ? AND date = ?", args: [segments[1], dateStr] });
      return json(200, r.rows[0] || null);
    }

    if (method === "GET" && segments[0] === "reports" && segments[1] === "history" && segments[2]) {
      const r = await db.execute({ sql: "SELECT r.*, u.name as pj_name, u.group_name as pj_group FROM reports r JOIN users u ON r.pj_id = u.id WHERE r.pj_id = ? ORDER BY r.date DESC", args: [segments[2]] });
      const result = await Promise.all(r.rows.map(async (row) => {
        const abs = await db.execute({ sql: "SELECT * FROM absent_members WHERE report_id = ?", args: [row.id as number] });
        return { ...row, absents: abs.rows };
      }));
      return json(200, result);
    }

    if (method === "POST" && segments[0] === "report" && segments[2] === "edit-photo") {
      const { file } = parseMultipart(event);
      const r = await db.execute({ sql: "SELECT * FROM reports WHERE id = ?", args: [segments[1]] });
      if (r.rows.length === 0) return json(404, { success: false, message: "Laporan tidak ditemukan" });
      const row = r.rows[0];
      const sRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'edit_time_limit_minutes'", args: [] });
      const tRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'testing_mode'", args: [] });
      if (tRes.rows[0]?.value !== "true") {
        const raw = row.submitted_at as string;
        const sub = new Date(raw?.includes("Z") ? raw : raw + "Z");
        if ((Date.now() - sub.getTime()) / 60000 > parseInt((sRes.rows[0]?.value as string) || "15"))
          return json(403, { success: false, message: `Batas waktu edit (${sRes.rows[0]?.value || 15} menit) telah terlewati` });
      }
      let photoUrl = row.cleaning_photo as string;
      if (file) {
        await db.execute({ sql: "INSERT OR REPLACE INTO file_uploads (filename, data, mime_type) VALUES (?, ?, ?)", args: [file.filename, file.data, file.mimeType] });
        photoUrl = `/uploads/${file.filename}`;
      }
      await db.execute({ sql: "UPDATE reports SET cleaning_photo = ? WHERE id = ?", args: [photoUrl, segments[1]] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "report" && segments[2] === "edit-absents") {
      const { fields } = parseMultipart(event);
      const reportId = segments[1];
      const r = await db.execute({ sql: "SELECT * FROM reports WHERE id = ?", args: [reportId] });
      if (r.rows.length === 0) return json(404, { success: false, message: "Laporan tidak ditemukan" });
      const row = r.rows[0];
      const sRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'edit_time_limit_minutes'", args: [] });
      const tRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'testing_mode'", args: [] });
      if (tRes.rows[0]?.value !== "true") {
        const raw = row.submitted_at as string;
        const sub = new Date(raw?.includes("Z") ? raw : raw + "Z");
        if ((Date.now() - sub.getTime()) / 60000 > parseInt((sRes.rows[0]?.value as string) || "15"))
          return json(403, { success: false, message: `Batas waktu edit telah terlewati` });
      }
      const absentMembers = JSON.parse(fields.absentMembers || "[]");
      const description = fields.description || "Semua anggota hadir";
      await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [reportId] });
      for (const a of absentMembers) {
        await db.execute({ sql: "INSERT INTO absent_members (report_id, member_id, name, reason) VALUES (?, ?, ?, ?)", args: [reportId, a.member_id, a.name, a.reason] });
      }
      await db.execute({ sql: "UPDATE reports SET cleaning_description = ? WHERE id = ?", args: [description, reportId] });
      return json(200, { success: true });
    }

    if (method === "GET" && segments[0] === "all-reports") {
      const r = await db.execute("SELECT r.*, u.name as pj_name, u.group_name as pj_group FROM reports r JOIN users u ON r.pj_id = u.id ORDER BY r.date DESC, r.submitted_at DESC");
      const result = await Promise.all(r.rows.map(async (row) => {
        const abs = await db.execute({ sql: "SELECT * FROM absent_members WHERE report_id = ?", args: [row.id as number] });
        return { ...row, absents: abs.rows };
      }));
      return json(200, result);
    }

    if (method === "DELETE" && segments[0] === "reports" && segments[1] && segments[1] !== "reset") {
      await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [segments[1]] });
      await db.execute({ sql: "DELETE FROM reports WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "reports" && segments[1] === "reset") {
      await db.execute("DELETE FROM absent_members");
      await db.execute("DELETE FROM reports");
      await db.execute("DELETE FROM pending_approvals");
      return json(200, { success: true });
    }

    if (method === "GET" && segments[0] === "schedules" && !segments[1]) {
      const r = await db.execute("SELECT * FROM schedules ORDER BY CASE day WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 ELSE 6 END");
      return json(200, r.rows);
    }

    if (method === "POST" && segments[0] === "schedules" && !segments[1]) {
      const { group_name, day } = JSON.parse(event.body || "{}");
      const ex = await db.execute({ sql: "SELECT id FROM schedules WHERE day = ?", args: [day] });
      if (ex.rows.length > 0) return json(400, { success: false, message: `Hari ${day} sudah memiliki jadwal kelas` });
      await db.execute({ sql: "INSERT INTO schedules (group_name, day) VALUES (?, ?)", args: [group_name, day] });
      return json(200, { success: true });
    }

    if (method === "PUT" && segments[0] === "schedules" && segments[1]) {
      const { group_name, day } = JSON.parse(event.body || "{}");
      const ex = await db.execute({ sql: "SELECT id FROM schedules WHERE day = ? AND id != ?", args: [day, segments[1]] });
      if (ex.rows.length > 0) return json(400, { success: false, message: `Hari ${day} sudah memiliki jadwal kelas` });
      await db.execute({ sql: "UPDATE schedules SET group_name = ?, day = ? WHERE id = ?", args: [group_name, day, segments[1]] });
      return json(200, { success: true });
    }

    if (method === "DELETE" && segments[0] === "schedules" && segments[1]) {
      await db.execute({ sql: "DELETE FROM schedules WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    // ATTENDANCE with server-side time + mock location detection + admin confirm
    if (method === "POST" && segments[0] === "attendance") {
      const { fields, file } = parseMultipart(event);
      const { timeStr, dateStr } = getServerWIBTime();
      const today = dateStr;

      const tRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'testing_mode'", args: [] });
      const isTestingMode = tRes.rows[0]?.value === "true";

      const lat = parseFloat(fields.latitude || "0");
      const lon = parseFloat(fields.longitude || "0");
      const accuracy = fields.accuracy ? parseFloat(fields.accuracy) : null;
      const provider = fields.provider || null;

      if (!isTestingMode) {
        const issue = detectMockLocation(lat, lon, accuracy, provider);
        if (issue) return json(403, { success: false, message: `Lokasi mencurigakan: ${issue}. Pastikan GPS asli digunakan.` });
      }

      let photoUrl = "";
      if (file) {
        await db.execute({ sql: "INSERT OR REPLACE INTO file_uploads (filename, data, mime_type) VALUES (?, ?, ?)", args: [file.filename, file.data, file.mimeType] });
        photoUrl = `/uploads/${file.filename}`;
      }

      const existing = await db.execute({ sql: "SELECT id FROM reports WHERE pj_id = ? AND date = ?", args: [fields.pj_id, today] });
      if (existing.rows.length > 0) return json(400, { success: false, message: "Sudah absen hari ini!" });

      const pjRes = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [fields.pj_id] });
      const pjName = pjRes.rows[0]?.name || 'Unknown';

      const finalTime = isTestingMode ? (fields.time || timeStr) : timeStr;
      const finalStatus = finalTime > "06:30" ? "Telat" : "Tepat Waktu";

      const confirmRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'require_admin_confirm'", args: [] });
      const requireConfirm = confirmRes.rows[0]?.value === "true" && !isTestingMode;

      if (requireConfirm) {
        const pendingData = JSON.stringify({ checkin_photo: photoUrl, checkin_time: finalTime, status: finalStatus, latitude: lat, longitude: lon, date: today });
        await db.execute({ sql: "INSERT INTO pending_approvals (type, pj_id, pj_name, data) VALUES (?, ?, ?, ?)", args: ["attendance", fields.pj_id, pjName, pendingData] });
        await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['attendance_pending', `⏳ PJ ${pjName} mengirim absensi (${finalStatus}) pukul ${finalTime} WIB — menunggu konfirmasi`, fields.pj_id, pjName] });
        return json(200, { success: true, pending: true, message: "Absensi berhasil dikirim, menunggu konfirmasi admin." });
      }

      await db.execute({ sql: "INSERT INTO reports (date, pj_id, checkin_photo, checkin_time, status, latitude, longitude, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))", args: [today, fields.pj_id, photoUrl, finalTime, finalStatus, lat, lon] });
      await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['attendance', `PJ ${pjName} mengirim absensi (${finalStatus}) pukul ${finalTime} WIB`, fields.pj_id, pjName] });
      return json(200, { success: true });
    }

    // CLEANING REPORT with admin confirm
    if (method === "POST" && segments[0] === "report" && !segments[1]) {
      const { fields, file } = parseMultipart(event);
      const { dateStr } = getServerWIBTime();
      const today = dateStr;
      let photoUrl = "";
      if (file) {
        await db.execute({ sql: "INSERT OR REPLACE INTO file_uploads (filename, data, mime_type) VALUES (?, ?, ?)", args: [file.filename, file.data, file.mimeType] });
        photoUrl = `/uploads/${file.filename}`;
      }
      const report = await db.execute({ sql: "SELECT id FROM reports WHERE pj_id = ? AND date = ?", args: [fields.pj_id, today] });
      if (report.rows.length === 0) return json(400, { success: false, message: "Silakan absen kehadiran terlebih dahulu!" });
      const reportId = report.rows[0].id as number;

      const pjRes = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [fields.pj_id] });
      const pjName = pjRes.rows[0]?.name || 'Unknown';

      const tRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'testing_mode'", args: [] });
      const isTestingMode = tRes.rows[0]?.value === "true";

      const confirmRes = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'require_admin_confirm'", args: [] });
      const requireConfirm = confirmRes.rows[0]?.value === "true" && !isTestingMode;

      if (requireConfirm) {
        const pendingData = JSON.stringify({ cleaning_photo: photoUrl, description: fields.description, absentMembers: fields.absentMembers, report_id: reportId, date: today });
        await db.execute({ sql: "INSERT INTO pending_approvals (type, pj_id, pj_name, data) VALUES (?, ?, ?, ?)", args: ["report", fields.pj_id, pjName, pendingData] });
        await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['report_pending', `⏳ PJ ${pjName} mengirim laporan kelas (${today}) — menunggu konfirmasi`, fields.pj_id, pjName] });
        return json(200, { success: true, pending: true, message: "Laporan berhasil dikirim, menunggu konfirmasi admin." });
      }

      await db.execute({ sql: "UPDATE reports SET cleaning_photo = ?, cleaning_description = ?, submitted_at = datetime('now') WHERE id = ?", args: [photoUrl, fields.description, reportId] });
      await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [reportId] });
      if (fields.absentMembers) {
        // Statuses that get recorded as violations in Laporan Anggota
        // 'Izin Telat' is mapped to 'Telat' in the violation record
        const VIOLATION_STATUSES: Record<string, string> = {
          'Alfa': 'Alfa',
          'Sakit (Tanpa Surat)': 'Sakit (Tanpa Surat)',
          'Izin Telat': 'Telat',
          'Telat': 'Telat',
        };
        for (const m of JSON.parse(fields.absentMembers)) {
          await db.execute({ sql: "INSERT INTO absent_members (report_id, member_id, name, reason) VALUES (?, ?, ?, ?)", args: [reportId, m.member_id || null, m.name, m.reason] });
          const violationType = VIOLATION_STATUSES[m.reason];
          if (violationType) {
            const vExists = await db.execute({ sql: "SELECT id FROM violations WHERE member_name = ? AND date = ? AND type = ?", args: [m.name, today, violationType] });
            if (vExists.rows.length === 0) {
              await db.execute({ sql: "INSERT INTO violations (member_id, member_name, pj_id, date, type) VALUES (?, ?, ?, ?, ?)", args: [m.member_id || null, m.name, fields.pj_id, today, violationType] });
            }
          }
        }
      }
      await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['report', `PJ ${pjName} mengirim laporan kelas (${today})`, fields.pj_id, pjName] });
      return json(200, { success: true });
    }

    // PENDING APPROVALS
    if (method === "GET" && segments[0] === "pending-approvals") {
      const r = await db.execute("SELECT * FROM pending_approvals ORDER BY created_at DESC");
      return json(200, r.rows);
    }

    if (method === "POST" && segments[0] === "pending-approvals" && segments[2] === "approve") {
      const pendingRes = await db.execute({ sql: "SELECT * FROM pending_approvals WHERE id = ?", args: [segments[1]] });
      if (pendingRes.rows.length === 0) return json(404, { success: false, message: "Data tidak ditemukan" });
      const item = pendingRes.rows[0];
      const data = JSON.parse(item.data as string);
      if (item.type === "attendance") {
        const existing = await db.execute({ sql: "SELECT id FROM reports WHERE pj_id = ? AND date = ?", args: [item.pj_id as number, data.date] });
        if (existing.rows.length === 0) {
          await db.execute({ sql: "INSERT INTO reports (date, pj_id, checkin_photo, checkin_time, status, latitude, longitude, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))", args: [data.date, item.pj_id, data.checkin_photo, data.checkin_time, data.status, data.latitude, data.longitude] });
        }
        await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['attendance', `✅ Absensi PJ ${item.pj_name} disetujui (${data.status}) pukul ${data.checkin_time} WIB`, item.pj_id, item.pj_name] });
      } else if (item.type === "report") {
        await db.execute({ sql: "UPDATE reports SET cleaning_photo = ?, cleaning_description = ?, submitted_at = datetime('now') WHERE id = ?", args: [data.cleaning_photo, data.description, data.report_id] });
        await db.execute({ sql: "DELETE FROM absent_members WHERE report_id = ?", args: [data.report_id] });
        if (data.absentMembers) {
          const VIOLATION_STATUSES: Record<string, string> = {
            'Alfa': 'Alfa',
            'Sakit (Tanpa Surat)': 'Sakit (Tanpa Surat)',
            'Izin Telat': 'Telat',
            'Telat': 'Telat',
          };
          for (const m of JSON.parse(data.absentMembers)) {
            await db.execute({ sql: "INSERT INTO absent_members (report_id, member_id, name, reason) VALUES (?, ?, ?, ?)", args: [data.report_id, m.member_id || null, m.name, m.reason] });
            const violationType = VIOLATION_STATUSES[m.reason];
            if (violationType) {
              const vExists = await db.execute({ sql: "SELECT id FROM violations WHERE member_name = ? AND date = ? AND type = ?", args: [m.name, data.date, violationType] });
              if (vExists.rows.length === 0) {
                await db.execute({ sql: "INSERT INTO violations (member_id, member_name, pj_id, date, type) VALUES (?, ?, ?, ?, ?)", args: [m.member_id || null, m.name, item.pj_id, data.date, violationType] });
              }
            }
          }
        }
        await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['report', `✅ Laporan PJ ${item.pj_name} disetujui (${data.date})`, item.pj_id, item.pj_name] });
      }
      await db.execute({ sql: "DELETE FROM pending_approvals WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "pending-approvals" && segments[2] === "reject") {
      const pendingRes = await db.execute({ sql: "SELECT * FROM pending_approvals WHERE id = ?", args: [segments[1]] });
      if (pendingRes.rows.length === 0) return json(404, { success: false, message: "Data tidak ditemukan" });
      const item = pendingRes.rows[0];
      await db.execute({ sql: "INSERT INTO admin_notifications (type, message, pj_id, pj_name) VALUES (?, ?, ?, ?)", args: ['rejected', `❌ Pengajuan PJ ${item.pj_name} (${item.type}) ditolak admin`, item.pj_id, item.pj_name] });
      await db.execute({ sql: "DELETE FROM pending_approvals WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    // VIOLATIONS
    if (method === "GET" && segments[0] === "violations" && !segments[1]) {
      const r = await db.execute("SELECT * FROM violations ORDER BY date DESC");
      return json(200, r.rows);
    }
    if (method === "GET" && segments[0] === "violations" && segments[1] === "summary") {
      const r = await db.execute("SELECT member_name, member_id, COUNT(*) as total_violations, SUM(CASE WHEN type = 'Alfa' THEN 1 ELSE 0 END) as alfa, SUM(CASE WHEN type = 'Sakit (Tanpa Surat)' THEN 1 ELSE 0 END) as sakit_tanpa_surat, SUM(CASE WHEN type = 'Telat' THEN 1 ELSE 0 END) as telat FROM violations GROUP BY member_name ORDER BY total_violations DESC");
      return json(200, r.rows);
    }
    if (method === "POST" && segments[0] === "violations" && !segments[1]) {
      const { member_id, member_name, pj_id, date, type, notes } = JSON.parse(event.body || "{}");
      await db.execute({ sql: "INSERT INTO violations (member_id, member_name, pj_id, date, type, notes) VALUES (?, ?, ?, ?, ?, ?)", args: [member_id || null, member_name, pj_id || null, date, type, notes || null] });
      return json(200, { success: true });
    }
    if (method === "DELETE" && segments[0] === "violations" && segments[1]) {
      await db.execute({ sql: "DELETE FROM violations WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    // NOTIFICATIONS — with delete single + delete all
    if (method === "GET" && segments[0] === "notifications" && !segments[1]) {
      const r = await db.execute("SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 100");
      return json(200, r.rows);
    }
    if (method === "GET" && segments[0] === "notifications" && segments[1] === "unread-count") {
      const r = await db.execute("SELECT COUNT(*) as count FROM admin_notifications WHERE is_read = 0");
      return json(200, { count: r.rows[0]?.count || 0 });
    }
    if (method === "POST" && segments[0] === "notifications" && segments[1] === "mark-read") {
      await db.execute("UPDATE admin_notifications SET is_read = 1");
      return json(200, { success: true });
    }
    // DELETE single
    if (method === "DELETE" && segments[0] === "notifications" && segments[1] && segments[1] !== "all") {
      await db.execute({ sql: "DELETE FROM admin_notifications WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }
    // DELETE all
    if (method === "DELETE" && segments[0] === "notifications" && segments[1] === "all") {
      await db.execute("DELETE FROM admin_notifications");
      return json(200, { success: true });
    }

    // SUBSTITUTIONS — day-matching + 3-week max range
    if (method === "GET" && segments[0] === "substitutions" && !segments[1]) {
      const pj_id = query.pj_id;
      const base = "SELECT s.*, r.name as requester_name, r.group_name as requester_group, sub.name as substitute_name, sub.group_name as substitute_group FROM substitutions s JOIN users r ON s.requester_pj_id = r.id JOIN users sub ON s.substitute_pj_id = sub.id";
      const r = pj_id
        ? await db.execute({ sql: `${base} WHERE s.requester_pj_id = ? OR s.substitute_pj_id = ? ORDER BY s.created_at DESC`, args: [pj_id, pj_id] })
        : await db.execute(`${base} ORDER BY s.created_at DESC`);
      return json(200, r.rows);
    }
    if (method === "POST" && segments[0] === "substitutions" && !segments[1]) {
      const { requester_pj_id, substitute_pj_id, original_date, substitute_date } = JSON.parse(event.body || "{}");
      if (!requester_pj_id || !substitute_pj_id || !original_date) return json(400, { success: false, message: "Data tidak lengkap" });

      const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      const origDayOfWeek = new Date(original_date + "T00:00:00").getDay();
      const origDayName = dayNames[origDayOfWeek];

      const requesterSched = await db.execute({ sql: "SELECT s.day FROM schedules s JOIN users u ON s.group_name = u.group_name WHERE u.id = ?", args: [requester_pj_id] });
      if (requesterSched.rows.length > 0) {
        const schedDay = requesterSched.rows[0].day as string;
        if (origDayName !== schedDay) {
          return json(400, { success: false, message: `Tanggal (${origDayName}) tidak cocok dengan hari jadwal Anda (${schedDay}). Pilih tanggal yang hari-nya sesuai.` });
        }
      }

      const { dateStr } = getServerWIBTime();
      const todayDate = new Date(dateStr + "T00:00:00");
      const maxDate = new Date(todayDate.getTime() + 21 * 24 * 60 * 60 * 1000);
      const origDate = new Date(original_date + "T00:00:00");

      if (origDate < todayDate) return json(400, { success: false, message: "Tidak bisa menukar jadwal yang sudah lewat" });
      if (origDate > maxDate) return json(400, { success: false, message: `Maksimal 3 minggu ke depan (sebelum ${maxDate.toISOString().split('T')[0]})` });

      const debt = await db.execute({ sql: "SELECT COUNT(*) as c FROM substitutions WHERE requester_pj_id = ? AND status = 'pending'", args: [requester_pj_id] });
      if ((debt.rows[0]?.c as number) >= 3) return json(400, { success: false, message: "Batas hutang jadwal (3) tercapai." });

      await db.execute({ sql: "INSERT INTO substitutions (requester_pj_id, substitute_pj_id, original_date, substitute_date, status) VALUES (?, ?, ?, ?, 'pending')", args: [requester_pj_id, substitute_pj_id, original_date, substitute_date || null] });
      return json(200, { success: true });
    }
    if (method === "PUT" && segments[0] === "substitutions" && segments[1]) {
      const { status } = JSON.parse(event.body || "{}");
      await db.execute({ sql: "UPDATE substitutions SET status = ? WHERE id = ?", args: [status, segments[1]] });
      return json(200, { success: true });
    }
    if (method === "DELETE" && segments[0] === "substitutions" && segments[1]) {
      await db.execute({ sql: "DELETE FROM substitutions WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "shuffle-members") {
      const { numGroups } = JSON.parse(event.body || "{}");
      const pjCount = parseInt(numGroups);
      if (!pjCount || pjCount < 1) return json(400, { success: false, message: "Jumlah grup tidak valid" });
      const allMembersRes = await db.execute("SELECT id, name FROM class_members");
      if (allMembersRes.rows.length === 0) return json(400, { success: false, message: "Belum ada anggota kelas" });
      if (pjCount > allMembersRes.rows.length) return json(400, { success: false, message: "Jumlah grup melebihi jumlah anggota" });
      const COMPUTER_TERMS_LOCAL = ["Algorithm","Binary","Cache","Daemon","Ethernet","Firmware","Gateway","Hexadecimal","Interface","Kernel","Lambda","Mutex","Namespace","OAuth","Protocol","Query","Router","Subnet","Terminal","Uptime","Vector","Webhook","Xorshift","Yaml","Zeroconf","Bootloader","Compiler","Debugger","Encoder","Firewall","Hypervisor","Iterator","Linker","Microkernel","Nonce","Overhead","Pipeline","Queue","Recursion","Semaphore","Thread","Unicode","Virtual","Wrapper","Yarn","Zipfile"];
      const DAYS_ORDER_S = ["Senin","Selasa","Rabu","Kamis","Jumat"];
      function shuffleArr<T>(arr: T[]): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
      const shuffledMembers = shuffleArr(allMembersRes.rows);
      const shuffledDays = shuffleArr([...DAYS_ORDER_S]).slice(0, pjCount);
      await db.execute("UPDATE class_members SET pj_id = NULL");
      await db.execute("DELETE FROM schedules");
      await db.execute("DELETE FROM substitutions");
      await db.execute("DELETE FROM users WHERE role = 'pj'");
      const usedTerms: string[] = [];
      for (let i = 0; i < pjCount; i++) {
        const groupMembers = shuffledMembers.filter((_, idx) => idx % pjCount === i);
        if (groupMembers.length === 0) continue;
        const pjMember = groupMembers[0];
        const available = COMPUTER_TERMS_LOCAL.filter(t => !usedTerms.includes(t));
        const term = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : `${COMPUTER_TERMS_LOCAL[0]}${i + 2}`;
        usedTerms.push(term);
        const groupName = `Kelompok ${term}`;
        const code = generateCode(6);
        // Use RETURNING id to avoid race condition on Turso HTTP
        const insertPJ = await db.execute({ sql: "INSERT INTO users (name, account_code, role, group_name) VALUES (?, ?, 'pj', ?) RETURNING id", args: [pjMember.name as string, code, groupName] });
        let newPJId: number;
        if (insertPJ.rows.length > 0 && insertPJ.rows[0].id) {
          newPJId = insertPJ.rows[0].id as number;
        } else {
          const newPJ = await db.execute({ sql: "SELECT id FROM users WHERE name = ? AND account_code = ?", args: [pjMember.name as string, code] });
          newPJId = newPJ.rows[0].id as number;
        }
        for (const m of groupMembers) { await db.execute({ sql: "UPDATE class_members SET pj_id = ? WHERE id = ?", args: [newPJId, m.id as number] }); }
        await db.execute({ sql: "UPDATE users SET member_id = ? WHERE id = ?", args: [pjMember.id as number, newPJId] });
        if (shuffledDays[i]) { await db.execute({ sql: "INSERT INTO schedules (group_name, day) VALUES (?, ?)", args: [groupName, shuffledDays[i]] }); }
      }
      return json(200, { success: true });
    }

    if (method === "POST" && segments[0] === "schedules" && segments[1] === "import-text") {
      const { text } = JSON.parse(event.body || "{}");
      if (!text) return json(400, { success: false, message: "Teks tidak boleh kosong" });
      const DAYS_ORDER_I = ["Senin","Selasa","Rabu","Kamis","Jumat"];
      type ParsedGroupI = { day: string; pjName: string; groupName: string; memberNames: string[] };
      const lines = (text as string).split("\n").map((l: string) => l.trim()).filter(Boolean);
      const groups: ParsedGroupI[] = [];
      let current: ParsedGroupI | null = null;
      for (const line of lines) {
        if (DAYS_ORDER_I.includes(line)) { if (current) groups.push(current); current = { day: line, pjName: "", groupName: "", memberNames: [] }; }
        else if (current && (line.startsWith("\u2022") || line.startsWith("-") || line.startsWith("*"))) {
          const raw = line.replace(/^[\u2022\-*]\s*/, "").trim();
          const isPJ = /\(PJ\)/i.test(raw);
          const name = raw.replace(/\s*\(PJ\)\s*$/i, "").trim();
          if (isPJ && !current.pjName) { current.pjName = name; current.groupName = `Kelompok ${name}`; }
          else { current.memberNames.push(name); }
        }
      }
      if (current) groups.push(current);
      for (const g of groups) { if (!g.pjName && g.memberNames.length > 0) { g.pjName = g.memberNames.shift()!; g.groupName = `Kelompok ${g.pjName}`; } }
      const valid = groups.filter(g => g.day && g.pjName);
      if (valid.length === 0) return json(400, { success: false, message: "Format tidak valid." });
      const newCodes: { name: string; code: string }[] = [];
      for (const g of valid) {
        const groupName = g.groupName;
        const existSched = await db.execute({ sql: "SELECT id FROM schedules WHERE day = ?", args: [g.day] });
        if (existSched.rows.length > 0) { await db.execute({ sql: "UPDATE schedules SET group_name = ? WHERE id = ?", args: [groupName, existSched.rows[0].id as number] }); }
        else { await db.execute({ sql: "INSERT INTO schedules (group_name, day) VALUES (?, ?)", args: [groupName, g.day] }); }
        const pjUserRes = await db.execute({ sql: "SELECT id FROM users WHERE name = ? AND role = 'pj'", args: [g.pjName] });
        let pjId: number;
        if (pjUserRes.rows.length === 0) {
          const code = generateCode(6);
          // Use RETURNING id to avoid race condition on Turso HTTP (avoids extra SELECT by account_code)
          const insertRes = await db.execute({ sql: "INSERT INTO users (name, account_code, role, group_name) VALUES (?, ?, 'pj', ?) RETURNING id", args: [g.pjName, code, groupName] });
          if (insertRes.rows.length > 0 && insertRes.rows[0].id) {
            pjId = insertRes.rows[0].id as number;
          } else {
            // Fallback: SELECT by name+code
            const newPJ = await db.execute({ sql: "SELECT id FROM users WHERE name = ? AND account_code = ?", args: [g.pjName, code] });
            pjId = newPJ.rows[0].id as number;
          }
          newCodes.push({ name: g.pjName, code });
        } else {
          pjId = pjUserRes.rows[0].id as number;
          // Always ensure group_name is up to date
          await db.execute({ sql: "UPDATE users SET group_name = ? WHERE id = ?", args: [groupName, pjId] });
        }
        const pjMemberRes = await db.execute({ sql: "SELECT id FROM class_members WHERE name = ?", args: [g.pjName] });
        if (pjMemberRes.rows.length === 0) { await db.execute({ sql: "INSERT INTO class_members (name, pj_id) VALUES (?, ?)", args: [g.pjName, pjId] }); }
        else { await db.execute({ sql: "UPDATE class_members SET pj_id = ? WHERE id = ?", args: [pjId, pjMemberRes.rows[0].id as number] }); }
        for (const mName of g.memberNames) {
          const existingM = await db.execute({ sql: "SELECT id FROM class_members WHERE name = ?", args: [mName] });
          if (existingM.rows.length === 0) { await db.execute({ sql: "INSERT INTO class_members (name, pj_id) VALUES (?, ?)", args: [mName, pjId] }); }
          else { await db.execute({ sql: "UPDATE class_members SET pj_id = ? WHERE id = ?", args: [pjId, existingM.rows[0].id as number] }); }
        }
      }
      return json(200, { success: true, imported: valid.length, newAccounts: newCodes });
    }

    if (method === "POST" && segments[0] === "reports" && segments[2] === "react") {
      await db.execute({ sql: "UPDATE reports SET is_read = 1 WHERE id = ?", args: [segments[1]] });
      return json(200, { success: true });
    }

    return json(404, { success: false, message: `Route tidak ditemukan: ${method} /${rawPath}` });
  } catch (err: any) {
    console.error("API route error:", err);
    return json(500, { success: false, message: err.message || "Internal server error" });
  }
};
