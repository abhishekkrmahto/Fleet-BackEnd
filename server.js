const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const TruckDocument = require('./models/Document');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const pool = new Pool({ connectionString: process.env.PG_URI });

app.use(cors());
app.use(express.json({ limit: '30mb' }));

const transporter =
    process.env.EMAIL_USER && process.env.EMAIL_PASS
        ? nodemailer.createTransport({
              service: 'gmail',
              auth: {
                  user: process.env.EMAIL_USER,
                  pass: process.env.EMAIL_PASS
              }
          })
        : null;

async function connectDatabases() {
    mongoose
        .connect(process.env.MONGO_URI)
        .then(() => console.log('MongoDB vault connected'))
        .catch((err) => console.error('MongoDB error:', err.message));

    try {
        await pool.query(`
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
        `);
        console.log('PostgreSQL schema ready');
    } catch (err) {
        console.error('PostgreSQL schema error:', err.message);
    }
}

function cleanTruckNumber(value) {
    return String(value || '').trim().toUpperCase();
}

function extractMimeType(dataUrl) {
    const match = /^data:([^;]+);base64,/.exec(String(dataUrl || ''));
    return match ? match[1] : '';
}

function isValidDataUrl(value) {
    return /^data:[^;]+;base64,[A-Za-z0-9+/=\s]+$/.test(String(value || ''));
}

function toDocumentMetadata(document) {
    const payload = typeof document.toObject === 'function' ? document.toObject() : { ...document };
    delete payload.fileBase64;
    return payload;
}

async function sendInstantOwnerMail(subject, bodyText) {
    if (!transporter || !process.env.OWNER_EMAIL) return;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.OWNER_EMAIL,
            subject: `SANTOSH: ${subject}`,
            text: `SANTOSH FLYASH TRANSPORTS\nControl Room Updates\n\n${bodyText}\n\nTimestamp: ${new Date().toLocaleString()}`
        });
    } catch (err) {
        console.error('Instant mail error:', err.message);
    }
}

app.get('/api/health', async (req, res) => {
    const health = {
        status: 'ok',
        postgres: 'checking',
        mongo: 'checking',
        timestamp: new Date().toISOString()
    };

    try {
        await pool.query('SELECT 1');
        health.postgres = 'ok';
    } catch (err) {
        health.status = 'degraded';
        health.postgres = err.message;
    }

    if (mongoose.connection.readyState === 1) {
        health.mongo = 'ok';
    } else if (mongoose.connection.readyState === 2) {
        health.status = 'degraded';
        health.mongo = 'connecting';
    } else {
        health.status = 'degraded';
        health.mongo = 'not connected';
    }

    res.json(health);
});

app.post('/api/trucks/add', async (req, res) => {
    const cleanNumber = cleanTruckNumber(req.body.truck_number);

    if (!cleanNumber) {
        return res.status(400).json({ error: 'Truck number is required' });
    }

    try {
        const result = await pool.query('INSERT INTO trucks (truck_number) VALUES ($1) RETURNING *', [cleanNumber]);
        await sendInstantOwnerMail(
            'New Truck Added',
            `Vehicle ${cleanNumber} has been onboarded into active fleet operations.`
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        const error = err.code === '23505' ? 'Truck already exists' : err.message;
        res.status(400).json({ error });
    }
});

app.get('/api/trucks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trucks ORDER BY truck_number ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logs/add', async (req, res) => {
    const { truck_id, truck_num, source, destination, driver1, driver2 } = req.body;

    if (!truck_id || !source || !destination || !driver1) {
        return res.status(400).json({ error: 'Truck, source, destination, and driver are required' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO route_logs (truck_id, source, destination, driver1, driver2, log_date)
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING *`,
            [
                truck_id,
                String(source).trim(),
                String(destination).trim(),
                String(driver1).trim(),
                driver2 ? String(driver2).trim() : null
            ]
        );

        await sendInstantOwnerMail(
            'Trip Logged Entry',
            `Truck: ${truck_num || truck_id}\nRoute: ${source} to ${destination}\nCrew: ${driver1} / ${driver2 || 'None'}`
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/docs/upload', async (req, res) => {
    const truckNumber = cleanTruckNumber(req.body.truckNumber);
    const documentType = String(req.body.documentType || '').trim();
    const expiryDate = req.body.expiryDate;
    const fileBase64 = req.body.fileBase64;

    if (!truckNumber || !documentType || !expiryDate || !fileBase64) {
        return res.status(400).json({ error: 'Truck, document type, expiry date, and file are required' });
    }

    if (!isValidDataUrl(fileBase64)) {
        return res.status(400).json({ error: 'Invalid file payload' });
    }

    try {
        const newDoc = new TruckDocument({
            truckId: req.body.truckId ? String(req.body.truckId) : undefined,
            truckNumber,
            documentType,
            expiryDate,
            fileBase64,
            fileName: req.body.fileName ? String(req.body.fileName).trim() : undefined,
            mimeType: req.body.mimeType || extractMimeType(fileBase64),
            fileSize: Number(req.body.fileSize) || undefined,
            section: req.body.section || 'vehicle-documents'
        });

        await newDoc.save();
        await sendInstantOwnerMail(
            'Vehicle Document Uploaded',
            `Truck: ${truckNumber}\nType: ${documentType}\nExpiry Date: ${expiryDate}`
        );

        res.status(201).json({ message: 'Document saved successfully', document: toDocumentMetadata(newDoc) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/docs', async (req, res) => {
    const truckNumber = cleanTruckNumber(req.query.truckNumber);

    try {
        const docs = await TruckDocument.find(truckNumber ? { truckNumber } : {})
            .select('-fileBase64')
            .sort({
                expiryDate: 1,
                createdAt: -1
            });
        res.json(docs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/docs/:documentId', async (req, res) => {
    try {
        const doc = await TruckDocument.findById(req.params.documentId);

        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(doc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/trucks/history/:truckId/:truckNumber', async (req, res) => {
    const { truckId } = req.params;
    const truckNumber = cleanTruckNumber(req.params.truckNumber);

    try {
        const trips = await pool.query(
            `SELECT id, source, destination, driver1, driver2, log_date
             FROM route_logs
             WHERE truck_id = $1
             ORDER BY log_date DESC, id DESC`,
            [truckId]
        );

        const docs = await TruckDocument.find({ truckNumber })
            .select('-fileBase64')
            .sort({ expiryDate: 1, createdAt: -1 });
        res.json({ trips: trips.rows, documents: docs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

cron.schedule('0 8 * * *', async () => {
    if (!transporter || !process.env.OWNER_EMAIL || mongoose.connection.readyState !== 1) return;

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tenDaysAway = new Date(today);
        tenDaysAway.setDate(tenDaysAway.getDate() + 10);
        tenDaysAway.setHours(23, 59, 59, 999);

        const criticalDocs = await TruckDocument.find({
            expiryDate: { $gte: today, $lte: tenDaysAway },
            section: 'vehicle-documents'
        });

        for (const doc of criticalDocs) {
            const daysLeft = Math.ceil((new Date(doc.expiryDate) - today) / 86400000);
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.OWNER_EMAIL,
                subject: `DAILY EXPIRE ALERT: ${doc.truckNumber} ${doc.documentType} in ${daysLeft} days`,
                text: `SANTOSH FLYASH TRANSPORTS\n\nThe ${doc.documentType} for truck ${doc.truckNumber} expires on ${new Date(doc.expiryDate).toDateString()}.\nRemaining days: ${daysLeft}.`
            });
        }
    } catch (err) {
        console.error('Cron error:', err.message);
    }
});

connectDatabases().then(() => {
    app.listen(PORT, () => console.log(`Santosh fleet backend active on port ${PORT}`));
});
