require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { closePool } = require('./config/database');

const connectionRoutes = require('./routes/connection');
const deployRoutes = require('./routes/deploy');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Create exports directory on startup
const EXPORTS_DIR = 'C:\\MigrationToSQL\\exports';
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  console.log(`Created exports directory at ${EXPORTS_DIR}`);
}

app.use('/api/connection', connectionRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/backup', backupRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await closePool();
      console.log('SQL connection pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error closing SQL connection pool', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
