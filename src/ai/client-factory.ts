import type { Config } from '../config/index.js';
import { OpenAIProvider, type AIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';

export function createAIClient(config: Config): AIProvider {
  const { provider, openaiApiKey, anthropicApiKey, model } = config.ai;

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
