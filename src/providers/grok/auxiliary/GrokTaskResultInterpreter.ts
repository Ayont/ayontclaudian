import type {
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
} from '../../../core/providers/types';

/**
 * Grok does not expose Claude-style async subagent task results through its
 * stream-json output, so the interpreter returns inert defaults (matching the
 * antigravity/opencode/pi interpreters).
 */
export class GrokTaskResultInterpreter implements ProviderTaskResultInterpreter {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  }

  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  }

  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ): ProviderTaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  }
}
