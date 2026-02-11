import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';

import { DevXMCPServer, ConfluenceClient } from '@devx/mcp-sdk';

export class DevX implements AIProvider {
  private client: DevXSDK;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new DevXSDK();
    this.model = model || 'playground';
  }

  async generateSQL(prompt: string): Promise<string> {
    
    const system_prompt = 
      `#Role
      You are a SQL expert. Generate only valid SQL queries based on the provided schema and natural language request. Return ONLY the SQL query without any explanation or markdown formatting.
      `;
    console.log("==========================");
    console.log(prompt);
    console.log("==========================");
    
    const merge_prompt = system_prompt + prompt;
    const response = await this.client.callAgent({
      agentCode: this.model,
      query: `${system_prompt}`,
    });

    const textBlock = response.data?.answer;
    console.log("============ textBlock ==============");
    console.log(textBlock);
    console.log("==========================");
    return textBlock;
  }
}
