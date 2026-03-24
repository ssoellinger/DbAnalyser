import { describe, it, expect } from 'vitest';
import {
  getStatementAtCursor,
  generateSelectTop, generateSelectCount,
  generateInsertTemplate, generateColumnList, generateTableRef,
} from '../components/query/queryHelpers';
import type { TableInfo } from '../api/types';

// Helper to create a minimal TableInfo
function table(schema = 'dbo', name = 'Orders', columns: { name: string; dataType: string; isIdentity?: boolean; isComputed?: boolean; isNullable?: boolean }[] = []): TableInfo {
  return {
    schemaName: schema,
    tableName: name,
    fullName: `${schema}.${name}`,
    columns: columns.map((c, i) => ({
      name: c.name,
      dataType: c.dataType,
      maxLength: null,
      precision: null,
      scale: null,
      isNullable: c.isNullable ?? false,
      isPrimaryKey: false,
      isIdentity: c.isIdentity ?? false,
      isComputed: c.isComputed ?? false,
      defaultValue: null,
      ordinalPosition: i + 1,
    })),
    indexes: [],
    foreignKeys: [],
  };
}

describe('getStatementAtCursor', () => {
  it('returns full text when no delimiters', () => {
    expect(getStatementAtCursor('SELECT * FROM Orders', 5)).toBe('SELECT * FROM Orders');
  });

  it('finds statement at cursor with semicolons', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    expect(getStatementAtCursor(sql, 0)).toBe('SELECT 1;');
    expect(getStatementAtCursor(sql, 12)).toBe('SELECT 2;');
    expect(getStatementAtCursor(sql, 22)).toBe('SELECT 3;');
  });

  it('finds statement with GO delimiters', () => {
    const sql = 'SELECT 1\nGO\nSELECT 2\nGO\n';
    expect(getStatementAtCursor(sql, 0)).toBe('SELECT 1');
    expect(getStatementAtCursor(sql, 14)).toBe('SELECT 2');
  });

  it('handles cursor at end', () => {
    const sql = 'SELECT * FROM Orders';
    expect(getStatementAtCursor(sql, sql.length)).toBe('SELECT * FROM Orders');
  });
});

describe('generateSelectTop', () => {
  it('generates SELECT TOP with default 1000', () => {
    const result = generateSelectTop(table());
    expect(result).toContain('SELECT TOP 1000 *');
    expect(result).toContain('[dbo].[Orders]');
  });

  it('generates SELECT TOP with custom count', () => {
    const result = generateSelectTop(table(), 100);
    expect(result).toContain('SELECT TOP 100 *');
  });
});

describe('generateSelectCount', () => {
  it('generates COUNT query', () => {
    const result = generateSelectCount(table());
    expect(result).toContain('SELECT COUNT(*)');
    expect(result).toContain('[dbo].[Orders]');
  });
});

describe('generateInsertTemplate', () => {
  it('generates INSERT with columns', () => {
    const t = table('dbo', 'Users', [
      { name: 'Name', dataType: 'nvarchar' },
      { name: 'Age', dataType: 'int' },
    ]);
    const result = generateInsertTemplate(t);
    expect(result).toContain('INSERT INTO [dbo].[Users]');
    expect(result).toContain('[Name]');
    expect(result).toContain('[Age]');
  });

  it('skips identity columns', () => {
    const t = table('dbo', 'Users', [
      { name: 'Id', dataType: 'int', isIdentity: true },
      { name: 'Name', dataType: 'nvarchar' },
    ]);
    const result = generateInsertTemplate(t);
    expect(result).not.toContain('[Id]');
    expect(result).toContain('[Name]');
  });

  it('skips computed columns', () => {
    const t = table('dbo', 'Users', [
      { name: 'FullName', dataType: 'nvarchar', isComputed: true },
      { name: 'FirstName', dataType: 'nvarchar' },
    ]);
    const result = generateInsertTemplate(t);
    expect(result).not.toContain('[FullName]');
    expect(result).toContain('[FirstName]');
  });

  it('uses NULL for nullable columns', () => {
    const t = table('dbo', 'Users', [
      { name: 'MiddleName', dataType: 'int', isNullable: true },
    ]);
    const result = generateInsertTemplate(t);
    expect(result).toContain('NULL');
  });
});

describe('generateColumnList', () => {
  it('generates comma-separated column list', () => {
    const t = table('dbo', 'Users', [
      { name: 'Id', dataType: 'int' },
      { name: 'Name', dataType: 'nvarchar' },
    ]);
    expect(generateColumnList(t)).toBe('[Id], [Name]');
  });
});

describe('generateTableRef', () => {
  it('generates [schema].[table] reference for SQL Server', () => {
    expect(generateTableRef(table())).toBe('[dbo].[Orders]');
  });

  it('generates "schema"."table" reference for Oracle', () => {
    expect(generateTableRef(table(), 'oracle')).toBe('"dbo"."Orders"');
  });

  it('generates "schema"."table" reference for PostgreSQL', () => {
    expect(generateTableRef(table(), 'postgresql')).toBe('"dbo"."Orders"');
  });
});

// ── Oracle-specific tests ──

describe('Oracle SQL generation', () => {
  it('generateSelectTop uses FETCH FIRST for Oracle', () => {
    const result = generateSelectTop(table(), 1000, 'oracle');
    expect(result).toContain('FETCH');
    expect(result).toContain('1000 ROWS ONLY');
    expect(result).not.toContain('TOP');
    expect(result).toContain('"dbo"."Orders"');
  });

  it('generateSelectTop uses LIMIT for PostgreSQL', () => {
    const result = generateSelectTop(table(), 500, 'postgresql');
    expect(result).toContain('LIMIT 500');
    expect(result).not.toContain('TOP');
  });

  it('generateSelectCount uses double quotes for Oracle', () => {
    const result = generateSelectCount(table(), 'oracle');
    expect(result).toContain('"dbo"."Orders"');
    expect(result).not.toContain('[');
  });

  it('generateInsertTemplate uses SYSDATE for Oracle', () => {
    const t = table('dbo', 'Users', [
      { name: 'CreatedAt', dataType: 'timestamp' },
    ]);
    const result = generateInsertTemplate(t, 'oracle');
    expect(result).toContain('SYSDATE');
    expect(result).not.toContain('GETDATE');
  });

  it('generateInsertTemplate uses NOW() for PostgreSQL', () => {
    const t = table('dbo', 'Users', [
      { name: 'CreatedAt', dataType: 'date' },
    ]);
    const result = generateInsertTemplate(t, 'postgresql');
    expect(result).toContain('NOW()');
  });

  it('generateColumnList uses double quotes for Oracle', () => {
    const t = table('dbo', 'Users', [
      { name: 'Id', dataType: 'int' },
      { name: 'Name', dataType: 'varchar' },
    ]);
    expect(generateColumnList(t, 'oracle')).toBe('"Id", "Name"');
  });
});
