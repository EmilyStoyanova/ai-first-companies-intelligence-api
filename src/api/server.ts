import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../lib/swagger';

import authRouter from './routes/auth';
import batchesRouter from './routes/batches';
import companiesRouter from './routes/companies';
import exportsRouter from './routes/exports';
import personaRouter from './routes/persona';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs.json', (_req, res) => res.json(swaggerSpec));

app.use('/api/auth', authRouter);
app.use('/api/batches', batchesRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/persona-searches', personaRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] Frontend  → http://localhost:3000`);
  console.log(`[server] API docs  → http://localhost:${PORT}/docs`);
});

export default app;
