import { stripVTControlCharacters } from 'node:util';

function escapeControls(input: string): string {
  return input.replace(
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/** Keep model text, paths and subprocess output from issuing terminal commands. */
export function terminalText(input: string): string {
  return escapeControls(stripVTControlCharacters(input).replaceAll('\r\n', '\n'));
}

/** In a permission prompt every character must be recoverable, including terminal controls. */
export function quotedArgument(value: string): string {
  return escapeControls(JSON.stringify(value));
}

export function oneLine(input: string): string {
  return terminalText(input).replaceAll('\n', '\\n');
}

export function dbOption(db?: string): string {
  return db ? " --db '" + oneLine(db).replaceAll("'", "'\\''") + "'" : '';
}

export function indented(input: string): string {
  return terminalText(input).replace(/^/gm, '    ');
}
