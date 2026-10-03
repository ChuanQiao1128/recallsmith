"use strict";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

function logDebug(...args) {
  if (LOG_LEVEL === "debug") console.log(...args);
}
function logInfo(...args) {
  if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") console.log(...args);
}
function logWarn(...args) {
  console.warn(...args);
}
function logError(...args) {
  console.error(...args);
}

module.exports = { LOG_LEVEL, logDebug, logInfo, logWarn, logError };
