import { DevXSDK } from '@devx/mcp-sdk';
import type { AIProvider } from './openai.js';
import { logger } from '../../logger/index.js';

export class DevX implements AIProvider {
  private client: DevXSDK;
  private agentCode: string;
  private agentCodeMap = new Map<string, string>([
    ['playground', 'playground'],
    ['nl2sql_infer_fk', 'custom_8de2c75456004a7f84b9b9d5d0a60c21'],   // 백화점CX팀_FK 정보 추론 프롬프트
    ['nl2sql_rel_table', 'custom_e81685f388d442548dce9b49ebad037e'],  // 백화점CX팀_자연어기반 연관 테이블 조회
    ['nl2sql_query', 'custom_170def4091144a45a99eb302458321ed']       // 백화점CX팀_자연어기반 SQL생성기
  ]);

  constructor(apiKey: string, agentKey?: string) {
    this.client = new DevXSDK();
    this.agentCode = this.agentCodeMap.get(agentKey || 'playground')!;
  }

  // 테이블/컬럼을 통한 FK정보 생성기
  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    this.agentCode = this.agentCodeMap.get('nl2sql_rel_table')!;

    const combinedPrompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
    const response = await this.client.callAgent({
      agentCode: this.agentCode,
      query: combinedPrompt,
    });

    const textBlock = response.data?.answer;
    logger.info(`generate response: ${textBlock}`);
    return textBlock || '';
  }

  // 테이블 리스트 추론
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

  // 자연어 기반 SQL 생성
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
