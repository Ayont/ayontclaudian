import type { PermissionUpdate, PermissionUpdateDestination } from '@anthropic-ai/claude-agent-sdk';

import { getActionPattern } from '../../../core/security/ApprovalManager';

function hasNonEmptyRuleScope(rule: { ruleContent?: string }): boolean {
  return typeof rule.ruleContent === 'string' && rule.ruleContent.trim().length > 0;
}

function isNonEmptyDerivedScope(pattern: string | null): boolean {
  return Boolean(pattern && !pattern.startsWith('{'));
}

/**
 * Persistent permission updates for "immer erlauben".
 * "Einmal erlauben" stays invocation-scoped — writing a session rule would
 * silently upgrade it to the rest of the session (YishenTu/claudian #1100).
 */
export function buildPermissionUpdates(
  toolName: string,
  input: Record<string, unknown>,
  decision: 'allow' | 'allow-always',
  suggestions?: PermissionUpdate[]
): PermissionUpdate[] {
  if (decision !== 'allow-always') {
    return [];
  }

  const destination: PermissionUpdateDestination = 'projectSettings';
  const processed: PermissionUpdate[] = [];
  let hasRuleUpdate = false;

  if (suggestions) {
    for (const suggestion of suggestions) {
      if (suggestion.type === 'addRules' || suggestion.type === 'replaceRules') {
        const scopedRules = suggestion.rules.filter(hasNonEmptyRuleScope);
        if (scopedRules.length === 0) {
          continue;
        }
        hasRuleUpdate = true;
        processed.push({
          ...suggestion,
          rules: scopedRules,
          behavior: 'allow',
          destination,
        });
      } else {
        processed.push(suggestion);
      }
    }
  }

  if (!hasRuleUpdate) {
    const pattern = getActionPattern(toolName, input);
    if (!isNonEmptyDerivedScope(pattern)) {
      return processed;
    }
    const ruleValue: { toolName: string; ruleContent?: string } = { toolName };
    if (pattern) {
      ruleValue.ruleContent = pattern;
    }

    processed.unshift({
      type: 'addRules',
      behavior: 'allow',
      rules: [ruleValue],
      destination,
    });
  }

  return processed;
}
