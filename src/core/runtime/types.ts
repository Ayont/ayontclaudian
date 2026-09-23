import type { DesktopContextSource } from '../../features/chat/services/desktopContext';
import type { BrowserSelectionContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import type { EditorSelectionContext } from '../../utils/editor';
import type {
  ApprovalDecision,
  Conversation,
  ExitPlanModeCallback,
  ImageAttachment,
  OutputSurface,
  StreamChunk,
} from '../types';

export type { OutputSurface } from '../types';

export interface ApprovalDecisionOption {
  label: string;
  description?: string;
  value: string;
  decision?: ApprovalDecision;
}

export interface ApprovalNetworkContext {
  host: string;
  protocol: string;
}

export interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
  decisionOptions?: ApprovalDecisionOption[];
  networkApprovalContext?: ApprovalNetworkContext;
  additionalPermissions?: unknown;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
  options?: ApprovalCallbackOptions,
) => Promise<ApprovalDecision>;

export type AskUserQuestionCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, string | string[]> | null>;

export interface ChatTurnRequest {
  text: string;
  /** Ephemeral explicit selection factory; functions are never JSON persisted. */
  desktopContext?: () => readonly DesktopContextSource[];
  attachments?: { name: string; relPath: string }[];
  /** Application-selected presentation target for this turn. */
  outputSurface?: OutputSurface;
  images?: ImageAttachment[];
  currentNotePath?: string;
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  externalContextPaths?: string[];
  enabledMcpServers?: Set<string>;
  /**
   * RPC goal providers apply this with this very turn (`/goal` set/resume).
   * Carried on the turn, not queued on the runtime, so it can never attach to
   * a different message.
   */
  nativeGoal?: NativeGoalAction;
}

export type NativeGoalAction =
  | { kind: 'set'; objective: string; tokenBudget?: number | null }
  | { kind: 'resume' };

export interface PreparedChatTurn {
  request: ChatTurnRequest;
  persistedContent: string;
  prompt: string;
  isCompact: boolean;
  mcpMentions: Set<string>;
}

export interface ChatRuntimeQueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

export interface ChatRuntimeEnsureReadyOptions {
  allowSessionCreation?: boolean;
  force?: boolean;
}

export type ChatRuntimeConversationState = Pick<
  Conversation,
  'sessionId' | 'providerState'
>;

export interface SessionUpdateResult {
  updates: Partial<Conversation>;
}

export interface ChatRewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

export type ChatRewindMode = 'conversation' | 'code-and-conversation';

export interface SubagentRuntimeState {
  hasRunning: boolean;
}

export interface ChatTurnMetadata {
  userMessageId?: string;
  assistantMessageId?: string;
  wasSent?: boolean;
  planCompleted?: boolean;
}

export interface AutoTurnResult {
  chunks: StreamChunk[];
  metadata: ChatTurnMetadata;
}

export type AutoTurnCallback = (result: AutoTurnResult) => void | Promise<void>;

export type {
  ApprovalDecision,
  ExitPlanModeCallback,
};
