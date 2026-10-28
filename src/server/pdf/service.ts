import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/server/supabase/admin";
import { renderPdf } from "./render";
import { requireAdmin } from "@/server/auth/admin";
import { createAuthClient } from "@/server/supabase/server";
import reportSchema from "../../../AI_REPORT_SCHEMA_RU_1_0.json";
import { AccountAccessError, requireDiagnosticRead } from "@/server/account/authorization";

const templateVersion = "stage12-1i";
type Row = Record<string, unknown>;
const transliterate = (value: string) => value.toLowerCase().replace(/[а-яё]/g, (char) => ({ а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" }[char] ?? char)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "company";

async function loadAuthorizedReport(reportId: string, userId: string) {
  const db = createAdminClient();
  const { data: report, error: reportError } = await db.from("ai_reports").select("id,diagnostic_id,version,status,structured_content").eq("id", reportId).maybeSingle();
  if (reportError) throw Error("pdf_prepare_failed");
  if (!report) throw new Error("pdf_access_denied");
  let diagnostic;
  try { diagnostic = await requireDiagnosticRead(report.diagnostic_id, userId); }
  catch (error) {
    if (error instanceof AccountAccessError) throw new Error("pdf_access_denied");
    throw error;
  }
  if (diagnostic.status !== "completed") throw new Error("pdf_access_denied");
  if (report.status !== "completed") throw new Error("pdf_report_not_ready");
  return { db, report, diagnostic };
}

function fileName(companyName: string, completedAt: string | null) {
  return `management-ai-audit-${transliterate(companyName)}-${new Date(completedAt ?? Date.now()).toISOString().slice(0, 10)}.pdf`;
}

const maxPdfBytes = 10 * 1024 * 1024;
const validReportId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const artifactColumns = "id,report_id,ai_report_version,format,template_version,status,content_base64,checksum";
type Context = Awaited<ReturnType<typeof loadAuthorizedReport>>;
type Authorize = () => Promise<Context>;
export type AdminPdfReady = { report_id: string; ai_report_version: number; template_version: string; artifact_id: string; checksum: string; status: "ready"; download_url: string };
type Prepared = { ready: AdminPdfReady; fileName: string; sourceDigest: string; reused: boolean };
const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
};

function savedContent(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("pdf_report_not_ready");
  const row = value as Row;
  if (Object.keys(row).some(k => !Object.hasOwn(reportSchema.properties, k))) throw Error("pdf_report_not_ready");
  for (const key of reportSchema.required) {
    const field = reportSchema.properties[key as keyof typeof reportSchema.properties];
    const v = row[key];
    if (field.type === "string") {
      if (typeof v !== "string" || v.length < 1) throw Error("pdf_report_not_ready");
    } else {
      const limits = field as { minItems: number; maxItems?: number };
      if (!Array.isArray(v) || v.length < limits.minItems || (limits.maxItems !== undefined && v.length > limits.maxItems) || v.some(x => typeof x !== "string" || x.length < 1)) throw Error("pdf_report_not_ready");
    }
  }
  return row as Record<string, string | string[]>;
}

/** This entry binds a real cookie session independently of the service-role DB client. */
async function adminActor() {
  const admin = await requireAdmin();
  const client = await createAuthClient();
  // Deliberately uncached: role/session revocation must be checked after rendering too.
  const { data, error } = await client.rpc("read_admin_console", { p_section: "identity" });
  if (error || !data || typeof data !== "object" || !("administrator" in data) || data.administrator !== true) throw Error("pdf_access_denied");
  return admin.user.id;
}

async function loadAdminAuthorizedReport(reportId: string): Promise<Context> {
  await adminActor();
  if (!validReportId(reportId)) throw Error("pdf_access_denied");
  const db = createAdminClient();
  const { data: report, error } = await db.from("ai_reports").select("id,diagnostic_id,version,status,structured_content").eq("id", reportId).maybeSingle();
  if (error) throw Error("pdf_prepare_failed");
  if (!report) throw Error("pdf_access_denied");
  const { data: diagnostic, error: diagnosticError } = await db.from("diagnostics").select("*").eq("id", report.diagnostic_id).maybeSingle();
  if (diagnosticError) throw Error("pdf_prepare_failed");
  if (!diagnostic || diagnostic.status !== "completed") throw Error("pdf_access_denied");
  if (report.status !== "completed") throw Error("pdf_report_not_ready");
  savedContent(report.structured_content);
  return { db, report, diagnostic };
}

async function artifactFor({ db, report }: Context) {
  // Do not filter out failed/wrong-version rows: their presence must deny overwrite.
  const { data, error } = await db.from("report_artifacts").select(artifactColumns).eq("report_id", report.id).eq("format", "pdf").eq("template_version", templateVersion).maybeSingle();
  if (error) throw Error("pdf_prepare_failed");
  return data;
}

function pdfBytes(encoded: string, checksum: string) {
  if (encoded.length > 4 * Math.ceil(maxPdfBytes / 3) || !/^[a-f0-9]{64}$/.test(checksum)) throw Error("pdf_integrity_failed");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > maxPdfBytes || bytes.toString("base64") !== encoded || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1")) || hash(bytes) !== checksum) throw Error("pdf_integrity_failed");
  return bytes;
}

function validatedArtifact(context: Context, artifact: Awaited<ReturnType<typeof artifactFor>>) {
  if (!artifact) throw Error("pdf_artifact_not_ready");
  if (artifact.report_id !== context.report.id || artifact.ai_report_version !== context.report.version || artifact.format !== "pdf" || artifact.template_version !== templateVersion || artifact.status !== "ready") throw Error("pdf_artifact_conflict");
  const bytes = pdfBytes(artifact.content_base64, artifact.checksum);
  const ready: AdminPdfReady = { report_id: context.report.id, ai_report_version: context.report.version, template_version: templateVersion, artifact_id: artifact.id, checksum: artifact.checksum, status: "ready", download_url: `/api/admin/report-artifacts/${artifact.id}` };
  return { bytes, ready };
}

async function sources({ db, report, diagnostic }: Context) {
  const [{ data: snapshot, error: se }, { data: result, error: re }] = await Promise.all([
    db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", diagnostic.id).maybeSingle(),
    db.from("diagnostic_results").select("id,display_manageability_index,maturity_level_id").eq("diagnostic_id", diagnostic.id).maybeSingle(),
  ]);
  if (se || re) throw Error("pdf_prepare_failed");
  if (!snapshot || !result) throw Error("pdf_result_missing");
  const responses = await Promise.all([
    db.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle(),
    db.from("diagnostic_blocks").select("id,key,weight,position").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    db.from("diagnostic_block_results").select("block_id,display_score").eq("result_id", result.id),
    db.from("diagnostic_block_translations").select("block_id,title").eq("locale", "ru"),
  ]);
  if (responses.some(r => r.error)) throw Error("pdf_prepare_failed");
  const [maturity, blocks, blockResults, blockTexts] = responses.map(r => r.data) as [Row | null, Row[] | null, Row[] | null, Row[] | null];
  const scoringBlocks = (blocks ?? []).filter(block => Number(block.weight) > 0);
  const resultMap = new Map((blockResults ?? []).map(row => [row.block_id, row]));
  const titleMap = new Map((blockTexts ?? []).map(row => [row.block_id, row.title]));
  const profile = (snapshot.profile_data ?? {}) as Row;
  const input = { companyName: String(profile.name ?? "Компания"), completedAt: diagnostic.completed_at, index: String(result.display_manageability_index ?? "—").replace(".", ","), maturity: String(maturity?.label ?? "—"), blocks: scoringBlocks.map(block => ({ title: String(titleMap.get(block.id) ?? block.key), score: String(resultMap.get(block.id)?.display_score ?? "—").replace(".", ",") })), report: savedContent(report.structured_content) };
  return { input, digest: hash(canonical({ report, diagnostic, snapshot, result, input })) };
}

/** Strictly read-only download. It never renders or writes an artifact. */
export async function getPdfForReport(reportId: string, userId: string): Promise<{ bytes: Buffer; fileName: string }> {
  const context = await loadAuthorizedReport(reportId, userId);
  const { bytes } = validatedArtifact(context, await artifactFor(context));
  const { data: snapshot, error } = await context.db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", context.diagnostic.id).maybeSingle();
  if (error || !snapshot) throw Error("pdf_result_missing");
  return { bytes, fileName: fileName(String((snapshot.profile_data as Row)?.name ?? "Компания"), context.diagnostic.completed_at) };
}

const preparationLocks = new Map<string, Promise<Prepared>>();

/** Private mutation core: only independently authorized wrappers enter or join it. */
async function preparePdfForReportUnlocked(context: Context, authorize: Authorize): Promise<Prepared> {
  const source = await sources(context);
  const existing = await artifactFor(context);
  if (existing) return { ready: validatedArtifact(context, existing).ready, fileName: fileName(source.input.companyName, context.diagnostic.completed_at), sourceDigest: source.digest, reused: true };
  const bytes = await renderPdf(source.input);
  if (bytes.length > maxPdfBytes) throw Error("pdf_integrity_failed");
  const checksum = hash(bytes);
  pdfBytes(bytes.toString("base64"), checksum);
  const current = await authorize();
  if ((await sources(current)).digest !== source.digest) throw Error("pdf_source_conflict");
  const { error } = await current.db.from("report_artifacts").insert({ report_id: context.report.id, ai_report_version: context.report.version, format: "pdf", template_version: templateVersion, status: "ready", storage_path: `reports/${context.report.id}/${templateVersion}.pdf`, content_base64: bytes.toString("base64"), checksum });
  if (error && error.code !== "23505") throw Error("pdf_prepare_failed");
  // Both a successful insert and a competing insert must have an exact durable readback.
  const ready = validatedArtifact(current, await artifactFor(current)).ready;
  return { ready, fileName: fileName(source.input.companyName, current.diagnostic.completed_at), sourceDigest: source.digest, reused: error?.code === "23505" };
}

async function prepare(authorize: Authorize): Promise<Prepared> {
  const context = await authorize();
  const key = `${context.report.id}:${context.report.version}:pdf:${templateVersion}`;
  let operation = preparationLocks.get(key);
  if (!operation) {
    operation = preparePdfForReportUnlocked(context, authorize);
    preparationLocks.set(key, operation);
  }
  try {
    const result = await operation;
    // Every waiter reauthorizes; a shared promise never shares caller authority.
    const current = await authorize();
    if ((await sources(current)).digest !== result.sourceDigest) throw Error("pdf_source_conflict");
    return result;
  } finally { if (preparationLocks.get(key) === operation) preparationLocks.delete(key); }
}

/** Owner access still binds the real cookie user through requireDiagnosticRead. */
export async function preparePdfForReport(reportId: string, userId: string): Promise<{ status: "ready"; fileName: string }> {
  const result = await prepare(() => loadAuthorizedReport(reportId, userId));
  return { status: "ready", fileName: result.fileName };
}

/** Admin GET: no renderer, limiter mutation, artifact creation or owner impersonation. */
export async function getAdminPdfStatus(reportId: string): Promise<AdminPdfReady> {
  const context = await loadAdminAuthorizedReport(reportId);
  await sources(context);
  const ready = validatedArtifact(context, await artifactFor(context)).ready;
  await adminActor();
  return ready;
}

export const adminPdfError = (error: unknown) => {
  const allowed = ["pdf_access_denied", "pdf_artifact_not_ready", "pdf_report_not_ready", "pdf_result_missing", "pdf_source_conflict", "pdf_artifact_conflict", "pdf_integrity_failed"];
  return error instanceof Error && allowed.includes(error.message) ? error.message : "pdf_prepare_failed";
};

/** Server-only public admin entry reauthorizes even without an HTTP route caller. */
export async function preparePdfForAdminReport(reportId: string): Promise<AdminPdfReady> {
  const actorId = await adminActor();
  if (!validReportId(reportId)) throw Error("pdf_access_denied");
  const event = (code: "started" | "ready" | "reused" | "failed", result?: AdminPdfReady, error?: unknown) => console.info(JSON.stringify({ event: `admin_pdf_${code}`, actor_id: actorId, report_id: reportId, at: new Date().toISOString(), ...(result ? { artifact_id: result.artifact_id, version: result.ai_report_version, template: result.template_version, checksum: result.checksum } : {}), ...(error ? { error_class: adminPdfError(error) } : {}) }));
  event("started");
  try { const result = await prepare(() => loadAdminAuthorizedReport(reportId)); event(result.reused ? "reused" : "ready", result.ready); return result.ready; }
  catch (error) { event("failed", undefined, error); throw error; }
}

export { templateVersion };
