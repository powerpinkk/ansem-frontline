export const budgetBinding = { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ allowed:true }) }) };
