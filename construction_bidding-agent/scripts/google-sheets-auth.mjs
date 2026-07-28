import fs from "node:fs";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || "config/service-account.json";
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Missing service account key at ${keyFile}. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or place the key there, and share the target Sheet with the service account's client_email.`
    );
  }
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}
