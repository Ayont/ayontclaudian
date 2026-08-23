/**
 * Compatibility shim: the goal loop runner moved to core so every provider can
 * drive it, not just Cline. The names stay exported here for existing imports.
 */
export {
  type GoalLoopRunnerDeps as ClineGoalLoopDeps,
  type GoalLoopRunnerResult as ClineGoalLoopResult,
  runGoalLoopRunner as runClineGoalLoop,
} from '../../../core/conversation/goalLoopRunner';