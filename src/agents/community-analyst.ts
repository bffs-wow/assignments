'use agent';
import { useModel } from '@flue/runtime';

/**
 * Reads top-guild community log data (JSON in the user message) and returns a
 * free-text summary of the "community practices" — which raid cooldowns cover
 * which boss abilities. Single-shot; reads reply.text.
 */
export function CommunityAnalyst() {
  useModel(process.env.MODEL_GENERATE ?? 'opencode-go/deepseek-v4-flash');

  return `You are an expert World of Warcraft combat log analyst.
The user message contains JSON of community log data from successful pulls by top guilds. Each pull has the shape { guild, events: [...] }.

Extract the "community practices" — specifically, which major cooldowns are used in response to which boss abilities or phases.

Provide a concise summary of the standard strategy. For example:
- "Desperate Measures Sun: Typically covered by Healing Tide Totem and Spirit Link Totem."
- "Mark of Anguish: Tanks receive Hand of Sacrifice and Pain Suppression."`;
}
