import { describe, it, expect } from 'vitest';
import { formatColumnType } from '../components/shared/formatColumnType';
import type { ColumnInfo } from '../api/types';

function col(overrides: Partial<ColumnInfo>): ColumnInfo {
  return {
    name: 'test',
    dataType: 'int',
    maxLength: null,
    precision: null,
    scale: null,
    isNullable: false,
    isPrimaryKey: false,
    isIdentity: false,
    isComputed: false,
    defaultValue: null,
    ordinalPosition: 1,
    ...overrides,
  };
}

describe('formatColumnType', () => {
  it('returns plain type for int', () => {
    expect(formatColumnType(col({ dataType: 'int' }))).toBe('int');
  });

  it('returns plain type for bigint', () => {
    expect(formatColumnType(col({ dataType: 'bigint' }))).toBe('bigint');
  });

  it('returns varchar with length', () => {
    expect(formatColumnType(col({ dataType: 'varchar', maxLength: 50 }))).toBe('varchar(50)');
  });

  it('returns nvarchar with length', () => {
    expect(formatColumnType(col({ dataType: 'nvarchar', maxLength: 100 }))).toBe('nvarchar(100)');
  });

  it('returns varchar(max) for -1 length', () => {
    expect(formatColumnType(col({ dataType: 'varchar', maxLength: -1 }))).toBe('varchar(max)');
  });

  it('returns nvarchar(max) for -1 length', () => {
    expect(formatColumnType(col({ dataType: 'nvarchar', maxLength: -1 }))).toBe('nvarchar(max)');
  });

  it('returns decimal with precision and scale', () => {
    expect(formatColumnType(col({ dataType: 'decimal', precision: 18, scale: 2 }))).toBe('decimal(18,2)');
  });

  it('returns numeric with precision and scale', () => {
    expect(formatColumnType(col({ dataType: 'numeric', precision: 10, scale: 4 }))).toBe('numeric(10,4)');
  });

  it('does not add length for datetime', () => {
    expect(formatColumnType(col({ dataType: 'datetime', maxLength: 8 }))).toBe('datetime');
  });

  it('does not add length for uniqueidentifier', () => {
    expect(formatColumnType(col({ dataType: 'uniqueidentifier', maxLength: 16 }))).toBe('uniqueidentifier');
  });

  it('returns char with length', () => {
    expect(formatColumnType(col({ dataType: 'char', maxLength: 10 }))).toBe('char(10)');
  });

  it('returns varbinary with length', () => {
    expect(formatColumnType(col({ dataType: 'varbinary', maxLength: 500 }))).toBe('varbinary(500)');
  });
});
