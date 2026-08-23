import type {
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
} from '../../../core/providers/types';

/**
 * Hermes' `delegate_task` returns its result inline rather than through
 * Claudian's async subagent protocol, so there is nothing to interpret.
 */
export class HermesTaskResultInterpreter implements ProviderTaskResultInterpreter {
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
