import { Context, Next } from '@nocobase/actions';
import { LogReaderService } from '../services/log-reader.service';
import { LogRetentionService } from '../services/log-retention.service';
import { getLoggerFilePath } from '@nocobase/logger';
import path from 'path';
import fsp from 'fs/promises';
import _ from 'lodash';

const envVars = [
  'APP_ENV',
  'APP_PORT',
  'API_BASE_PATH',
  'API_BASE_URL',
  'DB_DIALECT',
  'DB_TABLE_PREFIX',
  'DB_UNDERSCORED',
  'DB_TIMEZONE',
  'DB_LOGGING',
  'LOGGER_TRANSPORT',
  'LOGGER_LEVEL',
];

export function createCompatLoggerResource(
  readerService: LogReaderService,
  retentionService: LogRetentionService,
) {
  return {
    name: 'logger',
    actions: {
      list: async (ctx: Context, next: Next) => {
        const basePath = readerService.getLogBasePath();
        const readDir = async (path2: string) => {
          const fileTree: any[] = [];
          try {
            const files = await fsp.readdir(path2, { withFileTypes: true });
            for (const file of files) {
              if (file.isDirectory()) {
                const subFiles = await readDir(path.join(path2, file.name));
                if (!subFiles.length) continue;
                fileTree.push({
                  name: file.name,
                  files: subFiles,
                });
              } else if (file.name.endsWith('.log')) {
                fileTree.push(file.name);
              }
            }
            return fileTree;
          } catch (err) {
            return [];
          }
        };
        ctx.body = await readDir(basePath);
        await next();
      },

      download: async (ctx: Context, next: Next) => {
        const { files = [] } = ctx.action.params.values || ctx.query || {};
        if (!files.length) {
          ctx.throw(400, 'No files selected.');
        }
        try {
          ctx.attachment('logs.tar.gz');
          ctx.body = await retentionService.createArchiveStream(files);
        } catch (err) {
          ctx.throw(500, `Download logs failed: ${err.message}`);
        }
        await next();
      },

      collect: async (ctx: Context, next: Next) => {
        const { error, ...info } = ctx.action.params.values || {};
        const { message, ...e } = error || {};
        ctx.log?.error?.({ message: `Diagnosis, frontend error, ${message}`, ...e });
        ctx.log?.error?.(`Diagnostic information`, info);
        ctx.log?.error?.('Diagnosis, environment variables', _.pick(process.env, envVars));

        try {
          ctx.attachment('logs.tar.gz');
          ctx.body = await retentionService.createArchiveStream();
        } catch (err) {
          ctx.throw(500, `Download logs failed: ${err.message}`);
        }
        await next();
      },
    },
  };
}
