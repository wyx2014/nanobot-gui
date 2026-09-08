import { parentPort, workerData } from 'node:worker_threads';
import { buildDiagnosticBundle, type BundleInput } from './bundle';

void buildDiagnosticBundle(workerData as BundleInput, (stage) => parentPort?.postMessage({ stage }))
  .then((result) => parentPort?.postMessage({ result }))
  .catch((error) => parentPort?.postMessage({ result: { status: 'failed',
    error_code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'EXPORT_FAILED' } }));
