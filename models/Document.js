const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
    {
        truckId: { type: String },
        truckNumber: { type: String, required: true, index: true },
        documentType: { type: String, required: true },
        expiryDate: { type: Date, required: true, index: true },
        fileBase64: { type: String, required: true },
        fileName: { type: String },
        mimeType: { type: String },
        fileSize: { type: Number },
        section: { type: String, default: 'vehicle-documents', index: true },
        notificationSent: { type: Boolean, default: false }
    },
    { timestamps: true }
);

DocumentSchema.index({ truckNumber: 1, section: 1, expiryDate: 1 });

module.exports = mongoose.models.TruckDocument || mongoose.model('TruckDocument', DocumentSchema);
