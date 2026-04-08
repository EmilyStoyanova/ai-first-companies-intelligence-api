import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';

const router = Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new user and tenant
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, tenantName]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@company.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: mysecretpassword
 *               tenantName:
 *                 type: string
 *                 example: My Company
 *     responses:
 *       201:
 *         description: User registered, JWT returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 tenantId: { type: string }
 *                 userId: { type: string }
 *       400:
 *         description: Validation error or email already taken
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password, tenantName } = req.body;

  if (!email || !password || !tenantName) {
    res.status(400).json({ error: 'email, password and tenantName are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(400).json({ error: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Create tenant + user in a transaction
  const { user, tenant } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: tenantName },
    });
    const user = await tx.user.create({
      data: { email, passwordHash, tenantId: tenant.id },
    });
    return { user, tenant };
  });

  const token = jwt.sign(
    { sub: user.id, tenantId: tenant.id, email: user.email },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token, tenantId: tenant.id, userId: user.id });
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@company.com
 *               password:
 *                 type: string
 *                 example: mysecretpassword
 *     responses:
 *       200:
 *         description: Login successful, JWT returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 tenantId: { type: string }
 *                 userId: { type: string }
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { sub: user.id, tenantId: user.tenantId, email: user.email },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  res.json({ token, tenantId: user.tenantId, userId: user.id });
});

export default router;
