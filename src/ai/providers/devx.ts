// @ts-ignore
import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';
import { logger } from '../../logger/index.js';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';


export class DevX implements AIProvider {
  private client: DevXSDK;
  private agentCode: string;

  constructor(apiKey: string, agentCode?: string) {
    this.client = new DevXSDK();
    this.agentCode = agentCode || 'playground';
  }

  async generateSQL(prompt: string): Promise<string> {
    // const cwd = process.cwd();
    // const filePath = join(cwd, "user_prompt.md");
    // writeFileSync(filePath, prompt, { encoding: 'utf-8' });

    const response = await this.client.callAgent({
      agentCode: "custom_170def4091144a45a99eb302458321ed", // 백화점CX팀_자연어기반 SQL생성기
      query: `${prompt}`,
    });

    const textBlock = response.data?.answer;
    console.log("============ textBlock ==============");
    console.log(textBlock);
    console.log("==========================");
    return textBlock;
  }

  async selectTables(prompt: string): Promise<string> {
    const response = await this.client.callAgent({
      agentCode: "custom_e81685f388d442548dce9b49ebad037e",  // 백화점CX팀_자연어기반 연관 테이블 조회
      query: `${prompt}`,
    });

    // const cwd = process.cwd();
    // const filePath = join(cwd, "table_prompt.md");
    // writeFileSync(filePath, prompt, { encoding: 'utf-8' });

    const textBlock = response.data?.answer;
    logger.info(`selectTables response: ${textBlock}`);
    return textBlock || '[]';
  }
}
