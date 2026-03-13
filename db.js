const mysql = require('mysql2/promise');

const db = mysql.createPool({
    host: 'mysql-5a8f04e-event-system-qr.f.aivencloud.com',
    user: 'avnadmin',
    password: 'AVNS_hOGbn3DtwyLIXoO_38d',
    database: 'defaultdb',
    port: 20429,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false } 
});

module.exports = db;