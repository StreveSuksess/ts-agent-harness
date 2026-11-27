import { Ajv, type ValidateFunction } from 'ajv';

/** A resumed run deserializes fresh schema objects. Bound the cache by schema content. */
const validators = new Map<string, ValidateFunction>();
const compiler = new Ajv({ strict: true, allErrors: true, addUsedSchema: false });

export function extensionValidator(schema: object): ValidateFunction {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (validate) return validate;
  validate = compiler.compile(schema);
  compiler.removeSchema(schema);
  if (validators.size === 128) validators.delete(validators.keys().next().value!);
  validators.set(key, validate);
  return validate;
}

export function validationError(validate: ValidateFunction): string {
  return compiler.errorsText(validate.errors);
}
