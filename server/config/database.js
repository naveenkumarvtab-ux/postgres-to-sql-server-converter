// Use the cross-platform Tedious driver bundled with `mssql`. The previous
// msnodesqlv8 driver only works on Windows and prevents the Render (Linux)
// service from installing at all.
const sql = require('mssql');

let pool = null;

const defaultConfig = {
  server: 'localhost',
  database: 'master',
  options: {
    trustedConnection: true,
    trustServerCertificate: true
  }
};

const buildConnectionConfig = (config) => {
  if (!config.user || !config.password) {
    throw new Error('SQL Server username and password are required. Windows integrated authentication is available only in the local Windows desktop deployment.');
  }

  return {
    server: config.server || 'localhost',
    database: config.database || 'master',
    user: config.user,
    password: config.password,
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: true
    }
  };
};

const getPool = async (customConfig = null) => {
  if (pool) return pool;
  
  const baseConfig = customConfig || defaultConfig;
  const config = buildConnectionConfig(baseConfig);
  
  try {
    pool = await sql.connect(config);
    return pool;
  } catch (err) {
    console.error('Database connection failed', err);
    throw err;
  }
};

const testConnection = async (customConfig) => {
  let tempPool = null;
  try {
    const baseConfig = customConfig || defaultConfig;
    const config = buildConnectionConfig(baseConfig);
    tempPool = await sql.connect(config);
    const result = await getServerInfo(tempPool);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (tempPool && !pool) {
      await tempPool.close();
    }
  }
};

const closePool = async () => {
  if (pool) {
    await pool.close();
    pool = null;
  }
};

const getServerInfo = async (connectionPool) => {
  try {
    const request = connectionPool.request();
    const result = await request.query(`
      SELECT 
        @@VERSION as version,
        SERVERPROPERTY('Edition') as edition,
        SERVERPROPERTY('ProductVersion') as productVersion
    `);
    
    if (result.recordset && result.recordset.length > 0) {
      const info = result.recordset[0];
      return {
        serverVersion: info.version,
        edition: info.edition,
        productVersion: info.productVersion
      };
    }
    return null;
  } catch (err) {
    console.error('Error getting server info', err);
    throw err;
  }
};

module.exports = {
  getPool,
  testConnection,
  closePool,
  getServerInfo
};
