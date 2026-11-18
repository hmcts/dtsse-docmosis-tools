const TOKEN = /yyyy|yy|MM|M|dd|d/g;

/** True when a format uses only year, month and day tokens, so a native date input can represent it. */
export function isDateOnlyFormat(format: string): boolean {
  if (/M{3,}|d{3,}|(?<!y)y{3}(?!y)|y{5,}/.test(format)) return false;
  const rest = format.replace(TOKEN, '');
  return /^[^A-Za-z']*$/.test(rest) && /yyyy|yy/.test(format) && /M/.test(format) && /d/.test(format);
}

interface Parts {
  year: number;
  month: number;
  day: number;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function formatDate({ year, month, day }: Parts, format: string): string {
  return format.replace(TOKEN, (t) => {
    switch (t) {
      case 'yyyy': return pad(year, 4);
      case 'yy': return pad(year % 100, 2);
      case 'MM': return pad(month, 2);
      case 'M': return String(month);
      case 'dd': return pad(day, 2);
      default: return String(day);
    }
  });
}

/** Parses a value written in `format`, or returns undefined when it doesn't match. */
export function parseDate(value: string, format: string): Parts | undefined {
  const order: string[] = [];
  let pattern = '';
  let last = 0;
  for (const m of format.matchAll(TOKEN)) {
    pattern += escape(format.slice(last, m.index));
    last = m.index + m[0].length;
    order.push(m[0]);
    pattern += m[0] === 'yyyy' ? '(\\d{4})' : m[0] === 'yy' ? '(\\d{2})' : m[0].length === 2 ? '(\\d{2})' : '(\\d{1,2})';
  }
  pattern += escape(format.slice(last));
  const match = new RegExp(`^${pattern}$`).exec(value.trim());
  if (!match) return undefined;
  const parts: Partial<Parts> = {};
  order.forEach((token, i) => {
    const n = Number(match[i + 1]);
    if (token.startsWith('y')) parts.year = token === 'yy' ? 2000 + n : n;
    else if (token.startsWith('M')) parts.month = n;
    else parts.day = n;
  });
  if (parts.year === undefined || parts.month === undefined || parts.day === undefined) return undefined;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const valid = date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1 && date.getUTCDate() === parts.day;
  return valid ? (parts as Parts) : undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The stored value (in the template's input format) as the yyyy-MM-dd a date input shows. */
export function storedToInput(stored: string, format: string): string {
  const parts = parseDate(stored, format);
  return parts ? formatDate(parts, 'yyyy-MM-dd') : '';
}

/** A date input's yyyy-MM-dd as the value stored in the data, in the template's input format. */
export function inputToStored(input: string, format: string): string {
  const parts = parseDate(input, 'yyyy-MM-dd');
  return parts ? formatDate(parts, format) : '';
}

/**
 * Whether `value` has the shape `format` describes, or undefined when the format can't be
 * checked (time tokens, quoted text or tokens outside d, M and y). Docmosis parses leniently,
 * so only the structure is checked, not whether the day or month is in range.
 */
export function matchesDateFormat(value: string, format: string): boolean | undefined {
  const tokens = /d{1,2}|M{1,4}|y{4}|y{2}/g;
  const literals = format.replace(tokens, '');
  if (/[A-Za-z']/.test(literals) || !/d/.test(format) || !/M/.test(format) || !/y/.test(format)) return undefined;
  let pattern = '';
  let last = 0;
  for (const m of format.matchAll(tokens)) {
    pattern += escape(format.slice(last, m.index));
    last = m.index + m[0].length;
    pattern += m[0].startsWith('M') && m[0].length >= 3 ? '[\\p{L}.]+' : '\\d+';
  }
  pattern += escape(format.slice(last));
  return new RegExp(`^${pattern}$`, 'u').test(value.trim());
}
