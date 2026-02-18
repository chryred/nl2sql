import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider } from './openai.js';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || 'claude-sonnet-4-20250514';
  }

  async generateSQL(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system:
        'You are a SQL expert. Generate only valid SQL queries based on the provided schema and natural language request. Return ONLY the SQL query without any explanation or markdown formatting.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }

  async selectTables(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system:
        'You are a database schema expert. Analyze the provided table list and user query, then return ONLY a valid JSON array of relevant table names. Do not include any explanation or SQL. Return only the JSON array. Example: ["orders", "customers", "order_items"]',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }
}
