const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
// Base64 files payload security tight rakhne ke liye limit badha di hai
app.use(express.json({ limit: '30mb' })); 

// 1. Databases Connection
const pool = new Pool({ connectionString: process.env.PG_URI });
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🍃 MongoDB Vault Connected...'))
    .catch(err => console.error('MongoDB Error:', err));

// Database Architecture Schema
pool.query(`
    CREATE TABLE IF NOT EXISTS trucks (
        id SERIAL PRIMARY KEY,
        truck_number VARCHAR(50) UNIQUE NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS route_logs (
        id SERIAL PRIMARY KEY,
        truck_id INT REFERENCES trucks(id) ON DELETE CASCADE,
        source VARCHAR(100) NOT NULL,
        destination VARCHAR(100) NOT NULL,
        driver1 VARCHAR(100) NOT NULL,
        driver2 VARCHAR(100),
        log_date DATE DEFAULT CURRENT_DATE
    );
`).then(() => console.log('🐘 PostgreSQL Master Operational...'));

// MongoDB Compliance Store
const DocumentSchema = new mongoose.Schema({
    truckNumber: { type: String, required: true },
    documentType: { type: String, required: true }, 
    expiryDate: { type: Date, required: true },
    fileBase64: { type: String, required: true } // Stores full printable string
});
const TruckDocument = mongoose.model('TruckDocument', DocumentSchema);

// Email Engine Config
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// Helper Function: Instant Mail dispatch
async function sendInstantOwnerMail(subject, bodyText) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.OWNER_EMAIL,
            subject: `🔔 SANTOSH OS: ${subject}`,
            text: `SANTOSH FLYASH TRANSPORTS\nControl Room Updates\n\n${bodyText}\n\nTimestamp: ${new Date().toLocaleString()}`
        });
    } catch (e) { console.error("Instant mail error:", e); }
}

// 2. CRON ENGINE: Har din subah 8 baje chalne wala loop (10 din pehle se alert)
cron.schedule('0 8 * * *', async () => {
    try {
        const today = new Date(); today.setHours(0,0,0,0);
        const tenDaysAway = new Date(today); tenDaysAway.setDate(tenDaysAway.getDate() + 10);
        tenDaysAway.setHours(23,59,59,999);

        const criticalDocs = await TruckDocument.find({ expiryDate: { $gte: today, $lte: tenDaysAway } });

        for (let doc of criticalDocs) {
            const daysLeft = Math.ceil((new Date(doc.expiryDate) - today) / (1000 * 60 * 60 * 24));
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.OWNER_EMAIL,
                subject: `⚠️ DAILY EXPIRE ALERT: ${doc.truckNumber} Paper within ${daysLeft} Days!`,
                text: `SANTOSH FLYASH TRANSPORTS\n\nUrgent Alert:\nThe "${doc.documentType}" for Truck [ ${doc.truckNumber} ] is terminating soon.\nExpiry Date: ${new Date(doc.expiryDate).toDateString()}\nRemaining Timeline: ${daysLeft} Days.\n\nRenew the parameter in dashboard to silence this trigger.`
            });
        }
    } catch (err) { console.error('Cron Crash:', err); }
});

// 3. BUSINESS ROUTING API ENDPOINTS

// Add Truck Master
app.post('/api/trucks/add', async (req, res) => {
    const { truck_number } = req.body;
    try {
        const cleanNumber = truck_number.trim().toUpperCase();
        const result = await pool.query('INSERT INTO trucks (truck_number) VALUES ($1) RETURNING *', [cleanNumber]);
        
        await sendInstantOwnerMail("New Truck Added", `Vehicle ${cleanNumber} has been successfully onboarded into active fleet operations.`);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(400).json({ error: 'Truck already exists' }); }
});

// Dropdown Loader
app.get('/api/trucks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trucks ORDER BY truck_number ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trip Insertion Log
app.post('/api/logs/add', async (req, res) => {
    const { truck_id, truck_num, source, destination, driver1, driver2 } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO route_logs (truck_id, source, destination, driver1, driver2, log_date) 
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING *`,
            [truck_id, source, destination, driver1, driver2]
        );
        
        await sendInstantOwnerMail("Trip Logged Entry", `Truck: ${truck_num}\nRoute: ${source} to ${destination}\nCrew: ${driver1} / ${driver2 || 'None'}`);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Compliance Upload API
app.post('/api/docs/upload', async (req, res) => {
    try {
        const newDoc = new TruckDocument(req.body);
        await newDoc.save();

        await sendInstantOwnerMail("Compliance File Uploaded", `Truck: ${req.body.truckNumber}\nType: ${req.body.documentType}\nExpiry Designated: ${req.body.expiryDate}`);
        res.status(201).json({ message: 'Saved successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Isolated Search Explorer Engine
app.get('/api/trucks/history/:truckId/:truckNumber', async (req, res) => {
    const { truckId, truckNumber } = req.params;
    try {
        const trips = await pool.query(
            `SELECT source, destination, driver1, driver2, log_date 
             FROM route_logs WHERE truck_id = $1 ORDER BY log_date DESC`, [truckId]
        );
        // Securely returns fileBase64 string as well for on-demand downloads
        const docs = await TruckDocument.find({ truckNumber: truckNumber });
        res.json({ trips: trips.rows, documents: docs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(5000, () => console.log('🚀 Super Mobile Fleet Engine active on port 5000'));