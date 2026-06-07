/**
 * WFH Tracker System - Core Security & Configuration Properties
 */

export const CONFIG = {
  // Node enrollment settings
  ENROLL_SECRET: process.env.OSQUERY_ENROLL_SECRET || "SecureEnrollmentSecret2026!",
  
  // Custom header to bypass standard authentication proxies (optional)
  NODE_KEY_HEADER: "x-osquery-node-key",

  // Local storage prefix/in-memory keys (for development environment)
  MOCK_NODE_KEY_PREFIX: "node_key_host_",
};
