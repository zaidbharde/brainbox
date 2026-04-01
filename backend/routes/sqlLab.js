import { Router } from 'express';
import { describeTable, executeSqlQuery, resetDatabase, showTables } from '../services/sqlLabService.js';

const router = Router();

router.post('/query', async (req, res, next) => {
  try {
    const { query } = req.body || {};

    if (typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'query must be a string',
      });
    }

    const result = await executeSqlQuery(query);
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/reset', async (_req, res, next) => {
  try {
    const result = await resetDatabase();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get('/tables', async (_req, res, next) => {
  try {
    const result = await showTables();
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get('/describe/:table', async (req, res, next) => {
  try {
    const result = await describeTable(req.params.table);
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
