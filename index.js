const express = require('express');
const qrcode = require('qrcode');
const db = require('./db');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = "Event_Gate_Key_2026"; // مفتاح تشفير التوكن

// --- إعداد مرسل الإيميلات ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'Ahoodyoou@gmail.com',
        pass: 'fuld dzbt yhua ybwv' 
    }
});

// --- Middleware للتحقق من هوية المنظم ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "يرجى تسجيل الدخول أولاً" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: "جلسة انتهت، سجل دخولك مرة أخرى" });
        req.user = user;
        next();
    });
};

// 1. تسجيل الحضور (العام)
app.post('/register', async (req, res) => {
    const { name, email, phone } = req.body;
    try {
        const qrKey = `EVT-${Date.now()}`;
        await db.execute(
            'INSERT INTO attendees (name, email, phone, qr_code_key) VALUES (?, ?, ?, ?)',
            [name, email, phone, qrKey]
        );

        const qrImage = await qrcode.toDataURL(qrKey);
        const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");

        const mailOptions = {
            from: '"فريق تنظيم الفعالية" <Ahoodyoou@gmail.com>',
            to: email,
            subject: 'تذكرتك الرسمية للفعالية 🎫',
            html: `
                <div style="direction: rtl; text-align: center; font-family: Arial, sans-serif; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
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
        res.status(500).json({ error: "حدث خطأ أثناء التسجيل" });
    }
});

// 2. إنشاء حساب منظم جديد (يستخدم مرة واحدة لإضافة المسؤولين)
app.post('/organizer-signup', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.execute('INSERT INTO organizers (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword]);
        res.json({ success: true, message: "تم إنشاء حساب المنظم" });
    } catch (error) {
        res.status(500).json({ error: "الإيميل مسجل مسبقاً" });
    }
});

// 3. دخول المنظم (بإستخدام bcrypt و JWT)
app.post('/organizer-login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM organizers WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(401).json({ success: false, message: "المستخدم غير موجود" });

        const match = await bcrypt.compare(password, rows[0].password);
        if (match) {
            const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, SECRET_KEY, { expiresIn: '24h' });
            res.json({ success: true, token, name: rows[0].name });
        } else {
            res.status(401).json({ success: false, message: "كلمة المرور خاطئة" });
        }
    } catch (error) {
        res.status(500).json({ error: "خطأ في السيرفر" });
    }
});

// 4. التحقق عند البوابة (محمي بـ JWT)
app.post('/verify', authenticateToken, async (req, res) => {
    const { qrKey } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM attendees WHERE qr_code_key = ?', [qrKey]);
        if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'تذكرة غير صالحة!' });

        const attendee = rows[0];
        if (attendee.is_checked_in) {
            return res.status(400).json({ status: 'warning', message: `تم الدخول مسبقاً`, name: attendee.name });
        }

        await db.execute('UPDATE attendees SET is_checked_in = true, check_in_time = NOW() WHERE qr_code_key = ?', [qrKey]);
        res.json({ status: 'success', success: true, message: `تم تسجيل الدخول!`, name: attendee.name });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'خطأ في السيرفر' });
    }
});

// 5. API للإحصائيات (للوحة التحكم)
app.get('/stats', authenticateToken, async (req, res) => {
    try {
        const [total] = await db.execute('SELECT COUNT(*) as count FROM attendees');
        const [present] = await db.execute('SELECT COUNT(*) as count FROM attendees WHERE is_checked_in = true');
        res.json({ total: total[0].count, present: present[0].count });
    } catch (error) {
        res.status(500).send("خطأ");
    }
});

app.listen(3000, async () => {
    console.log('السيرفر شغال.. جاري التأكد من الجداول السحابية...');
    try {
        // إنشاء جدول الحضور إذا لم يكن موجوداً
        await db.execute(`
            CREATE TABLE IF NOT EXISTS attendees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20),
                qr_code_key VARCHAR(255) UNIQUE NOT NULL, 
                is_checked_in BOOLEAN DEFAULT FALSE,
                check_in_time DATETIME NULL             
            )
        `);

        // إنشاء جدول المنظمين إذا لم يكن موجوداً
        await db.execute(`
            CREATE TABLE IF NOT EXISTS organizers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('تم فحص الجداول السحابية بنجاح! 🚀');
    } catch (err) {
        console.error('خطأ في تهيئة الجداول:', err);
    }
});