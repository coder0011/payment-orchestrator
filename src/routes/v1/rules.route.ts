import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors.js';
import { dynamicRoutingRuleSchema, rulesEngine } from '../../routing/rules-engine.js';

export const upsertRulesBodySchema = z.object({
  rules: z.array(dynamicRoutingRuleSchema),
});

export const rulesRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/routing/rules
  fastify.post('/routing/rules', async (request, reply) => {
    const parseResult = upsertRulesBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Invalid routing rules configuration payload', parseResult.error.format());
    }

    rulesEngine.setRules(parseResult.data.rules);
    return reply.status(200).send({
      message: 'Dynamic routing rules successfully updated',
      activeRuleCount: rulesEngine.getRules().length,
      rules: rulesEngine.getRules(),
    });
  });

  // GET /v1/routing/rules
  fastify.get('/routing/rules', async (_request, reply) => {
    return reply.status(200).send({
      activeRuleCount: rulesEngine.getRules().length,
      rules: rulesEngine.getRules(),
    });
  });

  // DELETE /v1/routing/rules
  fastify.delete('/routing/rules', async (_request, reply) => {
    rulesEngine.clearRules();
    return reply.status(200).send({
      message: 'All dynamic routing rules cleared. Default cost-aware routing restored.',
      activeRuleCount: 0,
    });
  });
};
