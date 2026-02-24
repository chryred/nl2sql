import OpenAI from 'openai';

export interface AIProvider {
  /**
   * 범용 AI 텍스트 생성 메서드
   * @param systemPrompt - 시스템 프롬프트
   * @param userPrompt - 사용자 프롬프트
   * @returns AI 응답 텍스트
   */
  generateInferFK(prompt: string): Promise<string>;
  generateComment(systemPrompt: string, userPrompt: string): Promise<string>;
  generateSQL(prompt: string): Promise<string>;
  selectTables(prompt: string): Promise<string>;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model || 'gpt-4o';
  }

  async generateComment(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 2048,
    });
    return response.choices[0]?.message?.content || '';
  }

  async generateInferFK(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a senior DBA analyzing a database schema to infer implicit foreign key relationships that are not enforced as explicit FK constraints.\n\nYour task:\n1. Analyze table structures, column names, data types, comments, and business context\n2. Identify columns that likely reference primary/unique keys in other tables\n3. Consider naming patterns (e.g., {table_name}_id, {table_name}_cd, {table_name}_no)\n4. Use column/table comments and glossary terms to understand Korean business semantics\n5. Determine the most appropriate JOIN type (INNER: required relationship, LEFT: optional)\n6. Skip any relationships already listed in "Existing Relationships"\n\nReturn ONLY a valid JSON array with NO explanation outside it.\nEach object must have exactly these fields:\n{\n  "source_schema": "schema name",\n  "source_table": "table with the FK column",\n  "source_column": "FK column name",\n  "target_schema": "schema name",\n  "target_table": "referenced table (usually the one with PK)",\n  "target_column": "referenced column (usually PK)",\n  "relationship_type": "MANY_TO_ONE | ONE_TO_ONE | ONE_TO_MANY | MANY_TO_MANY",\n  "confidence": "HIGH | MEDIUM | LOW",\n  "join_hint": "INNER | LEFT | RIGHT | FULL",\n  "description": "추론 근거를 한국어로 간결하게 작성 (예: \'예약 → 매장 관계\')"\n}\n\nIf no new relationships are found, return [].',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content || '';
  }

  async generateSQL(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a SQL expert. Generate only valid SQL queries based on the provided schema and natural language request. Return ONLY the SQL query without any explanation or markdown formatting.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || '';
  }

  async selectTables(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a database schema expert. Analyze the provided table list and user query, then return ONLY a valid JSON array of relevant table names. Do not include any explanation or SQL. Return only the JSON array. Example: ["orders", "customers", "order_items"]',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || '';
  }
}
