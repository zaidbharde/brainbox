import express from 'express';
import cors from 'cors';
import compileRouter from './routes/compile.js';
import pythonIdleRouter from './routes/pythonIdle.js';
import sqlLabRouter from './routes/sqlLab.js';
import octaveLabRouter from './routes/octaveLab.js';
import androidLabRouter from './routes/androidLab.js';
import { androidArtifactPublicDir } from './services/androidLabService.js';
import { octavePlotPublicDir } from './services/octaveLabService.js';
import { pythonIdleSessionManager } from './services/pythonIdleSessionManager.js';

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'brainbox-backend' });
});

app.use('/api/compile', compileRouter);
app.use('/api/python-idle', pythonIdleRouter);
app.use('/api/sql-lab', sqlLabRouter);
app.use('/api/run-octave', octaveLabRouter);
app.use('/api/android-lab', androidLabRouter);
app.use('/api/octave-plots', express.static(octavePlotPublicDir, { index: false, fallthrough: true }));
app.use('/api/android-lab/artifacts', express.static(androidArtifactPublicDir, { index: false, fallthrough: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: 'Unexpected server error',
  });
});

app.listen(PORT, () => {
  console.log(`BrainBox backend listening on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  pythonIdleSessionManager.shutdownAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  pythonIdleSessionManager.shutdownAll();
  process.exit(0);
});
