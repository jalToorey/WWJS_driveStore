const fs = require("fs");
const AdmZip = require("adm-zip");
path = require("path");
const fsExtra = require("fs-extra");
class GoogleDriveStore {
  constructor(options = {}) {
    this.auth = options.auth;
    this.drive = options.drive;
    this.parentFolderId = options.parentFolderId;
    this.clientId = options.clientId;
  }

  validateOptions(options) {
    if (!options.auth) {
      throw new Error("Auth instance is required");
    }
    if (!options.drive) {
      throw new Error("Drive instance is required");
    }
    if (!options.parentFolderId) {
      throw new Error("Parent folder ID is required");
    }
    if (!options.clientId) {
      throw new Error("Client ID is required");
    }
  }

  async initializeSession() {
    const sessionName = this.clientId;
    const isDevMode = process.env.NODE_ENV === "development";
    try {
      let sessionExists = false;
      if (isDevMode && fs.existsSync(`./.wwebjs_auth/session-${sessionName}`)) {
        console.log(
          `Local session ${sessionName} found. Using local session in dev mode.`
        );
        sessionExists = true;
      } else {
        sessionExists = await this.exists({ session: sessionName });
        if (sessionExists) {
          console.log(`Session ${sessionName} found on Drive. Downloading...`);
          await this.extract({ session: sessionName });
          console.log(`Session ${sessionName} downloaded and extracted.`);
        } else {
          console.log(`Session ${sessionName} not found on Drive.`);
        }
      }

      if (sessionExists) {
        this.startAutoSave(300000, sessionName);
      }
      return sessionExists;
    } catch (error) {
      console.error("Failed to initialize session:", error);
      throw error;
    }
  }

  startAutoSave(intervalMs, sessionName) {
    const minIntervalMs = 60000; // Minimum interval set to 1 minute
    if (intervalMs < minIntervalMs) {
      console.warn(
        `Auto-save interval is too short. Setting to minimum of ${minIntervalMs} ms.`
      );
      intervalMs = minIntervalMs;
    }

    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      try {
        console.log(`Auto-saving session: ${sessionName}`);
        await this.save({ session: sessionName });
      } catch (error) {
        console.error("Error during auto-save:", error);
      }
    }, intervalMs);
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  async zipFiles(sourcePath, outputPath) {
    const zip = new AdmZip();
    zip.addLocalFolder(sourcePath);
    zip.writeZip(outputPath);
  }

  async uploadFileToDrive(filePath, parentFolderId) {
    const fileMetadata = {
      name: path.basename(filePath),
      parents: [parentFolderId],
    };
    const media = {
      mimeType: "application/zip",
      body: fs.createReadStream(filePath),
    };

    const response = await this.drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    return response.data.id;
  }

  async downloadFileFromDrive(fileId, outputPath) {
    const dest = fs.createWriteStream(outputPath);

    try {
      const res = await this.drive.files.get(
        { fileId: fileId, alt: "media" },
        { responseType: "stream" }
      );

      await new Promise((resolve, reject) => {
        res.data
          .on("end", () => {
            console.log("Done downloading file.");
            resolve();
          })
          .on("error", (err) => {
            console.error("Error downloading file:", err);
            reject(err);
          })
          .pipe(dest);
      });
    } catch (err) {
      console.error("Error during download from Drive:", err);
      throw err;
    }
  }

  async unzipFile(zipFilePath, extractPath) {
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(extractPath, true);
  }

  async copyAndZip(sourcePath, tempPath, zipPath) {
    try {
      await fsExtra.copy(sourcePath, tempPath);
      await this.zipFiles(tempPath, zipPath);
      await fsExtra.remove(tempPath);
    } catch (error) {
      console.error("Error during copy and zip:", error);
      if (error.code === "ENOTEMPTY") {
        console.error(`The directory at ${tempPath} is not empty.`);
      }
      throw error;
    }
  }

  async save({ session }) {
    const existingFileId = await this.getFileId(session);
    if (existingFileId) {
      await this.delete({ session });
    }

    // Continue with the rest of the save method...
    const sourcePath = `./.wwebjs_auth/session-${session}`;
    const tempPath = `./temp_session-${session}`;
    const zipPath = `./${session}.zip`;
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    await this.copyAndZip(sourcePath, tempPath, zipPath);
    const parentFolderId = this.parentFolderId;
    const fileId = await this.uploadFileToDrive(zipPath, parentFolderId);
    fs.unlinkSync(zipPath);

    return fileId;
  }

  async extract({ session }) {
    const fileId = await this.getFileId(session);
    const outputPath = `./${session}.zip`;
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    await this.downloadFileFromDrive(fileId, outputPath);

    const extractPath = `./.wwebjs_auth/session-${session}`;
    await this.unzipFile(outputPath, extractPath);
    fs.unlinkSync(outputPath);
  }

  async delete({ session }) {
    const fileId = await this.getFileId(session);
    await this.drive.files.delete({ fileId: fileId });
  }

  async exists({ session }) {
    try {
      const fileId = await this.getFileId(session);
      if (fileId) {
        await this.drive.files.get({ fileId: fileId });
        return true;
      }
      return false;
    } catch (error) {
      if (error.code === 404) {
        return false;
      } else {
        console.error("Error checking if file exists:", error);
        throw error;
      }
    }
  }

  async getFileId(session) {
    const fileName = `${session}.zip`;
    const parentFolderId = this.parentFolderId;
    const fileId = await this.findFileIdByName(fileName, parentFolderId);
    return fileId || null;
  }

  async findFileIdByName(fileName, parentFolderId) {
    try {
      const response = await this.drive.files.list({
        q: `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`,
        spaces: "drive",
        fields: "files(id, name)",
        pageSize: 1,
      });

      const files = response.data.files;
      if (files.length > 0) {
        return files[0].id;
      } else {
        return null;
      }
    } catch (error) {
      console.error("The API returned an error: " + error);
      throw error;
    }
  }
}

module.exports = GoogleDriveStore;
