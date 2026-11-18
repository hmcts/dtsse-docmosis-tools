import { describe, expect, it } from 'vitest';
import { fill, notifyMarkdown, renderLocal, smsCount } from '../../src/notify/localRender';

describe('notifyMarkdown', () => {
  it('formats headings, paragraphs and line breaks', () => {
    expect(notifyMarkdown('# Your claim\n\nLine one\nline two\n\n## Next')).toBe(
      '<h2>Your claim</h2>\n<p>Line one<br>line two</p>\n<h3>Next</h3>',
    );
  });

  it('formats bullets and numbered lists', () => {
    expect(notifyMarkdown('Bring:\n* a\n- b\n• c\n\n1. first\n2. second')).toBe(
      '<p>Bring:</p>\n<ul><li>a</li><li>b</li><li>c</li></ul>\n<ol><li>first</li><li>second</li></ol>',
    );
  });

  it('formats inset text and horizontal rules', () => {
    expect(notifyMarkdown('^ Important\nstill inset\n\n---\nafter')).toBe(
      '<blockquote class="inset">Important<br>still inset</blockquote>\n<hr>\n<p>after</p>',
    );
  });

  it('links markdown links and bare URLs, and escapes HTML', () => {
    expect(notifyMarkdown('[Sign in](https://example.gov.uk/a?b=1&c=2) or https://gov.uk. <script>')).toBe(
      '<p><a href="https://example.gov.uk/a?b=1&amp;c=2">Sign in</a> or <a href="https://gov.uk">https://gov.uk</a>. &lt;script&gt;</p>',
    );
  });

  it('links URLs in quotes without the quotes', () => {
    expect(notifyMarkdown('Go to "https://x.com" now')).toBe('<p>Go to &quot;<a href="https://x.com">https://x.com</a>&quot; now</p>');
  });

  it('keeps placeholders in URLs and link text inside one link', () => {
    expect(notifyMarkdown('See https://x.com/cases/((case id)).')).toBe(
      '<p>See <a href="https://x.com/cases/((case id))">https://x.com/cases/<span class="placeholder">((case id))</span></a>.</p>',
    );
    expect(notifyMarkdown('[View ((case id))](https://x.com/((case id))?a=1&b=2)')).toBe(
      '<p><a href="https://x.com/((case id))?a=1&amp;b=2">View <span class="placeholder">((case id))</span></a></p>',
    );
  });

  it('escapes link text and a placeholder that looks like markup', () => {
    expect(notifyMarkdown('[<b>](https://x.com) ((<i>))')).toBe(
      '<p><a href="https://x.com">&lt;b&gt;</a> <span class="placeholder">((&lt;i&gt;))</span></p>',
    );
  });

  it('marks placeholders left unfilled', () => {
    expect(notifyMarkdown('Dear ((name))')).toBe('<p>Dear <span class="placeholder">((name))</span></p>');
  });
});

describe('fill', () => {
  it('fills values, applies conditionals and keeps missing placeholders', () => {
    const text = 'Dear ((Name)), ((welsh??Croeso. ))((english??Welcome. ))((missing))';
    expect(fill(text, { name: 'Ann', welsh: true, english: 'no' }, 'inline')).toBe('Dear Ann, Croeso. ((missing))');
  });

  it('turns lists into bullets where formatted and a sentence elsewhere', () => {
    expect(fill('You need: ((items))', { items: ['a', 'b', 'c'] }, 'bullets')).toBe('You need: \n\n* a\n* b\n* c\n\n');
    expect(fill('You need: ((items))', { items: ['a', 'b', 'c'] }, 'inline')).toBe('You need: a, b and c');
    expect(fill('((items))', { items: ['a'] }, 'inline')).toBe('a');
  });
});

describe('smsCount', () => {
  it('counts GSM messages at 160, then 153 per part', () => {
    expect(smsCount('a'.repeat(160))).toEqual({ characters: 160, fragments: 1, unicode: false });
    expect(smsCount('a'.repeat(161))).toEqual({ characters: 161, fragments: 2, unicode: false });
    expect(smsCount('a'.repeat(307))).toEqual({ characters: 307, fragments: 3, unicode: false });
  });

  it('counts extended characters twice', () => {
    expect(smsCount('€[]')).toEqual({ characters: 6, fragments: 1, unicode: false });
  });

  it('counts Unicode messages at 70, then 67 per part', () => {
    expect(smsCount('ŵ'.repeat(70))).toEqual({ characters: 70, fragments: 1, unicode: true });
    expect(smsCount('ŵ'.repeat(71))).toEqual({ characters: 71, fragments: 2, unicode: true });
  });

  it('counts the characters Notify swaps for GSM ones as GSM', () => {
    expect(smsCount('It’s “done” – see…')).toEqual({ characters: 20, fragments: 1, unicode: false });
    expect(smsCount('a\u00a0b\tc\u200bd')).toEqual({ characters: 6, fragments: 1, unicode: false });
    expect(smsCount('‘'.repeat(161))).toEqual({ characters: 161, fragments: 2, unicode: false });
    expect(smsCount('a\u2011b\u2212c\u201ad\u201ee\u202ff\u2028g')).toEqual({ characters: 12, fragments: 1, unicode: false });
  });

  it('counts a zero width joiner as Unicode, as Notify does for text messages', () => {
    expect(smsCount('a\u200db').unicode).toBe(true);
  });

  it('counts an empty message as none', () => {
    expect(smsCount('').fragments).toBe(0);
  });
});

describe('renderLocal', () => {
  it('renders an email subject and HTML body', () => {
    expect(renderLocal('email', 'Case ((ref))', '# Hi ((name))\n\n((items))', { ref: '123', name: 'Ann', items: ['a', 'b'] })).toEqual({
      subject: 'Case 123',
      html: '<h2>Hi Ann</h2>\n<ul><li>a</li><li>b</li></ul>',
    });
  });

  it('renders a text message as plain text with its count', () => {
    expect(renderLocal('sms', null, 'Hi ((name)) # not a heading ', { name: 'Ann' })).toEqual({
      text: 'Hi Ann # not a heading',
      sms: { characters: 22, fragments: 1, unicode: false },
    });
  });
});
