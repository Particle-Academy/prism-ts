import { Buffer } from 'node:buffer';
import { PrismError } from '../errors.js';
import { Embedding } from '../value-objects/embedding.js';

/** Decode the provider's vector without silently discarding malformed bytes. */
export function decodeEmbedding(value: unknown): Embedding {
  if (Array.isArray(value)) {
    return Embedding.fromArray(value);
  }

  if (typeof value !== 'string') {
    throw new PrismError('invalid_embedding', 'Invalid embedding: expected a vector or base64 string.');
  }

  const bytes = Buffer.from(value, 'base64');

  // Buffer accepts whitespace, missing padding and noncanonical padding bits.
  // The PHP reference requires the exact canonical encoding of the decoded bytes.
  if (bytes.toString('base64') !== value) {
    throw new PrismError('invalid_embedding', 'Invalid embedding: malformed base64.');
  }

  if (bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new PrismError('invalid_embedding', 'Invalid embedding: expected complete float32 values.');
  }

  const values: number[] = [];

  for (let offset = 0; offset < bytes.length; offset += 4) {
    const number = bytes.readFloatLE(offset);

    if (!Number.isFinite(number)) {
      throw new PrismError('invalid_embedding', 'Invalid embedding: non-finite float32 value.');
    }

    values.push(number);
  }

  return Embedding.fromArray(values);
}
