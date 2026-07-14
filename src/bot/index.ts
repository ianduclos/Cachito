export { binomialAtLeast, binomialPmf, evaluateBidDistribution } from './probability'
export { adjustSupportForOpponent, buildOpponentProfile } from './opponentModel'
export { collectRunChampions, mergeChampionShelf } from './championArchive'
export { chooseBotAction, createProbabilityPolicy, isChoiceLegal, randomLegalPolicy } from './policies'
export { runBotBatch, runBotMatch, runSeatBalancedDuel } from './simulator'
export { createAdversarialPolicyLeague, runAdversarialTournament } from './adversarial'
export {
  LearningCancelledError,
  createInitialLearningPopulation,
  evolveLearningPopulation,
  runAdversarialLearning,
  runLearningGeneration,
  validateLearningConfig,
} from './learning'
export type {
  BotChoice,
  BotActionResult,
  BotCandidateTrace,
  BotActionValueTrace,
  BotDecisionReason,
  BotDecisionTrace,
  BotObservation,
  BotPolicy,
  PublicActionEntry,
  PublicRoundOutcome,
} from './types'
export type { ArchivedChampion, ChampionRole } from './championArchive'
export type {
  BatchResult,
  BotSeat,
  MatchOptions,
  MatchResult,
  DuelResult,
} from './simulator'
export type { ProbabilityPolicyOptions } from './policies'
export type {
  AdversarialTournamentOptions,
  AdversarialTournamentReport,
  CalibrationStats,
  ChallengeStats,
  PolicyTournamentStats,
} from './adversarial'
export type {
  LearningCandidateResult,
  LearningConfig,
  LearningControl,
  LearningGenerationInput,
  LearningGenerationResult,
  LearningGenerationSnapshot,
  LearningPopulationCandidate,
  LearningRunResult,
  LearningRunSnapshot,
  PolicyGenome,
} from './learning'
