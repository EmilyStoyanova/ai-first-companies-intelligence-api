import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireAdmin } from '../../middleware/auth';

const router = Router();

// GET /api/admin/users — all users with current-month usage
router.get('/users', requireAuth, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const month = new Date().toISOString().slice(0, 7);

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        monthlyDomainLimit: true,
        createdAt: true,
        tenantId: true,
        monthlyUsage: {
          where: { month },
          select: { domainsUsed: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      monthlyDomainLimit: u.monthlyDomainLimit,
      createdAt: u.createdAt,
      tenantId: u.tenantId,
      domainsUsedThisMonth: u.monthlyUsage[0]?.domainsUsed ?? 0,
    })));
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/users/:id — update role and/or monthlyDomainLimit
router.patch('/users/:id', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const { role, monthlyDomainLimit } = req.body as {
    role?: string;
    monthlyDomainLimit?: number | null;
  };

  if (role !== undefined && !['USER', 'ADMIN'].includes(role)) {
    res.status(400).json({ error: 'role must be USER or ADMIN' });
    return;
  }

  if (
    monthlyDomainLimit !== undefined &&
    monthlyDomainLimit !== null &&
    (!Number.isInteger(monthlyDomainLimit) || monthlyDomainLimit < 0)
  ) {
    res.status(400).json({ error: 'monthlyDomainLimit must be a non-negative integer or null' });
    return;
  }

  try {
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined ? { role: role as 'USER' | 'ADMIN' } : {}),
        ...(monthlyDomainLimit !== undefined ? { monthlyDomainLimit } : {}),
      },
      select: { id: true, email: true, role: true, monthlyDomainLimit: true },
    });

    res.json(updated);
  } catch (err) {
    console.error('[admin/users/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
