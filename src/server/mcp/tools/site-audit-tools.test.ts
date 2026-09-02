import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runSiteAuditTool } from "./site-audit-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  startAudit: vi.fn(),
  resolveAuditLimitTier: vi.fn(),
  captureServerEvent: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/audit/services/AuditService", () => ({
  AuditService: {
    startAudit: mocks.startAudit,
    resolveAuditLimitTier: mocks.resolveAuditLimitTier,
  },
}));
vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: mocks.captureServerEvent,
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const toolContext = makeToolContext();

const parseArgs = (args: Record<string, unknown>) =>
  z.object(runSiteAuditTool.config.inputSchema).parse(args);

describe("run_site_audit MCP tool", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: projectId,
      domain: "openseo.so",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.resolveAuditLimitTier.mockResolvedValue("paid");
    mocks.startAudit.mockResolvedValue({ auditId: "audit_1" });
    mocks.captureServerEvent.mockResolvedValue(undefined);
  });

  it("crawls the project's own domain when no url is given", async () => {
    await runSiteAuditTool.handler(parseArgs({ projectId }), toolContext);

    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({ startUrl: "https://openseo.so" }),
    );
  });

  it("crawls the supplied url instead of the project's domain", async () => {
    await runSiteAuditTool.handler(
      parseArgs({ projectId, url: "https://docs.openseo.so/guides" }),
      toolContext,
    );

    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({ startUrl: "https://docs.openseo.so/guides" }),
    );
  });

  it("asks for a url when the project has no domain to fall back on", async () => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: projectId,
      domain: null,
      locationCode: 2840,
      languageCode: "en",
    });

    await expect(
      runSiteAuditTool.handler(parseArgs({ projectId }), toolContext),
    ).rejects.toThrow(/Provide a url or set the project's domain/);
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });
});
