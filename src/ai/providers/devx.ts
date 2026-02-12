// @ts-ignore
import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';
import { logger } from '../../logger/index.js';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';


export class DevX implements AIProvider {
  private client: DevXSDK;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new DevXSDK();
    this.model = model || 'playground';
  }

  async generateSQL(prompt: string): Promise<string> {
    const system_prompt = 
      `#역할
      당신은 SQL 전문가입니다. 제공된 스키마와 자연어 요청을 기반으로 유효한 SQL 쿼리만 생성하세요. 설명이나 마크다운 형식 없이 오직 SQL 쿼리만 반환하세요.
      `;
    logger.info("==========================");
    logger.info(prompt);
    logger.info("==========================");
    
    const cwd = process.cwd();
    const filePath = join(cwd, "user_prompt.md");
    writeFileSync(filePath, prompt, { encoding: 'utf-8' });

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
