// @ts-ignore
import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';
import { logger } from '../../logger/index.js';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

export class DevX implements AIProvider {
  private client: DevXSDK;
  private agentCode: string;
  private agentCodeMap = new Map<string, string>([
    ['playground', 'playground'],
    ['nl2sql_rel_table', 'custom_e81685f388d442548dce9b49ebad037e'], // 백화점CX팀_자연어기반 연관 테이블 조회
    ['nl2sql_query', 'custom_170def4091144a45a99eb302458321ed'], // 백화점CX팀_자연어기반 SQL생성기
  ]);

  constructor(apiKey: string, agentKey?: string) {
    this.client = new DevXSDK();
    this.agentCode = this.agentCodeMap.get(agentKey || 'playground')!;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    this.agentCode = this.agentCodeMap.get('playground')!;

    const combinedPrompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
    const response = await this.client.callAgent({
      agentCode: this.agentCode,
      query: combinedPrompt,
    });

    const textBlock = response.data?.answer;
    logger.info(`generate response: ${textBlock}`);
    return textBlock || '';
  }

  async selectTables(prompt: string): Promise<string> {
    this.agentCode = this.agentCodeMap.get('nl2sql_rel_table')!;

    const response = await this.client.callAgent({
      agentCode: this.agentCode,
      query: `${prompt}`,
    });

    // const cwd = process.cwd();
    // const filePath = join(cwd, "table_prompt.md");
    // writeFileSync(filePath, prompt, { encoding: 'utf-8' });

    const textBlock = response.data?.answer;
    logger.info(`selectTables response: ${textBlock}`);
    return textBlock || '[]';
  }

  async generateSQL(prompt: string): Promise<string> {
    // const cwd = process.cwd();
    // const filePath = join(cwd, "user_prompt.md");
    // writeFileSync(filePath, prompt, { encoding: 'utf-8' });
    this.agentCode = this.agentCodeMap.get('nl2sql_query')!;

    const response = await this.client.callAgent({
      agentCode: this.agentCode,
      query: `${prompt}`,
    });

    const textBlock = response.data?.answer;
    console.log('============ textBlock ==============');
    console.log(textBlock);
    console.log('==========================');
    return textBlock;
  }
}
