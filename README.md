# Project Title

A google drive based store class for [whatsapp-web.js](https://www.npmjs.com/package/whatsapp-web.js)

## Background

Modelled after this: [wwebjs-mongo](https://github.com/jtouris/wwebjs-mongo).

An alternative implementation using `LocalAuth` for authentication. I had  issues with `remoteAuth' and `LocalAuth` seems more legacy.

## Implementation

```javascript
const { Client, LocalAuth } = require("whatsapp-web.js");
const GoogleDriveStore = require("./googleStore");
const { google } = require("googleapis");
const qrcode = require("qrcode-terminal");
require("dotenv").config();

let qrCodeData = null;
let clientReady = false;

// Define Google Credentials
const googleCreds =
  process.env.NODE_ENV === "development"
    ? "./credentials.json"
    : process.env.GOOGLE_APPLICATION_CREDENTIALS;

const auth = new google.auth.GoogleAuth({
  keyFile: googleCreds,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth: auth });

const parentFolderId = process.env.GOOGLE_DRIVE_WWEBJS_SESSIONS;

// Determine Client ID based on environment
let clientId;
if (process.env.NODE_ENV === "development") {
  clientId = "dev";
} else {
  clientId = "prod";
}

const options = {
  auth,
  drive,
  parentFolderId,
  clientId,
};

let sessionInitialized = false;

const driveStore = new GoogleDriveStore(options);
const client = new Client({
  authStrategy: new LocalAuth({
    clientId,
  }),
  puppeteer: {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  },
});

// Initialize the session
(async () => {
  try {
    sessionInitialized = await driveStore.initializeSession();
    if (sessionInitialized) {
      console.log(`Session Initializing...`);
    } else {
      console.log(`Getting QR Code for new session...`);
    }
    setupClientEventListeners();
  } catch (error) {
    console.error("Error initializing session:", error);
    console.log(
      `Error initializing session...getting QR Code for new session...`
    );
  } finally {
    client.initialize();
  }
})();
