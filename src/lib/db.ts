/**
 * WFH Tracker System - Real MongoDB Database Adapter & Connection Manager
 */

import mongoose from "mongoose";
import MachineLog from "./models/MachineLog";

export interface OsqueryLogEntry {
  name: string;           // Name of the scheduled query (e.g. running_processes)
  action: "added" | "removed" | "snapshot"; // Row operations
  columns: Record<string, string>; // The query result columns (always strings in Osquery TLS)
  timestamp: string;      // Unix timestamp of the query run
}

export interface OsqueryPayload {
  node_key: string;       // Unique key identifying the remote worker host
  log_type: "result" | "status";
  data: OsqueryLogEntry[];
}

const MONGODB_URI = process.env.MONGODB_URI;

let cached = (globalThis as any).mongoose;

if (!cached) {
  cached = (globalThis as any).mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in environment variables");
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseInstance) => {
      console.log("[MongoDB] Connected successfully to Cluster0");
      return mongooseInstance;
    }).catch(err => {
      console.error("[MongoDB] Connection error:", err);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export class DatabaseSimulator {
  /**
   * Simulates inserting logs into PostgreSQL (Relational Database Mock)
   */
  static async insertToPostgreSQL(nodeKey: string, logs: OsqueryLogEntry[]): Promise<boolean> {
    // Keep mock for relational data representation
    return true;
  }

  /**
   * Real MongoDB document store inserts
   */
  static async insertToMongoDB(nodeKey: string, logs: OsqueryLogEntry[]): Promise<boolean> {
    if (!logs || logs.length === 0) return true;

    try {
      await connectDB();

      const docs = logs.map((log) => {
        let logDate = new Date();
        if (log.timestamp) {
          const sec = parseFloat(log.timestamp);
          if (!isNaN(sec)) {
            logDate = new Date(sec * 1000);
          } else {
            const parsed = new Date(log.timestamp);
            if (!isNaN(parsed.getTime())) {
              logDate = parsed;
            }
          }
        }

        return {
          nodeKey,
          name: log.name,
          action: log.action,
          columns: log.columns,
          timestamp: logDate,
          archived: false,
        };
      });

      // Bulk write/insert documents
      await MachineLog.insertMany(docs, { ordered: false });
      console.log(`[DB - MongoDB] Successfully saved ${logs.length} logs for node: ${nodeKey}`);
      return true;
    } catch (error) {
      console.error(`[DB - MongoDB Error] Failed to write logs:`, error);
      return false;
    }
  }

  /**
   * Orchestrates dual/selected database inserts
   */
  static async persistLogs(payload: OsqueryPayload): Promise<{ pgSuccess: boolean; mongoSuccess: boolean }> {
    const { node_key, data } = payload;
    
    if (!data || data.length === 0) {
      return { pgSuccess: true, mongoSuccess: true };
    }

    // Run parallel inserts to emulate production setups
    const [pgSuccess, mongoSuccess] = await Promise.all([
      this.insertToPostgreSQL(node_key, data),
      this.insertToMongoDB(node_key, data),
    ]);

    return { pgSuccess, mongoSuccess };
  }
}
export default connectDB;
