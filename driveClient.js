const { Client, LocalAuth } = require("whatsapp-web.js");
const GoogleDriveStore = require("./googleStore");
const { google } = require("googleapis");
const qrcode = require("qrcode-terminal");
require("dotenv").config();

let qrCodeData = null;
let clientReady = false;

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

function setupClientEventListeners() {
  client.on("qr", (qr) => {
    qrCodeData = qr;
    console.log("QR Code:", qr);
    qrcode.generate(qr, { small: true });
  });

  client.on("remote_session_saved", () => {
    console.log("Session saved");
  });

  client.on("ready", () => {
    console.log("Client is ready!");
    clientReady = true;
  });

  client.on("auth_failure", (msg) => {
    console.error("AUTHENTICATION FAILURE", msg);
  });

  client.on("authenticated", async (session) => {
    console.log("AUTHENTICATED");

    if (!sessionInitialized) {
      console.log("Saving session to Google Drive...");
      setTimeout(async () => {
        try {
          const sessionName = clientId;
          const fileId = await driveStore.save({ session: sessionName });
          console.log(
            `Session data saved to Google Drive with File ID: ${fileId}`
          );
        } catch (error) {
          console.error("Failed to save session to Google Drive:", error);
        }
      }, 120000);
    }
  });
}
function getQrCode() {
  return qrCodeData;
}

function clientIsReady() {
  return clientReady;
}
module.exports = {
  client,
  driveStore,
  setupClientEventListeners,
  getQrCode,
  clientIsReady,
};
