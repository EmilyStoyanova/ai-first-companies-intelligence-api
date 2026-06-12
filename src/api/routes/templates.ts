import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// GET /api/templates — list all templates for the authenticated tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json(templates);
  } catch (err) {
    console.error('[templates/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates — create a new template
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  const { name, subject, body, isDefault } = req.body as {
    name?: string;
    subject?: string;
    body?: string;
    isDefault?: boolean;
  };

  if (!name?.trim() || !subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: 'name, subject, and body are required' });
    return;
  }

  try {
    const template = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.emailTemplate.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.emailTemplate.create({
        data: {
          tenantId,
          name: name.trim(),
          subject: subject.trim(),
          body: body.trim(),
          isDefault: Boolean(isDefault),
        },
      });
    });
    res.status(201).json(template);
  } catch (err) {
    console.error('[templates/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/templates/:id — update a template
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  const id = String(req.params.id);
  const { name, subject, body, isDefault } = req.body as {
    name?: string;
    subject?: string;
    body?: string;
    isDefault?: boolean;
  };

  try {
    const existing = await prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const template = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.emailTemplate.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.emailTemplate.update({
        where: { id },
        data: {
          ...(name    !== undefined ? { name:    name.trim()    } : {}),
          ...(subject !== undefined ? { subject: subject.trim() } : {}),
          ...(body    !== undefined ? { body:    body.trim()    } : {}),
          ...(isDefault !== undefined ? { isDefault: Boolean(isDefault) } : {}),
        },
      });
    });
    res.json(template);
  } catch (err) {
    console.error('[templates/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id — delete a template
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  const id = String(req.params.id);

  try {
    const existing = await prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    await prisma.emailTemplate.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    console.error('[templates/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/templates/:id/default — set this template as the default for the tenant
router.put('/:id/default', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;
  const id = String(req.params.id);

  try {
    const existing = await prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const template = await prisma.$transaction(async (tx) => {
      await tx.emailTemplate.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.emailTemplate.update({
        where: { id },
        data: { isDefault: true },
      });
    });
    res.json(template);
  } catch (err) {
    console.error('[templates/set-default]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
