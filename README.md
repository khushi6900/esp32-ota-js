# ESP32 OTA Update Server (Node.js)

OTA (Over-The-Air) firmware update server for ESP32 devices built with Express.js and deployable on Vercel.

## Features

- Firmware version checking
- Secure firmware downloads with API key authentication
- MD5 checksum verification
- Device tracking and management
- Admin endpoints for firmware releases

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Run the server:
```bash
npm start
```

Server will start at `http://localhost:3000`

## Deploy to Vercel

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
vercel
```

3. Follow the prompts to deploy your project

## API Endpoints

### Public Endpoints
- `GET /` - Server information
- `GET /health` - Health check

### OTA Endpoints (Requires Bearer Token)
- `GET /api/v1/firmware/check?device=ESP32_ABC&version=1.0.0` - Check for updates
- `GET /api/v1/firmware/download/:version` - Download firmware binary

### Admin Endpoints (Requires Bearer Token)
- `GET /admin/devices` - List all registered devices
- `POST /admin/firmware/release` - Release new firmware version

## Authentication

All OTA and admin endpoints require Bearer token authentication:

```
Authorization: Bearer test123
```

Valid API keys are configured in `index.js`:
```javascript
const VALID_API_KEYS = new Set(["test123", "prod456"]);
```

## Firmware Configuration

Edit the `AVAILABLE_FIRMWARE` object in `index.js` to add firmware versions:

```javascript
const AVAILABLE_FIRMWARE = {
  "2.2.0": {
    filename: "meril_01.ino.esp32_v2_2.bin",
    release_date: "2026-01-15",
    changelog: "Initial release",
    mandatory: false
  }
};
```

## ESP32 Integration

Example ESP32 code to check for updates:

```cpp
HTTPClient http;
http.begin("https://your-vercel-app.vercel.app/api/v1/firmware/check?device=ESP32_001&version=1.0.0");
http.addHeader("Authorization", "Bearer test123");
int httpCode = http.GET();
```

## Environment Variables (Optional)

You can set these in Vercel dashboard:
- `PORT` - Server port (default: 3000)
- Add your API keys as environment variables for better security

## File Structure

```
js-ota-server/
├── index.js          # Main server file
├── package.json      # Dependencies
├── vercel.json       # Vercel configuration
├── README.md         # Documentation
└── ../firmware/      # Firmware binaries directory
```
