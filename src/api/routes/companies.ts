import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';

const router = Router();

/**
 * @openapi
 * /api/companies/{domain}:
 *   get:
 *     summary: Get a company and its extracted profile by domain
 *     tags: [Companies]
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         example: google.com
 *     responses:
 *       200:
 *         description: Company with profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Company'
 *       404:
 *         description: Company not found
 */
// GET /companies/:domain
router.get('/:domain', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  // URL-decode in case domain comes encoded
  const domain = decodeURIComponent(String(req.params.domain)).toLowerCase();

  try {
    const company = await prisma.company.findFirst({
      where: {
        domain,
        tenantCompanies: { some: { tenantId } },
      },
      include: { profile: true },
    });

    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    res.json(company);
  } catch (err) {
    console.error('[companies/:domain]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
