import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';

const router = Router();

/**
 * @openapi
 * /api/tenant/profile:
 *   get:
 *     summary: Get tenant profile (sender info for campaign emails)
 *     tags: [Tenant]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tenant profile
 */
router.get('/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.user.tenantId },
    select: {
      name: true,
      website: true,
      contactPersonName: true,
      contactPersonTitle: true,
      contactPersonEmail: true,
      contactPersonPhone: true,
    },
  });

  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  res.json(tenant);
});

/**
 * @openapi
 * /api/tenant/profile:
 *   put:
 *     summary: Update tenant profile (sender info for campaign emails)
 *     tags: [Tenant]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               website:
 *                 type: string
 *               contactPersonName:
 *                 type: string
 *               contactPersonTitle:
 *                 type: string
 *               contactPersonEmail:
 *                 type: string
 *               contactPersonPhone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated tenant profile
 */
router.put('/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const {
    name, website,
    contactPersonName, contactPersonTitle,
    contactPersonEmail, contactPersonPhone,
  } = req.body;

  const tenant = await prisma.tenant.update({
    where: { id: req.user.tenantId },
    data: {
      ...(name               !== undefined ? { name }               : {}),
      ...(website            !== undefined ? { website }            : {}),
      ...(contactPersonName  !== undefined ? { contactPersonName }  : {}),
      ...(contactPersonTitle !== undefined ? { contactPersonTitle } : {}),
      ...(contactPersonEmail !== undefined ? { contactPersonEmail } : {}),
      ...(contactPersonPhone !== undefined ? { contactPersonPhone } : {}),
    },
    select: {
      name: true,
      website: true,
      contactPersonName: true,
      contactPersonTitle: true,
      contactPersonEmail: true,
      contactPersonPhone: true,
    },
  });

  res.json(tenant);
});

export default router;
