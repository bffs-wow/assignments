const { GoogleGenAI, Type } = require('@google/genai');

/**
 * WCL Explorer Agent
 *
 * An autonomous agent equipped with a tool to explore the Warcraft Logs GraphQL API.
 * It can dynamically construct and execute GraphQL queries to find encounters,
 * spells, casts, and damage events.
 */
class WCLExplorerAgent {
  constructor(apiKey, wclClientId, wclClientSecret) {
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.wclClientId = wclClientId;
    this.wclClientSecret = wclClientSecret;
    this.token = null;
  }

  // A mock for authenticating with WCL (Client Credentials flow)
  async authenticate() {
    if (!this.wclClientId || !this.wclClientSecret) {
      console.warn("WCL credentials missing, WCL Explorer will run in mock mode.");
      return;
    }
    // In a real scenario, we'd POST to https://www.warcraftlogs.com/oauth/token
    this.token = "mock_wcl_token";
  }

  // The function that the AI can call
  async executeWCLQuery(query) {
    console.log(`\n[WCL Explorer] Executing GraphQL Query:\n${query}\n`);

    // In a real scenario, this would use fetch() or axios to query the WCL API:
    // https://www.warcraftlogs.com/api/v2/client
    // with Authorization: Bearer ${this.token}

    // Mock response based on likely queries
    if (query.includes("reportData") && query.includes("events")) {
      return JSON.stringify({
        data: {
          reportData: {
            report: {
              events: {
                data: [
                  { type: "cast", abilityGameID: 135739, sourceID: 1, targetID: -1, timestamp: 15000 },
                  { type: "damage", abilityGameID: 135739, amount: 250000, timestamp: 15050 }
                ]
              }
            }
          }
        }
      });
    }

    return JSON.stringify({ error: "Mock data not available for this query." });
  }

  async explore(userPrompt) {
    console.log(`Starting WCL Explorer Agent with prompt: "${userPrompt}"`);

    await this.authenticate();

    // Define the tool for Gemini
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'executeWCLQuery',
            description: 'Executes a GraphQL query against the Warcraft Logs v2 API. Returns the JSON response.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                query: {
                  type: Type.STRING,
                  description: 'The GraphQL query string to execute.',
                },
              },
              required: ['query'],
            },
          },
        ],
      },
    ];

    const systemInstruction = `You are an expert World of Warcraft Combat Log analyst.
You have access to the executeWCLQuery tool to interact with the Warcraft Logs GraphQL API.
Your goal is to answer the user's questions about a raid encounter by writing and executing queries.
Analyze the returned data and provide a concise answer.`;

    try {
      // Create a chat session with the tool
      const chat = this.ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          tools: tools,
          systemInstruction: systemInstruction
        }
      });

      // Send the initial user prompt
      let response = await chat.sendMessage({ message: userPrompt });

      // Handle function calls if the model decides to use the tool
      while (response.functionCalls && response.functionCalls.length > 0) {
        const call = response.functionCalls[0];
        if (call.name === 'executeWCLQuery') {
          const queryResult = await this.executeWCLQuery(call.args.query);

          // Send the function response back to the model
          response = await chat.sendMessage({
            message: [{
              functionResponse: {
                name: 'executeWCLQuery',
                response: { result: queryResult }
              }
            }]
          });
        }
      }

      return response.text;
    } catch (error) {
      console.error("Error in WCL Explorer Agent:", error);
      throw error;
    }
  }
}

module.exports = WCLExplorerAgent;
