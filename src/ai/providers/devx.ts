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
      당신은 SQL 전문가입니다. 
      제공된 스키마와 자연어 요청을 기반으로 유효한 SQL 쿼리만 생성하세요. 
      설명이나 마크다운 형식 없이 오직 SQL 쿼리만 반환하세요.
      `;
    logger.info("==========================");
    logger.info(prompt);
    logger.info("==========================");
    
    // const cwd = process.cwd();
    // const filePath = join(cwd, "user_prompt.md");
    // writeFileSync(filePath, prompt, { encoding: 'utf-8' });

    const merge_prompt = system_prompt + prompt;
    const response = await this.client.callAgent({
      agentCode: this.model,
      query: `${merge_prompt}`,
    });

    const textBlock = response.data?.answer;
    console.log("============ textBlock ==============");
    console.log(textBlock);
    console.log("==========================");
    return textBlock;
  }

  async selectTables(prompt: string): Promise<string> {
    const system_prompt =
      `#역할
      당신은 데이터베이스 스키마 전문가입니다. 
      제공된 테이블 목록과 사용자 쿼리를 분석하여 관련 테이블명의 JSON 배열만 반환하세요. 
      설명이나 SQL 없이 JSON 배열만 반환하세요. 예시: ["orders", "customers", "order_items"]
      `;
    
    const merge_prompt = system_prompt + prompt;
    const response = await this.client.callAgent({
      agentCode: this.model,
      query: `${merge_prompt}\n${prompt}`,
    });

    const textBlock = response.data?.answer;
    logger.info(`selectTables response: ${textBlock}`);
    return textBlock || '[]';
  }
}
