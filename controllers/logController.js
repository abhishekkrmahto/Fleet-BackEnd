const { pool } = require('../config/db');

// Add Daily Entry
const addLog = async (req, res) => {
    const { truck_number, source, destination, driver1, driver2 } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO route_logs (truck_number, source, destination, driver1, driver2, log_date) 
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING *`,
            [truck_number, source, destination, driver1, driver2]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Filter Logs by Truck or Date
const getFilteredLogs = async (req, res) => {
    const { truck_number, date } = req.query;
    let query = `SELECT * FROM route_logs WHERE 1=1`;
    let params = [];
    let counter = 1;

    if (truck_number) {
        query += ` AND truck_number = $${counter}`;
        params.push(truck_number);
        counter++;
    }
    if (date) {
        query += ` AND log_date = $${counter}`;
        params.push(date);
    }

    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { addLog, getFilteredLogs };