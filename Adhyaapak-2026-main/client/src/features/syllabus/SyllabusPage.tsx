import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ProposalDto, SyllabusDocumentDto, UploadResponse } from "@adhyaapak/shared";
import { Banner, PageHead } from "../../components/ui";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { useAppConfig } from "../../app/ConfigContext";
import { ApiRequestError } from "../../services/api";
import { api } from "../../services/api";

/** Upload or paste a syllabus section, then ask the AI to propose a concept graph for you to review. */
export function SyllabusPage() {
  const { t } = useTranslation();
  const { aiEnabled } = useAppConfig();
  const docs = useApi<{ documents: SyllabusDocumentDto[] }>("/syllabus-documents");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      let result: UploadResponse;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        // The browser sets the multipart boundary itself, so this goes through fetch directly.
        const res = await fetch("/api/v1/syllabus-documents", { method: "POST", body: form, credentials: "same-origin" });
        const body = await res.json().catch(() => undefined);
        if (!res.ok) throw new ApiRequestError(body?.error?.code ?? "internal_error", body?.error?.message ?? t("common.unexpectedError"), res.status);
        result = body;
      } else {
        result = await api<UploadResponse>("/syllabus-documents/text", { method: "POST", body: { title, text } });
      }
      setNotice(result.alreadyUploaded ? t("syllabus.alreadyUploaded") : t("syllabus.uploaded"));
      setFile(undefined);
      setText("");
      setTitle("");
      docs.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t("syllabus.title")} lede={t("syllabus.intro")} />
      {!aiEnabled && <Banner tone="info"><p>{t("drafts.aiOff")}</p></Banner>}

      <form onSubmit={submit} className="panel" style={{ maxWidth: 680, marginTop: 0 }}>
        <h2 style={{ fontSize: "var(--fs-m)", marginTop: 0 }}>{t("syllabus.add")}</h2>
        <label>
          {t("syllabus.file")}
          <input className="input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0])} />
        </label>
        <p className="muted">{t("syllabus.or")}</p>
        <label>
          {t("syllabus.docTitle")}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!file} />
        </label>
        <label>
          {t("syllabus.pasteText")}
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} disabled={!!file} />
        </label>
        <p className="hint">{t("syllabus.limits")}</p>
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy || (!file && (!title.trim() || !text.trim()))}>
            {busy ? t("common.saving") : t("syllabus.addButton")}
          </button>
        </div>
        {error && <Banner tone="err"><p>{error}</p></Banner>}
        {notice && <Banner tone="ok"><p>{notice}</p></Banner>}
      </form>

      <h2>{t("syllabus.yours")}</h2>
      <AsyncView state={docs}>{(d) => (d.documents.length === 0 ? <div className="state-empty"><p>{t("syllabus.none")}</p></div> : d.documents.map((doc) => <DocumentCard key={doc.id} doc={doc} aiEnabled={aiEnabled} onChanged={docs.reload} />))}</AsyncView>
    </>
  );
}

function DocumentCard({ doc, aiEnabled, onChanged }: { doc: SyllabusDocumentDto; aiEnabled: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: doc.title, grade: "6", subject: "Mathematics", board: "CBSE", academicYear: "2026-27" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const p = await api<ProposalDto>(`/syllabus-documents/${doc.id}/generate-graph`, { method: "POST", body: { ...form, grade: Number(form.grade) } });
      navigate(`/syllabus/graphs/${p.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
      setBusy(false);
    }
  }

  async function remove() {
    setError(undefined);
    try {
      await api(`/syllabus-documents/${doc.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <article className="q-card">
      <h3 style={{ marginTop: 0 }}>{doc.title}</h3>
      <p>
        <small className="hint">
          {doc.originalFilename} · {doc.fileType === "pdf" ? t("syllabus.pdfPages", { count: doc.pageCount ?? 0 }) : t("syllabus.text")} · {t("syllabus.chars", { count: doc.characters })}
        </small>
      </p>
      {doc.suspicious && <Banner tone="warn"><p>{t("syllabus.suspicious")}</p></Banner>}
      {doc.proposals.length > 0 && (
        <ul className="plain rule-list">
          {doc.proposals.map((p) => (
            <li key={p.id}>
              <Link to={`/syllabus/graphs/${p.id}`}>{p.title}</Link> — {t(`syllabus.status.${p.status}`)}
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!aiEnabled}>
          {t("syllabus.makeGraph")}
        </button>
        <button className="btn btn-danger" onClick={() => void remove()}>{t("syllabus.delete")}</button>
      </div>
      {open && (
        <form onSubmit={generate}>
          <label>
            {t("syllabus.graphTitle")}
            <input className="input" value={form.title} onChange={set("title")} required />
          </label>
          <label>
            {t("dashboard.grade")}
            <select value={form.grade} onChange={set("grade")}>
              {[6, 7, 8, 9, 10].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            {t("syllabus.subject")}
            <input className="input" value={form.subject} onChange={set("subject")} required />
          </label>
          <label>
            {t("syllabus.board")}
            <input className="input" value={form.board} onChange={set("board")} required />
          </label>
          <label>
            {t("dashboard.academicYear")}
            <input className="input" value={form.academicYear} onChange={set("academicYear")} placeholder="2026-27" required />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t("syllabus.working") : t("syllabus.generate")}
            </button>
          </div>
          {busy && <p className="pen">{t("syllabus.takesAMoment")}</p>}
        </form>
      )}
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </article>
  );
}
