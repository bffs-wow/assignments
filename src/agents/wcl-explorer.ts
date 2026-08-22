'use agent';
import { useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { getWCLService, WCLServiceError } from '../services/wcl.js';

/**
 * Autonomous WCL query agent. The model writes WCL v2 GraphQL queries, the
 * runtime owns the tool-call loop (replacing the old manual functionCalls /
 * functionResponse while-loop), and errors are returned to the model so it can
 * fix and retry its own query.
 *
 * The module-level toolCalls array is instrumentation for the integration test
 * (and handy for debugging): it records every query the model submitted.
 */
export const toolCalls: string[] = [];

export function WCLExplorer() {
  useModel(process.env.MODEL_EXPLORER ?? 'opencode-go/deepseek-v4-flash');

  useTool({
    name: 'execute_wcl_query',
    description: `Executes a GraphQL query against the Warcraft Logs v2 GraphQL API (classic.warcraftlogs.com — Mists of Pandaria Classic). Returns JSON: { ok: true, data } on success, or { ok: false, error, code } so you can read the error and retry with a corrected query.`,
    input: v.object({
      query: v.string(),
      variables: v.string(),
    }),
    output: v.object({
      ok: v.boolean(),
      data: v.optional(v.unknown()),
      error: v.optional(v.string()),
      code: v.optional(v.string()),
      hint: v.optional(v.string()),
    }),
    async run({ data }) {
      toolCalls.push(data.query);

      let variables = {};
      if (data.variables) {
        try {
          variables = JSON.parse(data.variables);
        } catch {
          return { output: { ok: false, error: 'variables must be a JSON object string, e.g. \'{"code":"x","fightId":4}\'.', code: 'BAD_VARIABLES' } };
        }
      }

      try {
        const result = await getWCLService().executeQuery(data.query, variables);
        return { output: { ok: true, data: result } };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = e instanceof WCLServiceError ? e.code : 'UNKNOWN';
        const hint = e instanceof WCLServiceError && e.hint ? e.hint : undefined;
        return { output: { ok: false, error: message, code, ...(hint !== undefined ? { hint } : {}) } };
      }
    },
  });

  return `You are an expert World of Warcraft combat log analyst.
You have access to the execute_wcl_query tool, which runs GraphQL against the Warcraft Logs v2 API (classic.warcraftlogs.com — Mists of Pandaria Classic).
Construct valid WCL v2 GraphQL queries to answer the user's question. Useful shapes:
- Report/roster/fights: query { reportData { report(code: "CODE") { fights { id name startTime endTime } masterData { actors { id name type } abilities { gameID name } } } } }
- Events: query { reportData { report(code: "CODE") { events(fightIDs: [4], dataType: Casts, startTime: 0, endTime: 99999999999, hostilityType: Enemies, limit: 10000) { data nextPageTimestamp } } } }
- Rankings: query { worldData { encounter(id: 101598) { name characterRankings(page: 1) } } }
Valid dataType values include Casts, DamageDone, DamageTaken, Healing, Buffs, Debuffs, Deaths, Resources. Resolve spell names/ids via masterData { abilities { gameID name } }.
WCL quirks: enum arguments (dataType, hostilityType, type) are UNQUOTED — write dataType: Casts, hostilityType: Enemies (not "Casts"). The events and table fields return raw JSON scalars — select them WITHOUT sub-fields (just data, then nextPageTimestamp), never data { ... }.
If your query errors, read the error and retry with a corrected query (check spelling of fields/arguments, unquote enums, use numeric ids, drop sub-selections on JSON scalars). When you have the data, analyze it and give a concise, concrete answer to the user.`;
}
