const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
    truckId: { type: String, required: true },
    truckNumber: { type: String, required: true },
    documentType: { type: String, required: true }, // e.g., Insurance, Permit
    expiryDate: { type: Date, required: true },
    fileBase64: { type: String, required: true },   // Document File Store
    notificationSent: { type: Boolean, default: false }
});

module.exports = mongoose.model('TruckDocument', DocumentSchema);