import { Ajv } from 'ajv';

export const ajv = new Ajv({ allErrors: true, strict: true });

export const str = { type: 'string', minLength: 1, maxLength: 4096 };

export const strings = { type: 'array', items: str, maxItems: 100 };

export const object = (properties: object, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
