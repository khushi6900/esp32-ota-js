/**
 * OTA Cloud Server for ESP32 Firmware Updates (Node.js/Express)
 * Vercel Serverless Function
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ========================================
// CONFIGURATION
// ========================================

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
    mandatory: false
  }
};

// Security - Simple API Key
const VALID_API_KEYS = new Set(["test123", "prod456"]);

// Firmware directory
const FIRMWARE_DIR = path.join(__dirname, '../firmware');

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

function calculateMd5(filepath) {
  const fileBuffer = fs.readFileSync(filepath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function getFileSize(filepath) {
  const stats = fs.statSync(filepath);
  return stats.size;
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

app.get('/api/v1/firmware/check', verifyApiKey, (req, res) => {
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
  
  // Prepare firmware file path
  const firmwarePath = path.join(FIRMWARE_DIR, latestInfo.filename);
  
  // Check if file exists
  if (!fs.existsSync(firmwarePath)) {
    console.log(`ERROR: Firmware file not found: ${firmwarePath}`);
    console.log('===================\n');
    return res.status(404).json({ detail: "Firmware file not found" });
  }
  
  // Calculate checksum and file size
  const checksum = calculateMd5(firmwarePath);
  const fileSize = getFileSize(firmwarePath);
  
  // Generate download URL
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const downloadUrl = `${protocol}://${host}/api/v1/firmware/download/${latestVersion}`;
  
  console.log('Update AVAILABLE for device!');
  console.log(`Latest version: v${latestVersion}`);
  console.log(`Download URL: ${downloadUrl}`);
  console.log(`File size: ${fileSize} bytes`);
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
    file_size: fileSize
  });
});

app.get('/api/v1/firmware/download/:version', verifyApiKey, (req, res) => {
  const { version } = req.params;
  
  console.log('\n=== FIRMWARE DOWNLOAD ===');
  console.log(`Version requested: v${version}`);
  console.log(`API Key: ${req.apiKey.substring(0, 4)}...`);
  
  if (!AVAILABLE_FIRMWARE[version]) {
    console.log(`ERROR: Version ${version} not found`);
    return res.status(404).json({ detail: "Firmware version not found" });
  }
  
  const firmwareInfo = AVAILABLE_FIRMWARE[version];
  const firmwarePath = path.join(FIRMWARE_DIR, firmwareInfo.filename);
  
  if (!fs.existsSync(firmwarePath)) {
    console.log(`ERROR: File not found: ${firmwarePath}`);
    return res.status(404).json({ detail: "Firmware file not found" });
  }
  
  console.log(`Serving file: ${firmwareInfo.filename}`);
  console.log(`File size: ${getFileSize(firmwarePath)} bytes`);
  console.log('===================\n');
  
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${firmwareInfo.filename}"`);
  res.sendFile(firmwarePath);
});

app.get('/admin/devices', verifyApiKey, (req, res) => {
  res.json({
    total_devices: Object.keys(devicesDb).length,
    devices: devicesDb
  });
});

app.post('/admin/firmware/release', verifyApiKey, (req, res) => {
  const { version, filename, changelog, mandatory = false } = req.body;
  
  if (!version || !filename || !changelog) {
    return res.status(400).json({ detail: "Missing required fields" });
  }
  
  if (AVAILABLE_FIRMWARE[version]) {
    return res.status(400).json({ detail: "Version already exists" });
  }
  
  const firmwarePath = path.join(FIRMWARE_DIR, filename);
  if (!fs.existsSync(firmwarePath)) {
    return res.status(404).json({ detail: "Firmware file not found" });
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
    version
  });
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
