import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';

try {
  console.log("Creating DB...");
  const db = new Database(':memory:');
  console.log("Loading sqlite-vec...");
  sqliteVec.load(db);
  console.log("Loaded successfully!");
} catch (err) {
  console.error("Failed to load sqlite-vec:", err);
}
