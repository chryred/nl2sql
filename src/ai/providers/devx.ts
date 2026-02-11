import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';

import { DevXMCPServer, ConfluenceClient } from '@devx/mcp-sdk';

export class DevX implements AIProvider {
  private client: DevXSDK;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new DevXSDK();
    this.model = model || 'claude-sonnet-4-20250514';
  }

  async generateSQL(prompt: string): Promise<string> {

    const system_prompt = 
      `#Role
      You are a SQL expert. Generate only valid SQL queries based on the provided schema and natural language request. Return ONLY the SQL query without any explanation or markdown formatting.
      `;

    const merge_prompt = system_prompt + prompt;
    const response = await this.client.callAgent({
      agentCode: 'playground',
      query: `${merge_prompt}`,
    });

    const textBlock = response.data?.answer;
    return textBlock;
  }
}
