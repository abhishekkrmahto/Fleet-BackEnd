const { Pool } = require('pg');
const mongoose = require('mongoose');
require('dotenv').config();

// PostgreSQL Configuration
const pool = new Pool({
    connectionString: process.env.PG_URI
});

// MongoDB Configuration
const connectMongo = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🍃 MongoDB Connected...');
    } catch (err) {
        console.error('Mongo Connection Error:', err.message);
    }
};

module.exports = { pool, connectMongo };