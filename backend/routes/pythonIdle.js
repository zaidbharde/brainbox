import { Router } from 'express';
import { pythonIdleSessionManager } from '../services/pythonIdleSessionManager.js';

const router = Router();

router.post('/session', async (_req, res, next) => {
  try {
    const session = await pythonIdleSessionManager.createSession();
    res.status(201).json({ success: true, ...session });
  } catch (error) {
    next(error);
  }
});

router.post('/execute', async (req, res, next) => {
  try {
    const { sessionId, line } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    if (typeof line !== 'string') {
      return res.status(400).json({ success: false, error: 'line must be a string' });
    }

    const result = await pythonIdleSessionManager.executeLine(sessionId, line);
    if (!result.success && /Session not found|not active|terminated|timed out/i.test(result.error)) {
      return res.status(410).json(result);
    }

    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/restart', async (req, res, next) => {
  try {
    const { sessionId } = req.body || {};
    const restarted = await pythonIdleSessionManager.restartSession(sessionId);
    res.json({ success: true, ...restarted });
  } catch (error) {
    next(error);
  }
});

router.post('/exit', (req, res) => {
  const { sessionId } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  pythonIdleSessionManager.terminateSession(sessionId);
  return res.json({ success: true });
});

export default router;
