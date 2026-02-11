import type { Config } from '../config/index.js';
import { OpenAIProvider, type AIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { DevX } from './providers/devx.js';

export function createAIClient(config: Config): AIProvider {
  const { provider, openaiApiKey, anthropicApiKey, devxApiKey, model } = config.ai;

  if (provider === 'devx') {
    if (!devxApiKey) {
      throw new Error('DEVX_API_KEY is required for DEVX provider');
    }
    return new DevX(devxApiKey, model);
  }
  
  if (provider === 'anthropic') {
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
    }
    return new AnthropicProvider(anthropicApiKey, model);
  }

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI provider');
  }
  return new OpenAIProvider(openaiApiKey, model);
}

export type { AIProvider };
