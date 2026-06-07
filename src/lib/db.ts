/**
 * WFH Tracker System - Database Adaptation & Simulation Layer
 */

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

export class DatabaseSimulator {
  /**
   * Simulates inserting logs into PostgreSQL (Relational Database)
   * Using batch execution to handle high-concurrency (500+ endpoints)
   */
  static async insertToPostgreSQL(nodeKey: string, logs: OsqueryLogEntry[]): Promise<boolean> {
    // In production: Use a connection pool (e.g., pg-pool) and execute a bulk INSERT query
    // e.g., INSERT INTO host_query_results (node_key, query_name, action, columns, logged_at) VALUES ...
    
    // Simulate latency (e.g., 5-15ms database roundtrip)
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 10) + 5));

    console.log(`[DB SIMULATOR - PostgreSQL] Batch inserting ${logs.length} logs for node: ${nodeKey}`);
    
    // Log details of first log row for transparency in logs
    if (logs.length > 0) {
      const first = logs[0];
      console.log(
        `[PostgreSQL Query Mock] INSERT INTO host_logs (node_key, query, action, data) VALUES ('${nodeKey}', '${first.name}', '${first.action}', '${JSON.stringify(first.columns)}')`
      );
    }
    return true;
  }

  /**
   * Simulates inserting logs into MongoDB (NoSQL Document Store)
   * Using fast bulkWrite operations
   */
  static async insertToMongoDB(nodeKey: string, logs: OsqueryLogEntry[]): Promise<boolean> {
    // In production: Use mongoose or mongodb driver and invoke bulkWrite()
    // e.g., db.collection('host_logs').bulkWrite(logs.map(log => ({ insertOne: { document: { ...log, nodeKey } } })))

    // Simulate latency (e.g., 3-10ms write time)
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 7) + 3));

    console.log(`[DB SIMULATOR - MongoDB] Bulk writing ${logs.length} documents for node: ${nodeKey}`);
    
    if (logs.length > 0) {
      console.log(
        `[MongoDB Write Mock] db.host_logs.insertMany([ ${logs.map(l => `{ node_key: "${nodeKey}", query: "${l.name}", action: "${l.action}" }`).slice(0, 1).join(", ")}... ])`
      );
    }
    return true;
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
