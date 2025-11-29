-- OpalForge Certificate Database Schema
-- Run this in Cloudflare D1 to create the required table

-- Drop existing table if you need to reset (be careful in production!)
-- DROP TABLE IF EXISTS certificates;

-- Create certificates table
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cert_id TEXT UNIQUE NOT NULL,
    confidence REAL NOT NULL,
    timestamp TEXT NOT NULL,
    qr_payload TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Create index for fast lookups by cert_id
CREATE INDEX IF NOT EXISTS idx_cert_id ON certificates(cert_id);

-- Create index for status queries (e.g., finding all active certs)
CREATE INDEX IF NOT EXISTS idx_status ON certificates(status);

-- Create index for timestamp queries (e.g., certificates issued today)
CREATE INDEX IF NOT EXISTS idx_timestamp ON certificates(timestamp);
