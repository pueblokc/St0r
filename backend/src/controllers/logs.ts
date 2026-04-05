import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const isWindows = process.platform === 'win32';
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

// Parse journalctl log level from priority
function getPriorityLevel(priority: string): string {
  const p = parseInt(priority);
  if (p <= 3) return 'error';
  if (p === 4) return 'warning';
  if (p === 6) return 'info';
  return 'debug';
}

// Parse ANSI color codes to determine log level
function parseLogLevel(message: string): string {
  if (message.includes('[31m') || message.includes('error')) return 'error';
  if (message.includes('[33m') || message.includes('warn')) return 'warning';
  if (message.includes('[32m') || message.includes('info')) return 'info';
  return 'debug';
}

// Strip ANSI color codes from message
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(raw as string);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Resolve the log file path for the GUI service on Windows.
 * Checks env LOG_FILE, then falls back to a logs/ directory relative to app root.
 */
function getWindowsLogPath(): string {
  if (process.env.LOG_FILE) return process.env.LOG_FILE;
  // Default: logs/app.log relative to the project root (two dirs up from controllers/)
  return path.resolve(__dirname, '..', '..', 'logs', 'app.log');
}

/**
 * Read the last N lines from a file (cross-platform, no shell).
 * Returns lines in original order (oldest first).
 */
async function readLastLines(filePath: string, count: number): Promise<string[]> {
  try {
    if (!existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-count);
  } catch {
    return [];
  }
}

/**
 * Parse plain text log lines into LogEntry objects.
 * Handles common formats: "[YYYY-MM-DD HH:MM:SS] [level] message" or "YYYY-MM-DD HH:MM:SS level: message"
 */
function parseTextLogLines(lines: string[]): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const raw of lines) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;

    // Try ISO timestamp at start: "2025-11-17 19:27:49 ..." or "[2025-11-17T19:27:49.000Z]"
    const tsMatch = line.match(/^[\["]?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?)[\]"]?\s*/);
    const time = tsMatch ? new Date(tsMatch[1]).toISOString() : new Date().toISOString();
    const rest = tsMatch ? line.slice(tsMatch[0].length) : line;

    const level = parseLogLevel(rest);
    logs.push({ time, level, message: rest });
  }
  return logs;
}

/** Read logs via journalctl (Linux) */
async function readJournalctlLogs(limit: number): Promise<LogEntry[]> {
  const { stdout } = await execFileAsync('journalctl', [
    '-u', 'urbackup-gui.service',
    '-n', String(limit),
    '--no-pager',
    '-o', 'json',
  ]);

  const logs: LogEntry[] = [];
  const lines = stdout.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      let message = '';
      if (Array.isArray(entry.MESSAGE)) {
        message = String.fromCharCode(...entry.MESSAGE);
      } else if (typeof entry.MESSAGE === 'string') {
        message = entry.MESSAGE;
      } else {
        continue;
      }

      message = stripAnsi(message);

      const timestamp = entry.__REALTIME_TIMESTAMP
        ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString()
        : new Date().toISOString();

      const level = entry.PRIORITY
        ? getPriorityLevel(entry.PRIORITY)
        : parseLogLevel(message);

      logs.push({
        time: timestamp,
        level,
        message: message.trim()
      });
    } catch (err) {
      continue;
    }
  }

  return logs;
}

export async function getLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit, 200, 1000);

    let logs: LogEntry[];

    if (isWindows) {
      // Windows: read from log file
      const logPath = getWindowsLogPath();
      const lines = await readLastLines(logPath, limit);
      logs = parseTextLogLines(lines);
    } else {
      // Linux: use journalctl
      logs = await readJournalctlLogs(limit);
    }

    // Reverse to show newest first
    logs.reverse();

    res.json(logs);
  } catch (error: any) {
    logger.error('Failed to get logs:', error);
    res.status(500).json({
      error: 'Failed to get logs',
      message: 'An internal error occurred'
    });
  }
}

export async function getLiveLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit, 50, 1000);

    let logs: LogEntry[];

    if (isWindows) {
      const logPath = getWindowsLogPath();
      const lines = await readLastLines(logPath, limit);
      logs = parseTextLogLines(lines);
    } else {
      logs = await readJournalctlLogs(limit);
    }

    logs.reverse();

    res.json(logs);
  } catch (error: any) {
    logger.error('Failed to get live logs:', error);
    res.status(500).json({
      error: 'Failed to get live logs',
      message: 'An internal error occurred'
    });
  }
}
