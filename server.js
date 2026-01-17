// server.js
import cors from "cors";


// ✅ Allow all origins (development)
app.use(cors());

// OR allow specific origin
app.use(cors({
  origin: "http://10.128.27.85:5000", // your frontend IP
  methods: ["GET","POST","PUT","DELETE"],
  credentials: true
}));
// ======================= IMPORTS =======================
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

// ======================= APP INIT =======================
const app = express();

// ======================= MIDDLEWARE =======================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================= PATH FIX (ES MODULE) =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================= SERVE FRONTEND =======================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Loginpage.html"));
});


// ✅ MySQL connection
const db = await mysql.createConnection({
  host: "localhost",
  user: "root",       // change if needed
  password: "Auto123!",
  database: "Recharge_db"
});

console.log("✅ Connected to MySQL Database");

// ======================= REGISTER =======================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, role } = req.body;

    await db.query(
      "INSERT INTO users(username, password, role) VALUES (?, ?, ?)",
      [username, password, role || "user"]
    );

    res.json({ message: "Registered successfully" });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ======================= LOGIN =======================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (users.length === 0) return res.json({ error: "User not found" });

    const user = users[0];
    const passwordMatch =
      user.password.length < 30
        ? password === user.password
        : await bcrypt.compare(password, user.password);

    if (!passwordMatch) return res.json({ error: "Invalid password" });

    res.json({ message: "Login successful", role: user.role });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.json({ error: "Login failed" });
  }
});

// ======================= GET ALL RECHARGE DATA =======================
app.get("/api/recharge", async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT
        r.id,
        r.outlet_name,
        r.operator_name,
        r.operator_2,
        r.mobile_number,
        r.base_start_date,
        r.base_end_date,
        u.plan_name,
        u.upgrade_start_date,
        u.upgrade_end_date,
        u.upgraded_by
      FROM recharge_data r
      LEFT JOIN recharge_upgrades u
        ON u.recharge_id = r.id
      ORDER BY r.id;
    `);

    res.json(results);
  } catch (err) {
    console.error("❌ Database query error:", err);
    res.status(500).json({ error: "Failed to fetch recharge data" });
  }
});

// ======================= INSERT NEW RECHARGE =======================
app.post("/api/insert", async (req, res) => {
  try {
    const data= req.body;
    const user = req.headers.user || "Unknown User";

    if ( !data.outlet_name ||
      !data.operator_name ||
      !data.operator_2 ||
      !data.mobile_number ||
      !data.base_start_date ||
      !data.base_end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [result] = await db.query(
      `INSERT INTO recharge_data 
        (outlet_name, operator_name, operator_2, mobile_number, base_start_date, base_end_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ data.outlet_name, data.operator_name, data.operator_2,
        data.mobile_number, data.base_start_date, data.base_end_date]
    );

    const newRecord = { 
      id: result.insertId,
      outlet_name: data.outlet_name,
      operator_name: data.operator_name,
      operator_2: data.operator_2,
      mobile_number: data.mobile_number,
      base_start_date: data.base_start_date,
      base_end_date: data.base_end_date
    };

    await logHistory(user, "INSERT", `Inserted new record: ${JSON.stringify(data)}`);
    res.status(201).json(newRecord);

  } catch (err) {
    console.error("❌ Insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// ======================= UPDATE RECHARGE =======================
app.put("/api/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const newData = req.body;
    const user = req.headers.user || "Unknown User";

    const [oldRows] = await db.query("SELECT * FROM recharge_data WHERE id = ?", [id]);
    const oldData = oldRows[0];

    if (!oldData) return res.status(404).json({ message: "Record not found" });

    await db.query(
      `UPDATE recharge_data 
       SET outlet_name = ?, operator_name = ?, operator_2 = ?, mobile_number = ?, base_start_date = ?, base_end_date = ?
       WHERE id = ?`,
      [
        newData.outlet_name,
        newData.operator_name,
        newData.operator_2,
        newData.mobile_number,
        newData.base_start_date,
        newData.base_end_date,
        id
      ]
    );

    const detailText =`
=== OLD DATA ===
${JSON.stringify(oldData, null, 2)}

=== NEW DATA ===
${JSON.stringify(newData, null, 2)}
`;
    await logHistory(user, "UPDATE", detailText);
    res.json({ message: "Record updated successfully!" });
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// ======================= DELETE RECHARGE =======================
app.delete("/api/recharge/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.headers.user || "Unknown User";

    const [rows] = await db.query("SELECT * FROM recharge_data WHERE id=?", [id]);
    const oldRecord = rows[0];

    await db.query("DELETE FROM recharge_data WHERE id = ?", [id]);

    await logHistory(user, "DELETE", `Deleted record: ${JSON.stringify(oldRecord)}`);
    res.json({ message: "Record deleted successfully!" });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ======================= UPGRADE =======================
app.post("/api/upgrade/:id", async (req, res) => {
  try {
    const rechargeId = req.params.id;
    const { plan_name, upgrade_start_date, upgrade_end_date } = req.body;
    const upgradedBy = req.headers.user || "Unknown";
    console.log("BODY:", req.body);
    console.log("PARAM ID:", req.params.id);

    if (!plan_name || !upgrade_start_date || !upgrade_end_date) {
      return res.status(400).json({ message: "Missing upgrade details" });
    }

    // 1️⃣ Get outlet name
    const [rows] = await db.query(
      "SELECT outlet_name FROM recharge_data WHERE id = ?",
      [rechargeId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Recharge record not found" });
    }

    const outletName = rows[0].outlet_name;

    // 2️⃣ Insert upgrade record
    await db.query(
      `INSERT INTO recharge_upgrades
       (recharge_id, outlet_name, plan_name, upgrade_start_date, upgrade_end_date, upgraded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rechargeId, outletName, plan_name, upgrade_start_date, upgrade_end_date, upgradedBy]
    );

    
  
    // 4️⃣ Log history
    await logHistory(
      upgradedBy,
      "UPGRADE",
      `Upgraded plan for outlet ${outletName}: ${plan_name} (${upgrade_start_date} → ${upgrade_end_date})`
    );

    res.json({ message: "Plan upgraded successfully" });

  } catch (err) {
    console.error("❌ SQL ERROR:", err);
  return res.status(500).json({
    message: err.sqlMessage || err.message
  });
  }
});


// DELETE ALL upgrades for a recharge
app.delete("/api/recharge-upgrades/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.headers.user || "Unknown User";

    await db.query(
      "DELETE FROM recharge_upgrades WHERE recharge_id = ?",
      [id]
    );

    await logHistory(
      user,
      "DELETE",
      `Deleted all upgrades for recharge ID ${id}`
    );

    res.json({ message: "All upgrades deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upgrade delete failed" });
  }
});


// ======================= HISTORY LOG =======================
function logHistory(user_name, action, details){
  const query = "INSERT INTO history_log(user_name, action, details) VALUES (?, ?, ?)";
  db.query(query, [user_name, action, details], (err) =>{
    if(err) console.error("History log error")
  })
}

// ======================= EDIT COUNT =======================
app.get("/api/edit-count/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await db.query(
       "SELECT COUNT(*) AS edits FROM history_log WHERE id = ? AND action = 'UPDATE'",
       [id]
    );

    res.json({ edits: rows[0].edits || 0 });
  } catch (err) {
    console.error("❌ Edit count error:", err);
    res.status(500).json({ error: "Failed to fetch edit count" });
  }
});

// ======================= HISTORY FILTER =======================
app.get("/api/history", async (req, res) => {
  try {
    const role = req.headers.role;
    if (role !== "admin") return res.status(403).json({ message: "Access denied" });

    const { start, end } = req.query;
    let query = "SELECT * FROM history_log";
    let params = [];

    if (start && end) {
      query += " WHERE timestamp >= ? AND timestamp <= ?";
      params.push(`${start} 00:00:00`, `${end} 23:59:59`);
    } else if (start) {
      query += " WHERE timestamp >= ?";
      params.push(`${start} 00:00:00`);
    } else if (end) {
      query += " WHERE timestamp <= ?";
      params.push(`${end} 23:59:59`);
    }

    query += " ORDER BY timestamp DESC";
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ History filter error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// Generate ticket ID (Category + Incremental Number)
async function generateTicketID(code) {
  const prefix = code || "GEN";

  await db.beginTransaction();

  // Lock row for this code
  const [rows] = await db.query(
    "SELECT counter FROM ticket_counters WHERE code = ? FOR UPDATE",
    [prefix]
  );

  let counter;

  if (rows.length === 0) {
    counter = 1;
    await db.query(
      "INSERT INTO ticket_counters (code, counter) VALUES (?, ?)",
      [prefix, counter]
    );
  } else {
    counter = rows[0].counter + 1;
    await db.query(
      "UPDATE ticket_counters SET counter = ? WHERE code = ?",
      [counter, prefix]
    );
  }

  await db.commit();

  return `${prefix}-${String(counter).padStart(4, "0")}`;
}

// --- Add new complaint ---

app.post("/api/complaints", async (req, res) => {
  try {
    const { name_of_the_outlet,code, nature_of_complaint, breakdown__preventive, details_of_work_done, attended_by, reported_to } = req.body;
    const ticket_no = await generateTicketID(code);
    await db.query(
      `INSERT INTO automation_complaint 
      (ticket_no, name_of_the_outlet,code, nature_of_complaint, breakdown__preventive, details_of_work_done, attended_by, reported_to)
      VALUES (?,?,?, ?, ?, ?, ?, ?)`,
      [ticket_no, name_of_the_outlet,code, nature_of_complaint, breakdown__preventive, details_of_work_done, attended_by, reported_to]
    );
    res.json({ success: true, ticket_no });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// --- Get all complaints ---
app.get("/api/complaints", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        ticket_no,
        date,
        name_of_the_outlet,
        code,
        nature_of_complaint,
        breakdown__preventive,
        service_engineer,
        rectified_on,
        interruption_of_sales_if_any__time_duration,
        details_of_work_done
      FROM automation_complaint
      
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// --- Delete complaints ---
app.delete("/api/complaints/:ticket", async (req, res) => {
  try {
    const { ticket } = req.params;  // ✅ match the URL param
    const [rows] = await db.query(
      "SELECT * FROM automation_complaint WHERE ticket_no = ?",
      [ticket]
    );
    const complaint = rows[0];

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    await db.query("DELETE FROM complaints WHERE ticket_no = ?", [ticket]);

    res.json({ message: `Complaint ${ticket} deleted successfully!` });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});


// --- Get complaint by ticket ID ---
app.get("/api/complaints/:ticket", async (req, res) => {
  try {
    const ticket = req.params.ticket;
    const [rows] = await db.query(
      "SELECT * FROM automation_complaint WHERE ticket_no = ?",
      [ticket]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Update complaint status ---
app.put("/api/status", async (req, res) => {
  try {
    const { ticket_no, status } = req.body;

    // Get current count
    const [rows] = await db.query(
      "SELECT status_change_count FROM automation_complaint WHERE ticket_no = ?",
      [ticket_no]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const count = rows[0].status_change_count;

    if (count >= 2) {
      return res.json({
        success: false,
        message: "Status change limit reached."
      });
    }

    // Update status + increment counter
    const [update] = await db.query(
      "UPDATE automation_complaint SET status = ?, status_change_count = ? WHERE ticket_no = ?",
      [status, count + 1, ticket_no]
    );

    console.log("Rows updated:", update.affectedRows);  // DEBUG LINE
     console.log(ticket_no, count, status);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
 
});



// --- Monthly report ---
app.get("/api/report/:year/:month", async (req, res) => {
  try {
    const { year, month } = req.params;
    const [rows] = await db.query(
      `SELECT * FROM automation_complaint 
       WHERE YEAR(date) = ? AND MONTH(date) = ? 
       ORDER BY date DESC`,
      [year, month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ======================= OTHER ENDPOINTS (Complaints etc.) =======================
// Keep all complaints code unchanged as your column names are unrelated

// ======================= START SERVER =======================
const PORT = 5000;
app.listen(PORT, "0.0.0.0",()=> {
  console.log("Server is running on port 5000")
});
