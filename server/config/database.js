const sql = require('mssql/msnodesqlv8');

let pool = null;

const defaultConfig = {
  server: 'localhost',
  database: 'master',
  options: {
    trustedConnection: true,
    trustServerCertificate: true
  }
};

const buildConnectionString = (config) => {
  const server = config.server || 'localhost';
  const database = config.database || 'master';
  const isTrusted = config.options?.trustedConnection !== false && !config.user;
  
  let connStr = `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};TrustServerCertificate=yes;`;
  if (isTrusted) {
    connStr += 'Trusted_Connection=yes;';
  } else {
    connStr += `Uid=${config.user};Pwd=${config.password};`;
  }
  return connStr;
};

const getPool = async (customConfig = null) => {
  if (pool) return pool;
  
  const baseConfig = customConfig || defaultConfig;
  const config = {
    connectionString: buildConnectionString(baseConfig)
  };
  
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
    const config = {
      connectionString: buildConnectionString(baseConfig)
    };
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
