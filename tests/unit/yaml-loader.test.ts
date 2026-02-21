import { loadYaml, clearYamlCache } from '../../src/database/yaml-loader.js';

describe('loadYaml', () => {
  afterEach(() => clearYamlCache());

  it('YAML 파일을 파싱하여 반환한다', () => {
    const result = loadYaml<{ queries: unknown }>('schemas/postgresql.yaml');
    expect(result).toHaveProperty('queries');
  });

  it('같은 경로를 두 번 호출하면 동일 객체 참조를 반환한다 (캐시 히트)', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    const b = loadYaml('schemas/postgresql.yaml');
    expect(a).toBe(b);
  });

  it('다른 경로는 독립적으로 캐싱된다', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    const b = loadYaml('schemas/mysql.yaml');
    expect(a).not.toBe(b);
  });

  it('clearYamlCache 후 재호출하면 새 객체를 반환한다', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    clearYamlCache();
    const b = loadYaml('schemas/postgresql.yaml');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('존재하지 않는 경로는 에러를 throw한다', () => {
    expect(() => loadYaml('schemas/does-not-exist.yaml')).toThrow();
  });
});
