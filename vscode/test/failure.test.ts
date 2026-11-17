import { describe, expect, it } from 'vitest';
import { fieldsForFailure, indexInstructions, parseRenderFailures } from '../src/failure';
import { inferSchema } from '../src/schema';
import { cond, field, rep } from './helpers';

const BAD_EXPRESSION =
  'render failed (HTTP 400):\nUnable to evaluate field expression [status +]:Unexpected end in expression: status +: <<{status +}>> (word/document.xml, paragraph 2)\nTemplate merge failed\n';

const TWO_ERRORS =
  'render failed (HTTP 400):\nTemplate merge failed\nUnmatched ending tag "es_": <<es_>> (word/header1.xml, paragraph 2)\nError in expression:Expression is invalid.: <<status = "A">> (word/document.xml, word/document.xml, paragraph 2)\n';

describe('parseRenderFailures', () => {
  it('reads the reason, instruction, part and place from a dtsse-doc-render merge error', () => {
    expect(parseRenderFailures(BAD_EXPRESSION)).toEqual([
      {
        reason: 'Unable to evaluate field expression [status +]:Unexpected end in expression: status +',
        instruction: '{status +}',
        part: 'word/document.xml',
        where: 'paragraph 2',
      },
    ]);
  });

  it('reads every error', () => {
    expect(parseRenderFailures(TWO_ERRORS)).toEqual([
      { reason: 'Unmatched ending tag "es_"', instruction: 'es_', part: 'word/header1.xml', where: 'paragraph 2' },
      {
        reason: 'Error in expression:Expression is invalid.',
        instruction: 'status = "A"',
        part: 'word/document.xml',
        where: 'word/document.xml, paragraph 2',
      },
    ]);
  });

  it('returns nothing for errors that name no instruction', () => {
    expect(
      parseRenderFailures(
        'render failed (HTTP 400):\nMismatched sections.  Expecting section end for section "flag" but end is for section "other" (word/document.xml, paragraph 2)\nTemplate merge failed\n',
      ),
    ).toEqual([]);
    expect(parseRenderFailures('render failed (HTTP 502):\nbad gateway')).toEqual([]);
    expect(parseRenderFailures('')).toEqual([]);
  });
});

describe('fieldsForFailure', () => {
  const tree = [
    field('{status +}', ['status']),
    field('name'),
    cond('cs_{ready}', ['ready']),
    rep('items', [field("{dateFormat(due,'d MMMM yyyy','yyyy-MM-dd')}", ['due'])]),
    field('{dateFormat(issueDate,‘d MMMM yyyy’,‘dd-MM-yyyy’)}', ['issueDate']),
  ];
  const index = indexInstructions(tree, inferSchema(tree).root);
  const failure = (instruction: string) => ({ reason: 'r', instruction, part: 'word/document.xml', where: 'paragraph 1' });

  it('finds the field behind the failing instruction', () => {
    const [first] = parseRenderFailures(BAD_EXPRESSION);
    expect(fieldsForFailure(first!, index)).toEqual(['status']);
  });

  it('ignores curly versus straight quotes and spacing', () => {
    expect(fieldsForFailure(failure("{dateFormat(issueDate, 'd MMMM yyyy', 'dd-MM-yyyy')}"), index)).toEqual(['issueDate']);
  });

  it('scopes fields inside a repeat to the row path', () => {
    expect(fieldsForFailure(failure("{dateFormat(due,'d MMMM yyyy','yyyy-MM-dd')}"), index)).toEqual(['items[].due']);
  });

  it('returns nothing when no instruction matches', () => {
    expect(fieldsForFailure(failure('{somethingElse}'), index)).toEqual([]);
  });
});

describe('indexInstructions scope prefixes', () => {
  const tree = [
    field('{caseRef}', ['caseRef']),
    rep('parties', [
      field('{$root.caseRef}', ['$root.caseRef']),
      field('{$this.role}', ['$this.role']),
      field('{name}', ['name']),
      rep('addresses', [
        field('{$parent.role}', ['$parent.role']),
        field('{$root.court.name}', ['$root.court.name']),
        field('{$this.line}', ['$this.line']),
      ]),
    ]),
    field('{court.name}', ['court.name']),
    rep('$root.agents', [field('{$this.id}', ['$this.id']), field('{$parent.caseRef}', ['$parent.caseRef'])]),
  ];
  const index = indexInstructions(tree, inferSchema(tree).root);
  const pathsFor = (text: string) => index.find((e) => e.text === text)?.paths;

  it('resolves $root from inside a repeat', () => {
    expect(pathsFor('{$root.caseRef}')).toEqual(['caseRef']);
    expect(pathsFor('{$root.court.name}')).toEqual(['court.name']);
  });

  it('resolves $this and bare names to the current scope', () => {
    expect(pathsFor('{$this.role}')).toEqual(['parties[].role']);
    expect(pathsFor('{name}')).toEqual(['parties[].name']);
    expect(pathsFor('{$this.line}')).toEqual(['parties[].addresses[].line']);
  });

  it('resolves $parent to the enclosing scope, and to the root at the top level', () => {
    expect(pathsFor('{$parent.role}')).toEqual(['parties[].role']);
    expect(pathsFor('{$parent.caseRef}')).toEqual(['caseRef']);
  });

  it('resolves a $root repeat target', () => {
    expect(pathsFor('{$this.id}')).toEqual(['agents[].id']);
  });
});
