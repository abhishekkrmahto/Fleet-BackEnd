const cron = require('node-cron');
const nodemailer = require('nodemailer');
const TruckDocument = require('../models/Document');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Har din subah 8 baje automatic chalega
cron.schedule('0 8 * * *', async () => {
    console.log('Checking for expiring documents...');
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 10);
    targetDate.setHours(0,0,0,0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 10); // Match specific window

    try {
        const expiringDocs = await TruckDocument.find({
            expiryDate: { $gte: targetDate, $lt: nextDay },
            notificationSent: false
        });

        for (let doc of expiringDocs) {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.OWNER_EMAIL,
                subject: `⚠️ ALERT: Document Expiring for Truck ${doc.truckNumber}`,
                text: `Dear Owner,\n\nThe ${doc.documentType} for Truck No: ${doc.truckNumber} is expiring on ${doc.expiryDate.toDateString()} (In exactly 10 Days).\n\nPlease action renewal.\n\nSANTOSH FLYASH TRANSPORTS`
            };

            await transporter.sendMail(mailOptions);
            doc.notificationSent = true;
            await doc.save();
            console.log(`Notification sent for ${doc.truckNumber}`);
        }
    } catch (err) {
        console.error('Cron error:', err);
    }
});