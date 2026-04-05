import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import { logger } from '../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const isWindows = process.platform === 'win32';
const execFileAsync = promisify(execFile);
const dbService = new UrBackupDbService();

/**
 * Get disk space for a given path (cross-platform)
 */
async function getDiskSpace(targetPath: string): Promise<{ total: number; used: number; available: number }> {
  if (isWindows) {
    // Extract drive letter from path (e.g., "C" from "C:\backups")
    const driveLetter = path.parse(targetPath).root.replace(/[:\\\/]/g, '') || 'C';
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `Get-PSDrive ${driveLetter} | Select-Object Used, Free | ConvertTo-Json -Compress`
      ]);
      const info = JSON.parse(stdout.trim());
      const used = info.Used || 0;
      const available = info.Free || 0;
      const total = used + available;
      return { total, used, available };
    } catch (err) {
      logger.error(`Failed to get disk space for drive ${driveLetter}:`, err);
      return { total: 0, used: 0, available: 0 };
    }
  } else {
    const { stdout: dfOut } = await execFileAsync('df', ['-B1', targetPath]);
    const dfLines = dfOut.trim().split('\n');
    const dfParts = dfLines[dfLines.length - 1].split(/\s+/);
    const total = parseInt(dfParts[1]) || 0;
    const used = parseInt(dfParts[2]) || 0;
    const available = parseInt(dfParts[3]) || 0;
    return { total, used, available };
  }
}

/**
 * Get storage information from the local UrBackup server
 */
export async function getTotalStorage(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Get UrBackup backup path from settings DB (env override still supported)
    const backupPath = process.env.URBACKUP_BACKUP_PATH || await dbService.getBackupFolder();

    const { total: totalSize, used: usedSize, available: availableSize } = await getDiskSpace(backupPath);

    // Get storage used by clients from database
    const stats = await dbService.getServerStats();
    const fileBytes = stats.total_file_bytes || 0;
    const imageBytes = stats.total_image_bytes || 0;
    const totalUsedByBackups = fileBytes + imageBytes;

    logger.info(`Storage: ${usedSize} bytes used, ${availableSize} bytes available on ${backupPath}`);

    res.json({
      used: usedSize,
      available: availableSize,
      total: totalSize,
      backupPath: backupPath,
      fileBackups: fileBytes,
      imageBackups: imageBytes,
      totalBackups: totalUsedByBackups,
      servers: [{
        serverId: 1,
        serverName: 'Local UrBackup Server',
        used: usedSize,
        available: availableSize
      }]
    });
  } catch (error) {
    logger.error('Failed to get storage information:', error);
    res.status(500).json({ error: 'Failed to get storage information' });
  }
}

/**
 * Get storage for a specific server (kept for compatibility, but returns local server)
 */
export async function getServerStorage(req: AuthRequest, res: Response): Promise<void> {
  // Since we only have one local server now, this is the same as getTotalStorage
  return getTotalStorage(req, res);
}
