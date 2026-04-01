import { Router } from 'express';
import { runOctaveCode } from '../services/octaveLabService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { code } = req.body || {};

    if (typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        output: '',
        error: 'code must be a string',
        plotPath: '',
        engine: 'Validation',
      });
    }

    const result = await runOctaveCode(code);
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
