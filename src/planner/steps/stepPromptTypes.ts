/**
 * System + user strings for a single planner chat turn (one step of the 3-step flow).
 */
export type StepChatPrompt = {
  readonly system: string;
  readonly user: string;
};
