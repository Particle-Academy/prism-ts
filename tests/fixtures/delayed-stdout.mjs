import process from 'node:process';
import { setTimeout } from 'node:timers';

// Make stdout asynchronous on every platform. An immediate process.exit()
// must lose this queued write, even where ordinary stdout is synchronous.
const write = process.stdout.write.bind(process.stdout);

process.stdout.write = function (chunk, encoding, callback) {
  const done = typeof encoding === 'function' ? encoding : callback;
  const codec = typeof encoding === 'string' ? encoding : undefined;

  setTimeout(() => write(chunk, codec, done), 25);

  return false;
};
