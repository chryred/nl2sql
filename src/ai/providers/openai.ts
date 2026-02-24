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
            'You are a database schema expert. Analyze the provided table and column definitions, then infer foreign key relationships. Return ONLY a valid JSON array of relationship objects with fields: source_table, source_column, target_table, target_column, confidence (high/medium/low), and reasoning. Do not include any explanation outside the JSON array.',
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
