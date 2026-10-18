import { spawn } from 'node:child_process';

// Free web-service plans do not offer a separate always-on worker. Run the API
// and outbox worker as supervised child processes in one deployable service.
// On a paid plan, start the API and worker as separate services instead.
const children = [
  spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['dist/outbox/worker.js'], { stdio: 'inherit' }),
];

let stopping = false;
let exitCode = 0;

function stop(signal: NodeJS.Signals = 'SIGTERM', code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('OpsFlow process failed to start', error);
    stop('SIGTERM', 1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(
        `OpsFlow process exited unexpectedly (${signal ?? code ?? 'unknown'}); stopping sibling.`,
      );
      stop('SIGTERM', code && code !== 0 ? code : 1);
    }
    if (
      children.every((candidate) => candidate.exitCode !== null || candidate.signalCode !== null)
    ) {
      process.exitCode = exitCode;
    }
  });
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
