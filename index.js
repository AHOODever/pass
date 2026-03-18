const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // تم استبدال mysql بـ sqlite3

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const SECRET_KEY = "Event_Gate_Key_2026";

// --- إعداد قاعدة بيانات SQLite المحلية ---
// سيتم إنشاء ملف باسم database.sqlite في مجلد المشروع تلقائياً
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('خطأ في فتح قاعدة البيانات:', err.message);
    } else {
        console.log('متصل بقاعدة بيانات SQLite المحلية بنجاح! 📂');
    }
});

// --- إعداد مرسل الإيميلات ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'Ahoodyoou@gmail.com',
        pass: 'fuld dzbt yhua ybwv' 
    }
});

// --- Middleware للتحقق من التوكن ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "يرجى تسجيل الدخول أولاً" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: "جلسة انتهت" });
        req.user = user;
        next();
    });
};

// 1. تسجيل الحضور (العام)
app.post('/register', async (req, res) => {
    const { name, email, phone } = req.body;
    const qrKey = `EVT-${Date.now()}`;

    const sql = 'INSERT INTO attendees (name, email, phone, qr_code_key) VALUES (?, ?, ?, ?)';
    db.run(sql, [name, email, phone, qrKey], async function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "الإيميل مسجل مسبقاً أو حدث خطأ داخلي" });
        }

        try {
            const qrImage = await qrcode.toDataURL(qrKey);
            const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");

            const mailOptions = {
                from: '"فريق تنظيم الفعالية" <Ahoodyoou@gmail.com>',
                to: email,
                subject: 'تذكرتك الرسمية للفعالية 🎫',
                html: `
                    <div style="direction: rtl; text-align: center; font-family: Arial, sans-serif;">
                        <h2 style="color: #444;">أهلاً بك يا ${name}!</h2>
                        <img src="cid:qrcodeimage" alt="QR Code" style="width: 200px; height: 200px;" />
                        <p><strong>رمز التذكرة:</strong> ${qrKey}</p>
                    </div>`,
                attachments: [{ filename: 'ticket-qr.png', content: base64Data, encoding: 'base64', cid: 'qrcodeimage' }]
            };

            await transporter.sendMail(mailOptions);
            res.status(201).json({ message: "تم التسجيل وإرسال التذكرة!" });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "فشل إرسال الإيميل" });
        }
    });
});

// 2. إنشاء حساب منظم
app.post('/organizer-signup', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO organizers (name, email, password) VALUES (?, ?, ?)';
        db.run(sql, [name, email, hashedPassword], (err) => {
            if (err) return res.status(500).json({ error: "الإيميل مسجل مسبقاً" });
            res.json({ success: true, message: "تم إنشاء حساب المنظم" });
        });
    } catch (error) {
        res.status(500).json({ error: "خطأ في التشفير" });
    }
});

// 3. دخول المنظم
app.post('/organizer-login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM organizers WHERE email = ?', [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ success: false, message: "المستخدم غير موجود" });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '24h' });
            res.json({ success: true, token, name: user.name });
        } else {
            res.status(401).json({ success: false, message: "كلمة المرور خاطئة" });
        }
    });
});

// 4. التحقق عند البوابة
app.post('/verify', authenticateToken, (req, res) => {
    const { qrKey } = req.body;
    db.get('SELECT * FROM attendees WHERE qr_code_key = ?', [qrKey], (err, attendee) => {
        if (err || !attendee) return res.status(404).json({ status: 'error', message: 'تذكرة غير صالحة!' });

        if (attendee.is_checked_in) {
            return res.json({ status: 'warning', message: `تم الدخول مسبقاً`, name: attendee.name });
        }

        db.run('UPDATE attendees SET is_checked_in = 1, check_in_time = CURRENT_TIMESTAMP WHERE qr_code_key = ?', [qrKey], (err) => {
            if (err) return res.status(500).json({ status: 'error', message: 'خطأ في التحديث' });
            res.json({ status: 'success', success: true, message: `تم تسجيل الدخول!`, name: attendee.name });
        });
    });
});

// 5. الإحصائيات
app.get('/stats', authenticateToken, (req, res) => {
    db.get('SELECT COUNT(*) as total FROM attendees', (err, rowTotal) => {
        db.get('SELECT COUNT(*) as present FROM attendees WHERE is_checked_in = 1', (err, rowPresent) => {
            if (err) return res.status(500).send("خطأ");
            res.json({ total: rowTotal.total, present: rowPresent.present });
        });
    });
});

// --- تهيئة الجداول عند التشغيل ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attendees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        qr_code_key TEXT UNIQUE NOT NULL,
        is_checked_in INTEGER DEFAULT 0,
        check_in_time TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS organizers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('الجداول المحلية جاهزة! 🚀');
});

app.listen(3000, () => {
    console.log('السيرفر شغال على http://localhost:3000');
});
