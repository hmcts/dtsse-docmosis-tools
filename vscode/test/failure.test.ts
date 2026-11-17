import { describe, expect, it } from 'vitest';
import { fieldsForFailure, indexInstructions, parseRenderFailure } from '../src/failure';
import { inferSchema } from '../src/schema';
import { cond, field, rep } from './helpers';

const SPC_ERROR =
  'render failed (HTTP 400):\n{"succeeded":false,"shortMsg":"Task failed:Field <<{dateFormat(issueDate,\'d MMMM yyyy\',\'dd-MM-yyyy\')}>> Unable to evaluate field expression [dateFormat(issueDate,\'d MMMM yyyy\',\'dd-MM-yyyy\')]:dateFormat() Cannot parse date:value=\\"234\\" formats applied=[\\"dd-MM-yyyy\\"]"}';

describe('parseRenderFailure', () => {
  it('reads the instruction, expression and reason from the SPC error', () => {
    expect(parseRenderFailure(SPC_ERROR)).toEqual({
      instruction: "{dateFormat(issueDate,'d MMMM yyyy','dd-MM-yyyy')}",
      expression: "dateFormat(issueDate,'d MMMM yyyy','dd-MM-yyyy')",
      reason: 'dateFormat() Cannot parse date:value="234" formats applied=["dd-MM-yyyy"]',
    });
  });

  it('reads a bare message that is not JSON', () => {
    expect(parseRenderFailure('Field <<name.first>> Unable to evaluate field expression [name.first]:null value')).toEqual({
      instruction: 'name.first',
      expression: 'name.first',
      reason: 'null value',
    });
  });

  it('reads a condition expression', () => {
    const text = '{"shortMsg":"Task failed:Field <<cs_{count > 1}>> Unable to evaluate condition expression [count > 1]:bad compare"}';
    expect(parseRenderFailure(text)).toEqual({ instruction: 'cs_{count > 1}', expression: 'count > 1', reason: 'bad compare' });
  });

  it('returns nothing for errors that name no field', () => {
    expect(parseRenderFailure('render failed (HTTP 400): template does not exist')).toEqual({});
    expect(parseRenderFailure('')).toEqual({});
  });
});

describe('fieldsForFailure', () => {
  const tree = [
    field('{dateFormat(issueDate,‘d MMMM yyyy’,‘dd-MM-yyyy’)}', ['issueDate']),
    field('name'),
    cond('cs_{ready}', ['ready']),
    rep('items', [field("{dateFormat(due,'d MMMM yyyy','yyyy-MM-dd')}", ['due'])]),
  ];
  const index = indexInstructions(tree, inferSchema(tree).root);

  it('finds the field behind the SPC error, ignoring curly versus straight quotes', () => {
    expect(fieldsForFailure(parseRenderFailure(SPC_ERROR), index)).toEqual(['issueDate']);
  });

  it('matches on the expression alone', () => {
    expect(fieldsForFailure({ expression: "dateFormat(issueDate, 'd MMMM yyyy', 'dd-MM-yyyy')" }, index)).toEqual(['issueDate']);
  });

  it('scopes fields inside a repeat to the row path', () => {
    expect(fieldsForFailure({ instruction: "{dateFormat(due,'d MMMM yyyy','yyyy-MM-dd')}" }, index)).toEqual(['items[].due']);
  });

  it('returns nothing when no instruction matches', () => {
    expect(fieldsForFailure({ instruction: '{somethingElse}' }, index)).toEqual([]);
    expect(fieldsForFailure({}, index)).toEqual([]);
  });
});
