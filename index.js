/**
 * OTA Cloud Server for ESP32 Firmware Updates (Node.js/Express)
 * Vercel Serverless Function
 */

const express = require('express');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(express.json());

// ========================================
// CONFIGURATION
// ========================================

// S3 Public Bucket Configuration
const S3_BUCKET = 'esp32--firmware';
const S3_REGION = 'us-east-1';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

// Store registered devices and their versions (in-memory)
const devicesDb = {};

// Firmware versions available
const AVAILABLE_FIRMWARE = {
  "2.2.0": {
    filename: "meril_01.ino.esp32_v2_2.bin",
    release_date: "2026-01-15",
    changelog: "Initial release",
    mandatory: false
  },
  "2.3.0": {
    filename: "sketch_feb14a_v2_3.ino.bin",
    release_date: "2026-02-14",
    changelog: "Updated version",
    mandatory: true
  },
  "3.1.0": {
    filename: "sketch_feb16_3_1.ino.esp32.bin",
    release_date: "2026-02-16",
    changelog: "New features and improvements",
    mandatory: false
  }
};

// Security - Simple API Key
const VALID_API_KEYS = new Set(["test123", "prod456"]);

// ========================================
// MIDDLEWARE
// ========================================

// API Key verification middleware
const verifyApiKey = (req, res, next) => {
  const authorization = req.headers.authorization;
  
  if (!authorization) {
    return res.status(401).json({ detail: "No authorization header" });
  }
  
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({ detail: "Invalid authorization format" });
  }
  
  const apiKey = parts[1];
  if (!VALID_API_KEYS.has(apiKey)) {
    return res.status(403).json({ detail: "Invalid API key" });
  }
  
  req.apiKey = apiKey;
  next();
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Get S3 public URL
function getS3Url(filename) {
  return `${S3_BASE_URL}/${filename}`;
}

// Check if S3 file exists and get metadata
async function checkS3File(filename) {
  return new Promise((resolve) => {
    const url = getS3Url(filename);
    
    https.get(url, { method: 'HEAD' }, (res) => {
      if (res.statusCode === 200) {
        resolve({
          exists: true,
          size: parseInt(res.headers['content-length'] || '0'),
          etag: res.headers['etag']?.replace(/"/g, '')
        });
      } else {
        resolve({ exists: false });
      }
    }).on('error', () => {
      resolve({ exists: false });
    });
  });
}

// Calculate MD5 from S3 file
async function calculateS3Md5(filename) {
  return new Promise((resolve, reject) => {
    const url = getS3Url(filename);
    
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch file: ${res.statusCode}`));
        return;
      }
      
      const hash = crypto.createHash('md5');
      res.on('data', (chunk) => hash.update(chunk));
      res.on('end', () => resolve(hash.digest('hex')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ========================================
// API ENDPOINTS
// ========================================

app.get('/', (req, res) => {
  res.json({
    server: "ESP32 OTA Cloud Server (Node.js)",
    status: "running",
    firmware_versions: Object.keys(AVAILABLE_FIRMWARE),
    endpoints: [
      "/api/v1/firmware/check",
      "/api/v1/firmware/download/:version",
      "/admin/devices",
      "/health"
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/firmware/check', verifyApiKey, async (req, res) => {
  const { device, version, model = "ESP32", rssi } = req.query;
  
  if (!device || !version) {
    return res.status(400).json({ detail: "Missing device or version parameter" });
  }
  
  console.log('\n=== OTA CHECK ===');
  console.log(`Device: ${device}`);
  console.log(`Current version: ${version}`);
  console.log(`API Key: ${req.apiKey.substring(0, 4)}...`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  // Store device info
  devicesDb[device] = {
    last_check: new Date().toISOString(),
    current_version: version,
    rssi: rssi ? parseInt(rssi) : null
  };
  
  // Get latest version
  const versions = Object.keys(AVAILABLE_FIRMWARE).sort();
  const latestVersion = versions[versions.length - 1];
  const latestInfo = AVAILABLE_FIRMWARE[latestVersion];
  
  // Compare versions
  const needsUpdate = version < latestVersion;
  
  if (!needsUpdate) {
    console.log(`Device is up to date (v${version})`);
    console.log('===================\n');
    return res.json({
      update_available: false,
      latest_version: latestVersion,
      download_url: "",
      checksum: "",
      mandatory: false
    });
  }
  
  try {
    // Check if file exists in S3
    const metadata = await checkS3File(latestInfo.filename);
    
    if (!metadata.exists) {
      console.log(`ERROR: Firmware file not found in S3: ${latestInfo.filename}`);
      console.log('===================\n');
      return res.status(404).json({ detail: "Firmware file not found" });
    }
    
    // Calculate checksum
    const checksum = await calculateS3Md5(latestInfo.filename);
    
    // Generate direct S3 URL
    const downloadUrl = getS3Url(latestInfo.filename);
    
    console.log('Update AVAILABLE for device!');
    console.log(`Latest version: v${latestVersion}`);
    console.log(`Download URL: ${downloadUrl}`);
    console.log(`File size: ${metadata.size} bytes`);
    console.log(`MD5: ${checksum}`);
    console.log(`Mandatory: ${latestInfo.mandatory}`);
    console.log('===================\n');
    
    res.json({
      update_available: true,
      latest_version: latestVersion,
      download_url: downloadUrl,
      checksum: checksum,
      mandatory: latestInfo.mandatory,
      changelog: latestInfo.changelog,
      file_size: metadata.size
    });
  } catch (error) {
    console.error('Error processing firmware check:', error);
    return res.status(500).json({ detail: "Internal server error" });
  }
});

app.get('/api/v1/firmware/download/:version', verifyApiKey, async (req, res) => {
  const { version } = req.params;
  
  console.log('\n=== FIRMWARE DOWNLOAD ===');
  console.log(`Version requested: v${version}`);
  console.log(`API Key: ${req.apiKey.substring(0, 4)}...`);
  
  if (!AVAILABLE_FIRMWARE[version]) {
    console.log(`ERROR: Version ${version} not found`);
    return res.status(404).json({ detail: "Firmware version not found" });
  }
  
  const firmwareInfo = AVAILABLE_FIRMWARE[version];
  
  try {
    // Check if file exists in S3
    const metadata = await checkS3File(firmwareInfo.filename);
    
    if (!metadata.exists) {
      console.log(`ERROR: File not found in S3: ${firmwareInfo.filename}`);
      return res.status(404).json({ detail: "Firmware file not found" });
    }
    
    // Get direct S3 URL and redirect
    const downloadUrl = getS3Url(firmwareInfo.filename);
    
    console.log(`Redirecting to S3: ${firmwareInfo.filename}`);
    console.log(`File size: ${metadata.size} bytes`);
    console.log('===================\n');
    
    // Redirect to S3 public URL
    res.redirect(downloadUrl);
  } catch (error) {
    console.error('Error generating download URL:', error);
    return res.status(500).json({ detail: "Internal server error" });
  }
});

app.get('/admin/devices', verifyApiKey, (req, res) => {
  res.json({
    total_devices: Object.keys(devicesDb).length,
    devices: devicesDb
  });
});

app.post('/admin/firmware/release', verifyApiKey, async (req, res) => {
  const { version, filename, changelog, mandatory = false } = req.body;
  
  if (!version || !filename || !changelog) {
    return res.status(400).json({ detail: "Missing required fields" });
  }
  
  if (AVAILABLE_FIRMWARE[version]) {
    return res.status(400).json({ detail: "Version already exists" });
  }
  
  try {
    // Check if file exists in S3
    const metadata = await checkS3File(filename);
    
    if (!metadata.exists) {
      return res.status(404).json({ detail: "Firmware file not found in S3" });
    }
    
    AVAILABLE_FIRMWARE[version] = {
      filename,
      release_date: new Date().toISOString().split('T')[0],
      changelog,
      mandatory
    };
    
    res.json({
      status: "success",
      message: `Firmware v${version} released`,
      version,
      file_size: metadata.size
    });
  } catch (error) {
    console.error('Error releasing firmware:', error);
    return res.status(500).json({ detail: "Internal server error" });
  }
});

// ========================================
// EXPORT FOR VERCEL
// ========================================

module.exports = app;

// Local development server
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('ESP32 OTA Cloud Server Starting...');
    console.log('='.repeat(50));
    console.log('\nAvailable endpoints:');
    console.log('  • GET  /                    - Server info');
    console.log('  • GET  /health              - Health check');
    console.log('  • GET  /api/v1/firmware/check - OTA version check');
    console.log('  • GET  /api/v1/firmware/download/:version - Download firmware');
    console.log('  • GET  /admin/devices       - List devices (auth)');
    console.log('  • POST /admin/firmware/release - Release new firmware (auth)');
    console.log(`\nServer running at: http://localhost:${PORT}`);
    console.log('='.repeat(50) + '\n');
  });
}
