import type { JsonValue } from '../json.js';
import { isJsonObject } from '../json.js';

/**
 * PHP's `json_encode($value, JSON_PRETTY_PRINT)`, for the one place the
 * reference puts PHP-formatted JSON INSIDE a string that is sent: the schema
 * instruction its chat-completions structured path appends.
 *
 * That text reaches the model and the request body, so it has to be PHP's
 * bytes, not `JSON.stringify(value, null, 4)`: PHP escapes `/` as `\/` and
 * every non-ASCII UTF-16 unit as a lowercase `\uXXXX`, separates a key from
 * its value with `": "`, and writes an empty array as `[]` and an empty
 * object as `{}` on one line.
 *
 * Known limit: PHP keeps a float's `.0` (`1.0`); a JavaScript number cannot
 * say whether it was one, so an integral float prints as an integer here.
 */
export function phpPrettyJson(value: JsonValue, depth = 0): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return phpJsonString(value);

  const inner = '    '.repeat(depth + 1);
  const outer = '    '.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';

    return `[\n${value.map((item) => inner + phpPrettyJson(item, depth + 1)).join(',\n')}\n${outer}]`;
  }

  if (!isJsonObject(value)) return 'null';

  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';

  return `{\n${entries.map(([key, item]) => `${inner}${phpJsonString(key)}: ${phpPrettyJson(item, depth + 1)}`).join(',\n')}\n${outer}}`;
}

const SHORT_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x2f: '\\/',
  0x5c: '\\\\',
};

function phpJsonString(text: string): string {
  let out = '"';

  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const short = SHORT_ESCAPES[unit];

    if (short !== undefined) {
      out += short;
    } else if (unit < 0x20 || unit > 0x7e) {
      // DEL (0x7f) is ASCII and PHP leaves it alone.
      out += unit === 0x7f ? '\u007f' : `\\u${unit.toString(16).padStart(4, '0')}`;
    } else {
      out += text[index];
    }
  }

  return `${out}"`;
}
