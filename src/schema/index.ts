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

export interface ObjectSchemaOptions {
  requiredFields?: readonly string[];
  allowAdditionalProperties?: boolean;
  nullable?: boolean;
}

/**
 * The schema a structured response is shaped by.
 *
 * `allowAdditionalProperties` DEFAULTS TO FALSE, matching the reference, and the
 * default matters more here than it looks: OpenAI's strict schema mode REJECTS a
 * schema that permits extra properties, so a permissive default would make the
 * strongest structured mode unusable and silently push every request down to
 * plain JSON mode.
 */
export class ObjectSchema implements Schema {
  readonly requiredFields: readonly string[];

  readonly allowAdditionalProperties: boolean;

  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly description: string,
    readonly properties: readonly Schema[] = [],
    options: ObjectSchemaOptions = {},
  ) {
    this.requiredFields = options.requiredFields ?? [];
    this.allowAdditionalProperties = options.allowAdditionalProperties ?? false;
    this.nullable = options.nullable ?? false;
  }

  toObject(): JsonObject {
    const properties: JsonObject = {};

    for (const property of this.properties) {
      properties[property.name] = property.toObject();
    }

    // `properties` is dropped when empty rather than sent as `{}`, matching the
    // reference's not-null filter. `required` and `additionalProperties` are
    // always sent: `[]` and `false` are meaningful answers, not absences.
    const schema: JsonObject = {
      description: this.description,
      type: schemaType('object', this.nullable),
    };

    if (this.properties.length > 0) {
      schema.properties = properties;
    }

    schema.required = [...this.requiredFields];
    schema.additionalProperties = this.allowAdditionalProperties;

    return schema;
  }
}

export interface ArraySchemaOptions {
  minItems?: number | null;
  maxItems?: number | null;
  nullable?: boolean;
}

export class ArraySchema implements Schema {
  readonly minItems: number | null;

  readonly maxItems: number | null;

  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly description: string,
    readonly items: Schema,
    options: ArraySchemaOptions = {},
  ) {
    this.minItems = options.minItems ?? null;
    this.maxItems = options.maxItems ?? null;
    this.nullable = options.nullable ?? false;
  }

  toObject(): JsonObject {
    const schema: JsonObject = {
      description: this.description,
      type: schemaType('array', this.nullable),
      items: this.items.toObject(),
    };

    // Present only when set. The reference appends these conditionally rather
    // than emitting nulls, and a `minItems: null` is rejected by strict mode.
    if (this.minItems !== null) {
      schema.minItems = this.minItems;
    }

    if (this.maxItems !== null) {
      schema.maxItems = this.maxItems;
    }

    return schema;
  }
}

export interface EnumSchemaOptions {
  nullable?: boolean;
}

/**
 * A closed set of allowed values.
 *
 * When nullable, the reference adds `null` to the OPTIONS as well as to the
 * type union — a nullable enum whose options omit null describes a value that
 * can be null and may not be, which no validator can satisfy.
 */
export class EnumSchema implements Schema {
  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly description: string,
    readonly options: readonly (string | number | null)[],
    schemaOptions: EnumSchemaOptions = {},
  ) {
    this.nullable = schemaOptions.nullable ?? false;
  }

  toObject(): JsonObject {
    return {
      description: this.description,
      enum: this.nullable ? [...this.options, null] : [...this.options],
      type: schemaType('string', this.nullable),
    };
  }
}
