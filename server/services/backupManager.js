const fs = require('fs');
const path = require('path');

const generateBackup = async (pool, dbName, outputDir, onProgress) => {
  const backupPath = path.join(outputDir, `${dbName}.bak`);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Remove existing backup if it exists
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }

  try {
    const request = pool.request();
    
    // Capture messages for progress tracking
    request.on('info', (message) => {
      if (onProgress && message.message) {
        onProgress(message.message);
      }
    });

    const query = `
      BACKUP DATABASE [${dbName}]
      TO DISK = N'${backupPath}'
      WITH INIT, CHECKSUM, COMPRESSION, STATS = 10
    `;
    
    await request.query(query);
    return backupPath;
  } catch (err) {
    console.error(`Error generating backup for ${dbName}`, err);
    throw err;
  }
};

const verifyBackup = async (pool, backupPath) => {
  try {
    const query = `
      RESTORE VERIFYONLY FROM DISK = N'${backupPath}' WITH CHECKSUM
    `;
    await pool.request().query(query);
    return { verified: true, message: 'Backup verified successfully' };
  } catch (err) {
    console.error(`Error verifying backup ${backupPath}`, err);
    return { verified: false, message: err.message };
  }
};

const getBackupMetadata = (backupPath) => {
  try {
    const stats = fs.statSync(backupPath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime
    };
  } catch (err) {
    console.error(`Error getting metadata for ${backupPath}`, err);
    return null;
  }
};

const cleanupBackup = (backupPath) => {
  try {
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
      return true;
    }
  } catch (err) {
    console.error(`Error cleaning up backup ${backupPath}`, err);
  }
  return false;
};

module.exports = {
  generateBackup,
  verifyBackup,
  getBackupMetadata,
  cleanupBackup
};
