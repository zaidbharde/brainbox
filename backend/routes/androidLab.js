import { Router } from 'express';
import {
  ensureAndroidBoxProject,
  getAndroidBoxArtifactPath,
  getAndroidBoxBuild,
  getAndroidBoxBuildSummary,
  getAndroidBoxProjectPayload,
  getAndroidBoxStatus,
  getAndroidBoxTree,
  listAndroidDevices,
  runAndroidBoxProject,
  startAndroidBoxBuild,
  syncAndroidBoxProject,
} from '../services/androidBoxService.js';

const router = Router();

router.get('/api/status', (_req, res) => {
  ensureAndroidBoxProject();
  res.json(getAndroidBoxStatus());
});

router.get('/api/tree', (_req, res) => {
  ensureAndroidBoxProject();
  res.json(getAndroidBoxTree());
});

router.get('/api/project', (_req, res) => {
  res.json(getAndroidBoxProjectPayload());
});

router.post('/api/project/sync', (req, res, next) => {
  try {
    res.json(syncAndroidBoxProject(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/api/build', (_req, res) => {
  const record = startAndroidBoxBuild(ensureAndroidBoxProject());
  res.json({ buildId: record.id });
});

router.get('/api/build/:id', (req, res) => {
  const summary = getAndroidBoxBuildSummary(req.params.id);
  if (!summary) {
    res.status(404).json({ error: 'Build not found' });
    return;
  }

  res.json(summary);
});

router.get('/api/build/:id/stream', (req, res) => {
  const record = getAndroidBoxBuild(req.params.id);
  if (!record) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let nextLogIndex = 0;
  const interval = setInterval(() => {
    const logChunk = record.logs.slice(nextLogIndex).join('');
    if (logChunk) {
      res.write(`data: ${JSON.stringify(logChunk)}\n\n`);
      nextLogIndex = record.logs.length;
    }

    if (record.status !== 'running') {
      res.write(`event: done\ndata: ${JSON.stringify(record.status)}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

router.get('/api/devices', async (_req, res) => {
  try {
    res.json(await listAndroidDevices());
  } catch (error) {
    res.status(500).json({
      devices: [],
      error: error instanceof Error ? error.message : 'Unable to list devices',
    });
  }
});

router.post('/api/run', async (req, res) => {
  try {
    const result = await runAndroidBoxProject(req.body?.deviceId);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to run Android Box project',
    });
  }
});

router.get('/api/artifacts/:filename', (req, res) => {
  const artifactPath = getAndroidBoxArtifactPath(req.params.filename);
  if (!artifactPath) {
    res.status(404).json({ error: 'Artifact not found' });
    return;
  }

  res.download(artifactPath);
});

export default router;
