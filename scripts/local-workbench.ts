import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalApp } from '../reviewer/server/start';

await startLocalApp({
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  port: Number(process.env.WORKBENCH_PORT ?? '4316'),
  production: process.argv.includes('--production'),
});
