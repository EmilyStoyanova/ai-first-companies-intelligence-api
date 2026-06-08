import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { StorageService } from './storage';

interface TeamMember { name: string; position?: string; email?: string; linkedin?: string; }

function serializeTeam(raw: unknown): string {
  if (!raw) return '';
  const arr: TeamMember[] = Array.isArray(raw) ? raw as TeamMember[] : [];
  return arr
    .map((m) => {
      let s = m.name;
      if (m.position) s += ` (${m.position})`;
      if (m.email)    s += ` <${m.email}>`;
      return s;
    })
    .join('; ');
}

function serializeTeamLinkedIn(raw: unknown): string {
  if (!raw) return '';
  const arr: TeamMember[] = Array.isArray(raw) ? raw as TeamMember[] : [];
  return arr
    .map((m) => m.linkedin)
    .filter((url): url is string => Boolean(url))
    .join(' | ');
}

interface ExportRow {
  domain: string;
  name: string;
  description: string;
  location: string;
  emails: string;
  phones: string;
  services: string;
  team: string;
  teamLinkedIn: string;
  facebook: string;
  linkedin: string;
  socialLinks: string;   // other platforms: twitter, instagram, youtube
  completionScore: number;
  crawlStatus: string;
  crawlNote: string;
  emailSubject: string;
  outreachMessage: string;
}

async function fetchRows(batchId: string, tenantId: string): Promise<ExportRow[]> {
  const companies = await prisma.company.findMany({
    where: {
      tenantCompanies: { some: { tenantId, sourceBatchId: batchId, excluded: false } },
    },
    include: { profile: true, personalizedContent: true },
  });

  return companies.map((c) => ({
    domain: c.domain,
    name: c.profile?.name ?? c.name ?? '',
    description: c.profile?.description ?? '',
    location: c.profile?.location ?? '',
    emails: Array.isArray(c.profile?.emails) ? (c.profile.emails as string[]).join(', ') : '',
    phones: Array.isArray(c.profile?.phones) ? (c.profile.phones as string[]).join(', ') : '',
    services: Array.isArray(c.profile?.services) ? (c.profile.services as string[]).join(', ') : '',
    team: serializeTeam(c.profile?.team),
    teamLinkedIn: serializeTeamLinkedIn(c.profile?.team),
    facebook:    ((c.profile?.socialLinks ?? {}) as Record<string, string>)['facebook']  ?? '',
    linkedin:    ((c.profile?.socialLinks ?? {}) as Record<string, string>)['linkedin']  ?? '',
    socialLinks: Object.entries((c.profile?.socialLinks ?? {}) as Record<string, string>)
      .filter(([k, v]) => v && k !== 'facebook' && k !== 'linkedin')
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | '),
    completionScore: c.profile?.completionScore ?? 0,
    crawlStatus: c.crawlStatus,
    crawlNote:   c.crawlNote ?? '',
    emailSubject:    c.personalizedContent?.emailSubject    ?? '',
    outreachMessage: c.personalizedContent?.fullMessage     ?? '',
  }));
}

export const ExportService = {
  async exportBatch(
    batchId: string,
    tenantId: string,
    format: 'csv' | 'xlsx'
  ): Promise<string> {
    const rows = await fetchRows(batchId, tenantId);
    const filename = `export-${batchId}-${Date.now()}.${format}`;
    const subdir = `exports/${tenantId}`;

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Companies');

      sheet.columns = [
        { header: 'Domain',                key: 'domain',          width: 30 },
        { header: 'Name',                  key: 'name',            width: 30 },
        { header: 'Description',           key: 'description',     width: 50 },
        { header: 'Location',              key: 'location',        width: 25 },
        { header: 'Emails',                key: 'emails',          width: 40 },
        { header: 'Phones',                key: 'phones',          width: 30 },
        { header: 'Services',              key: 'services',        width: 50 },
        { header: 'Team',                  key: 'team',            width: 60 },
        { header: 'Team LinkedIn Profiles',key: 'teamLinkedIn',    width: 60 },
        { header: 'Facebook',              key: 'facebook',        width: 45 },
        { header: 'LinkedIn',              key: 'linkedin',        width: 45 },
        { header: 'Other Social',          key: 'socialLinks',     width: 50 },
        { header: 'Completion Score',      key: 'completionScore', width: 18 },
        { header: 'Crawl Status',          key: 'crawlStatus',     width: 15 },
        { header: 'Crawl Note',            key: 'crawlNote',       width: 60 },
        { header: 'Email Subject',         key: 'emailSubject',    width: 50 },
        { header: 'Outreach Message',      key: 'outreachMessage', width: 80 },
      ];

      sheet.addRows(rows);

      const buffer = await workbook.xlsx.writeBuffer();
      return StorageService.save(subdir, filename, Buffer.from(buffer));
    } else {
      // CSV
      const headers = [
        'domain', 'name', 'description', 'location',
        'emails', 'phones', 'services', 'team', 'teamLinkedIn', 'facebook', 'linkedin', 'socialLinks',
        'completionScore', 'crawlStatus', 'crawlNote',
        'emailSubject', 'outreachMessage',
      ];

      const escape = (v: string | number) => {
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const lines = [
        headers.join(','),
        ...rows.map((r) =>
          headers.map((h) => escape((r as unknown as Record<string, string | number>)[h] ?? '')).join(',')
        ),
      ];

      return StorageService.save(subdir, filename, lines.join('\n'));
    }
  },
};
