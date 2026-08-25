import type { JsonObject, JsonValue } from '../json.js';

/**
 * A JSON Schema fragment for one tool parameter.
 *
 * `toObject()` decides the key order that reaches the wire — `description`
 * before `type` — so the fragment, not the tool mapper, owns that decision.
 */
export interface Schema {
  readonly name: string;
  readonly description: string;
  toObject(): JsonObject;
}

/** The reference expresses "nullable" as a two-member type union, not a flag. */
function schemaType(type: string, nullable: boolean): JsonValue {
  return nullable ? [type, 'null'] : type;
}

export interface StringSchemaOptions {
  nullable?: boolean;
  pattern?: string | null;
  format?: string | null;
}

export class StringSchema implements Schema {
  readonly nullable: boolean;

  readonly pattern: string | null;

  readonly format: string | null;

  constructor(
    readonly name: string,
    readonly description: string,
    options: StringSchemaOptions = {},
  ) {
    this.nullable = options.nullable ?? false;
    this.pattern = options.pattern ?? null;
    this.format = options.format ?? null;
  }

  toObject(): JsonObject {
    const schema: JsonObject = {
      description: this.description,
      type: schemaType('string', this.nullable),
    };

    if (this.pattern !== null) {
      schema.pattern = this.pattern;
    }

    if (this.format !== null) {
      schema.format = this.format;
    }

    return schema;
  }
}

export interface NumberSchemaOptions {
  nullable?: boolean;
  multipleOf?: number | null;
  maximum?: number | null;
  exclusiveMaximum?: number | null;
  minimum?: number | null;
  exclusiveMinimum?: number | null;
}

export class NumberSchema implements Schema {
  readonly nullable: boolean;

  readonly multipleOf: number | null;

  readonly maximum: number | null;

  readonly exclusiveMaximum: number | null;

  readonly minimum: number | null;

  readonly exclusiveMinimum: number | null;

  constructor(
    readonly name: string,
    readonly description: string,
    options: NumberSchemaOptions = {},
  ) {
    this.nullable = options.nullable ?? false;
    this.multipleOf = options.multipleOf ?? null;
    this.maximum = options.maximum ?? null;
    this.exclusiveMaximum = options.exclusiveMaximum ?? null;
    this.minimum = options.minimum ?? null;
    this.exclusiveMinimum = options.exclusiveMinimum ?? null;
  }

  toObject(): JsonObject {
    const schema: JsonObject = {
      description: this.description,
      type: schemaType('number', this.nullable),
    };

    if (this.multipleOf !== null) {
      schema.multipleOf = this.multipleOf;
    }

    if (this.maximum !== null) {
      schema.maximum = this.maximum;
    }

    if (this.exclusiveMaximum !== null) {
      schema.exclusiveMaximum = this.exclusiveMaximum;
    }

    if (this.minimum !== null) {
      schema.minimum = this.minimum;
    }

    if (this.exclusiveMinimum !== null) {
      schema.exclusiveMinimum = this.exclusiveMinimum;
    }

    return schema;
  }
}

export interface BooleanSchemaOptions {
  nullable?: boolean;
}

export class BooleanSchema implements Schema {
  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly description: string,
    options: BooleanSchemaOptions = {},
  ) {
    this.nullable = options.nullable ?? false;
  }

  toObject(): JsonObject {
    return {
      description: this.description,
      type: schemaType('boolean', this.nullable),
    };
  }
}
