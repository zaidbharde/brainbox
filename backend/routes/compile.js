import { Router } from 'express';
import { compileAndRun } from '../services/compileService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { language, code, stdin } = req.body || {};

    if (!language || typeof language !== 'string') {
      return res.status(400).json({ success: false, error: 'language is required' });
    }

    if (typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'code is required' });
    }

    if (stdin !== undefined && typeof stdin !== 'string') {
      return res.status(400).json({ success: false, error: 'stdin must be a string when provided' });
    }

    const result = await compileAndRun({ language, code, stdin: stdin || '' });
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
