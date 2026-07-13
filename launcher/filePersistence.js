const fs = require("fs");
const path = require("path");

// Firebase Auth's JS SDK has no built-in persistence for a plain Node/Electron
// main-process environment (that's normally the job of browser localStorage).
// This implements the same small interface the SDK accepts for custom
// persistence (as used for React Native's AsyncStorage adapter) backed by a
// JSON file, so a logged-in session survives closing and reopening the launcher.
function createFilePersistence(filePath) {
  function readAll() {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return {};
    }
  }

  function writeAll(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  }

  return {
    type: "LOCAL",
    async _isAvailable() {
      return true;
    },
    async _set(key, value) {
      const data = readAll();
      data[key] = value;
      writeAll(data);
    },
    async _get(key) {
      const data = readAll();
      return key in data ? data[key] : null;
    },
    async _remove(key) {
      const data = readAll();
      delete data[key];
      writeAll(data);
    },
    _addListener() {},
    _removeListener() {},
  };
}

module.exports = { createFilePersistence };
