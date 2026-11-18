import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors.js';
import { dynamicRoutingRuleSchema, rulesEngine } from '../../routing/rules-engine.js';

export const upsertRulesBodySchema = z.object({
  rules: z.array(dynamicRoutingRuleSchema),
});

export const rulesRouter: Router = Router();

// POST /routing/rules
rulesRouter.post('/routing/rules', async (req, res, next) => {
  try {
    const parseResult = upsertRulesBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError('Invalid routing rules configuration payload', parseResult.error.format());
    }

    rulesEngine.setRules(parseResult.data.rules);
    res.status(200).json({
      message: 'Dynamic routing rules successfully updated',
      activeRuleCount: rulesEngine.getRules().length,
      rules: rulesEngine.getRules(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /routing/rules
rulesRouter.get('/routing/rules', async (_req, res, next) => {
  try {
    res.status(200).json({
      activeRuleCount: rulesEngine.getRules().length,
      rules: rulesEngine.getRules(),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /routing/rules
rulesRouter.delete('/routing/rules', async (_req, res, next) => {
  try {
    rulesEngine.clearRules();
    res.status(200).json({
      message: 'All dynamic routing rules cleared. Default cost-aware routing restored.',
      activeRuleCount: 0,
    });
  } catch (err) {
    next(err);
  }
});
