import type { JsonObject } from '../json.js';

/**
 * One vector.
 *
 * A class rather than a bare `number[]`, matching the reference, and the reason
 * survives the port: an embedding and an arbitrary array of numbers are the same
 * shape and different things. A function taking `number[]` accepts a list of
 * token counts by mistake; one taking `Embedding` does not.
 */
export class Embedding {
  constructor(readonly embedding: readonly number[]) {}

  /**
   * Non-numeric members are DROPPED rather than coerced.
   *
   * `Number(null)` is 0 and `Number('')` is 0, so coercing would silently push
   * a zero into a vector and shift every distance computed against it. A
   * provider that sent a null in a vector has malfunctioned, and a shorter
   * vector is a visible fault where a zeroed one is not.
   */
  static fromArray(values: readonly unknown[]): Embedding {
    return new Embedding(values.filter((value): value is number => typeof value === 'number'));
  }

  toObject(): JsonObject {
    return { embedding: [...this.embedding] };
  }
}
